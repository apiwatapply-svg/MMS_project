#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import random
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from simulator_core import (
    DEFAULT_MACHINES,
    SCENARIOS,
    build_status_payload,
    calculate_expected_metrics,
    calculate_hourly_target,
    create_machine_state,
    generate_machine_events,
    get_profile,
)
from simulate_machine_mqtt import connect_mqtt, publish_mqtt, write_influx


DEFAULT_MACHINE_COUNT = len(DEFAULT_MACHINES)
MAX_RUNNING_MACHINES = 10


def selected_machines(machine_count: Any) -> list[dict[str, Any]]:
    count = int(float(machine_count or DEFAULT_MACHINE_COUNT))
    count = max(1, min(count, DEFAULT_MACHINE_COUNT))
    return DEFAULT_MACHINES[:count]


DEFAULT_CONFIG = {
    "mqtt_url": os.environ.get("MQTT_URL", "mqtt://127.0.0.1:1883"),
    "influx_url": os.environ.get("INFLUX_URL", f"http://{os.environ.get('INFLUX_HOST', '127.0.0.1')}:{os.environ.get('INFLUX_PORT', '8086')}"),
    "influx_database": os.environ.get("INFLUX_DATABASE", "machine_db"),
    "machine_count": DEFAULT_MACHINE_COUNT,
    "interval": 0.05,
    "scenario": "stable",
    "planned_stop_seconds_per_hour": SCENARIOS["stable"].planned_stop_seconds_per_hour,
}


def default_machine_configs() -> dict[str, dict[str, Any]]:
    configs: dict[str, dict[str, Any]] = {}
    for index, machine in enumerate(DEFAULT_MACHINES):
        enabled = index < MAX_RUNNING_MACHINES
        configs[machine["name"]] = {
            "enabled": enabled,
            "status": "auto" if enabled else "Plan_Stop",
            "scan_interval": 0.2,
            "planned_stop_seconds_per_hour": DEFAULT_CONFIG["planned_stop_seconds_per_hour"],
            "ng_rate_pct": round(random.uniform(0, 5), 2),
        }
    return configs


class SimulatorRunner:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.machine_threads: list[threading.Thread] = []
        self.machine_thread_names: set[str] = set()
        self.running = False
        self.config = DEFAULT_CONFIG.copy()
        self.machine_configs = default_machine_configs()
        self.machine_states: dict[str, Any] = {}
        self.stats = {
            "batches": 0,
            "output": 0,
            "ng": 0,
            "last_status": {},
            "last_error": "",
            "started_at": None,
            "metrics": {"availability": 0, "performance": 0, "quality": 0, "oee": 0},
        }

    def start(self, config: dict[str, Any]) -> None:
        self.stop()
        with self.lock:
            self.config = {**DEFAULT_CONFIG, **config}
            self.machine_configs = default_machine_configs()
            for machine_name, item in (config.get("machine_configs") or {}).items():
                if machine_name in self.machine_configs:
                    self.machine_configs[machine_name] = {**self.machine_configs[machine_name], **item}
                    if "ng_rate_pct" not in self.machine_configs[machine_name]:
                        self.machine_configs[machine_name]["ng_rate_pct"] = round(random.uniform(0, 5), 2)
            self._enforce_running_limit_locked()
            self.stats = {
                "batches": 0,
                "output": 0,
                "ng": 0,
                "last_status": {},
                "last_error": "",
                "started_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "metrics": {"availability": 0, "performance": 0, "quality": 0, "oee": 0},
            }
            self.stop_event.clear()
            self.running = True
        self._start_workers()

    def stop(self) -> None:
        self.stop_event.set()
        for thread in self.machine_threads:
            if thread.is_alive():
                thread.join(timeout=0.02)
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=0.5)
        self.machine_threads = []
        self.machine_thread_names = set()
        with self.lock:
            self.running = False

    def update_machine_config(self, machine_name: str, config: dict[str, Any]) -> bool:
        with self.lock:
            if machine_name not in self.machine_configs:
                return False
            was_enabled = bool(self.machine_configs[machine_name].get("enabled", False))
            wants_enabled = bool(config.get("enabled", was_enabled))
            if wants_enabled and not was_enabled and self._running_count_locked() >= MAX_RUNNING_MACHINES:
                self.stats["last_error"] = f"Cannot enable {machine_name}: maximum {MAX_RUNNING_MACHINES} running machines."
                return False
            self.machine_configs[machine_name] = {**self.machine_configs[machine_name], **config}
            if "ng_rate_pct" not in self.machine_configs[machine_name]:
                self.machine_configs[machine_name]["ng_rate_pct"] = round(random.uniform(0, 5), 2)
            if not self.machine_configs[machine_name].get("enabled", True):
                self.machine_configs[machine_name]["status"] = "Plan_Stop"
                machine = next((item for item in DEFAULT_MACHINES if item["name"] == machine_name), None)
                publish_config = self.config.copy()
                threading.Thread(target=self._publish_plan_stop_once, args=(machine, publish_config), daemon=True).start()
            elif self.running and machine_name not in self.machine_thread_names:
                machine = next((item for item in DEFAULT_MACHINES if item["name"] == machine_name), None)
                if machine:
                    self.machine_states.setdefault(machine_name, create_machine_state(machine))
                    thread = threading.Thread(target=self._run_machine, args=(machine,), daemon=True)
                    self.machine_threads.append(thread)
                    self.machine_thread_names.add(machine_name)
                    thread.start()
            return True

    def _running_count_locked(self) -> int:
        return sum(1 for config in self.machine_configs.values() if config.get("enabled", True))

    def _enforce_running_limit_locked(self) -> None:
        running = 0
        for machine in DEFAULT_MACHINES:
            config = self.machine_configs[machine["name"]]
            if config.get("enabled", True):
                running += 1
                if running > MAX_RUNNING_MACHINES:
                    config["enabled"] = False
                    config["status"] = "Plan_Stop"
            elif config.get("status") in ("", "auto", "Auto", None):
                config["status"] = "Plan_Stop"

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            machines = selected_machines(self.config["machine_count"])
            target_rows = [
                {
                    "machine": machine["name"],
                    "area": machine["area"],
                    "type": machine["type"],
                    "model": machine["model"],
                    "ideal_ct": machine["ideal_ct"],
                    "layout": machine.get("layout"),
                    "target_per_hour": calculate_hourly_target(
                        machine["ideal_ct"],
                        100,
                        int(self.machine_configs[machine["name"]]["planned_stop_seconds_per_hour"]),
                    ),
                    "config": self.machine_configs[machine["name"]],
                    "state": self.machine_summary(machine),
                }
                for machine in machines
            ]
            return {
                "running": self.running,
                "config": self.config,
                "stats": self.stats,
                "running_machine_count": self._running_count_locked(),
                "max_running_machines": MAX_RUNNING_MACHINES,
                "targets": target_rows,
                "scenarios": {name: profile.__dict__ for name, profile in SCENARIOS.items()},
            }

    def machine_summary(self, machine: dict[str, Any]) -> dict[str, Any]:
        state = self.machine_states.get(machine["name"])
        if not state:
            return {
                "output": 0,
                "ok": 0,
                "ng": 0,
                "metrics": {"availability": 0, "performance": 0, "quality": 0, "oee": 0},
            }
        metrics = calculate_expected_metrics(
            total_seconds=state.total_seconds,
            run_seconds=state.run_seconds,
            excluded_seconds=state.excluded_seconds,
            output_qty=state.output_count,
            ng_qty=state.ng_count,
            ideal_ct=float(machine["ideal_ct"]),
        )
        return {
            "output": state.output_count,
            "ok": max(0, state.output_count - state.ng_count),
            "ng": state.ng_count,
            "run_seconds": round(state.run_seconds, 1),
            "excluded_seconds": round(state.excluded_seconds, 1),
            "total_seconds": round(state.total_seconds, 1),
            "metrics": metrics,
        }

    def _start_workers(self) -> None:
        config = self.config.copy()
        machines = selected_machines(config["machine_count"])
        states = {machine["name"]: create_machine_state(machine) for machine in machines}
        with self.lock:
            self.machine_states = states
            active_names = [
                machine["name"]
                for machine in machines
                if self.machine_configs[machine["name"]].get("enabled", True)
            ][:MAX_RUNNING_MACHINES]
            active_name_set = set(active_names)

        self.machine_threads = [
            threading.Thread(target=self._run_machine, args=(machine,), daemon=True)
            for machine in machines
            if machine["name"] in active_name_set
        ]
        self.machine_thread_names = active_name_set.copy()
        for thread in self.machine_threads:
            thread.start()

        threading.Thread(target=self._publish_plan_stop_for_inactive, args=(machines, config), daemon=True).start()
        self.thread = threading.Thread(target=self._run_metrics, args=(machines,), daemon=True)
        self.thread.start()

    def _publish_plan_stop_for_inactive(self, machines: list[dict[str, Any]], config: dict[str, Any]) -> None:
        client = None
        try:
            client = connect_mqtt(str(config["mqtt_url"]))
            for machine in machines:
                with self.lock:
                    enabled = self.machine_configs[machine["name"]].get("enabled", True)
                if enabled:
                    continue
                with self.lock:
                    self.stats["last_status"][machine["name"]] = "Plan_Stop"
                payload = build_status_payload(machine, "Plan_Stop")
                topic = f"factory/{machine['type']}/{machine['name']}/{payload['name']}"
                publish_mqtt(client, str(config["mqtt_url"]), topic, payload)
                write_influx(str(config["influx_url"]), str(config["influx_database"]), payload)
        except Exception as exc:
            with self.lock:
                self.stats["last_error"] = f"Plan_Stop publish failed: {exc}"
        finally:
            if client is not None:
                client.loop_stop()
                client.disconnect()

    def _publish_plan_stop_once(self, machine: dict[str, Any] | None, config: dict[str, Any]) -> None:
        if not machine:
            return
        client = None
        try:
            payload = build_status_payload(machine, "Plan_Stop")
            client = connect_mqtt(str(config["mqtt_url"]))
            topic = f"factory/{machine['type']}/{machine['name']}/{payload['name']}"
            publish_mqtt(client, str(config["mqtt_url"]), topic, payload)
            write_influx(str(config["influx_url"]), str(config["influx_database"]), payload)
            with self.lock:
                self.stats["last_status"][machine["name"]] = "Plan_Stop"
        except Exception as exc:
            with self.lock:
                self.stats["last_error"] = f"{machine['name']}: Plan_Stop publish failed: {exc}"
        finally:
            if client is not None:
                client.loop_stop()
                client.disconnect()

    def _run_machine(self, machine: dict[str, Any]) -> None:
        client = None
        try:
            config = self.config.copy()
            client = connect_mqtt(str(config["mqtt_url"]))
            next_due = 0.0
            last_tick = time.monotonic()
            seq_offset = abs(hash(machine["name"])) % 10000

            while not self.stop_event.is_set():
                with self.lock:
                    config = self.config.copy()
                    machine_config = self.machine_configs[machine["name"]].copy()

                now_mono = time.monotonic()
                scan_interval = max(0.05, float(machine_config.get("scan_interval", machine_config.get("interval", 0.2))))
                if now_mono < next_due:
                    self.stop_event.wait(min(0.05, next_due - now_mono))
                    continue

                if not machine_config.get("enabled", True):
                    last_tick = now_mono
                    next_due = now_mono + scan_interval
                    continue

                elapsed_seconds = max(0.0, now_mono - last_tick)
                last_tick = now_mono
                next_due = now_mono + scan_interval
                profile = get_profile(
                    str(config["scenario"]),
                    availability=100,
                    performance=100,
                    quality=100,
                    planned_stop_seconds_per_hour=int(machine_config["planned_stop_seconds_per_hour"]),
                    force_status=machine_config["status"],
                    ng_rate_pct=float(machine_config.get("ng_rate_pct", random.uniform(0, 5))),
                )

                payloads = generate_machine_events(
                    machine,
                    self.machine_states[machine["name"]],
                    profile,
                    elapsed_seconds=elapsed_seconds,
                    seq_base=int(time.time() * 1000) + seq_offset,
                )
                produced_this_scan = 0
                ng_this_scan = 0
                for payload in payloads:
                    topic = f"factory/{machine['type']}/{machine['name']}/{payload['name']}"
                    publish_mqtt(client, str(config["mqtt_url"]), topic, payload)
                    write_influx(str(config["influx_url"]), str(config["influx_database"]), payload)
                    if payload["name"] == "status_tb":
                        with self.lock:
                            self.stats["last_status"][machine["name"]] = payload["fields"]["Status"]
                    if payload["name"] == "data_tb":
                        produced_this_scan += 1
                        if payload["fields"].get("ng_indicator") == "NG":
                            ng_this_scan += 1

                if payloads:
                    with self.lock:
                        self.stats["batches"] += 1
                        self.stats["output"] += produced_this_scan
                        self.stats["ng"] += ng_this_scan
        except Exception as exc:
            with self.lock:
                self.stats["last_error"] = f"{machine['name']}: {exc}"
        finally:
            if client is not None:
                client.loop_stop()
                client.disconnect()

    def _run_metrics(self, machines: list[dict[str, Any]]) -> None:
        try:
            while not self.stop_event.is_set():
                with self.lock:
                    active_machine_names = {m["name"] for m in machines if self.machine_configs[m["name"]].get("enabled", True)}
                    active_states = [self.machine_states[machine_name] for machine_name in active_machine_names if machine_name in self.machine_states]
                    elapsed_machine_seconds = sum(s.total_seconds for s in active_states)
                    run_seconds = sum(s.run_seconds for s in active_states)
                    excluded_seconds = sum(s.excluded_seconds for s in active_states)
                    active_machines = [m for m in machines if m["name"] in active_machine_names]
                    avg_ideal_ct = sum(float(m["ideal_ct"]) for m in active_machines) / len(active_machines) if active_machines else 0
                    self.stats["metrics"] = calculate_expected_metrics(
                        total_seconds=elapsed_machine_seconds,
                        run_seconds=run_seconds,
                        excluded_seconds=excluded_seconds,
                        output_qty=self.stats["output"],
                        ng_qty=self.stats["ng"],
                        ideal_ct=avg_ideal_ct,
                    )
                self.stop_event.wait(0.5)
        except Exception as exc:
            with self.lock:
                self.stats["last_error"] = str(exc)


RUNNER = SimulatorRunner()


HTML = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MMS GOT Machine Simulator</title>
  <style>
    :root { color-scheme: dark; font-family: Arial, sans-serif; background: #06101d; color: #edf4ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #06101d; }
    main { display: grid; grid-template-columns: 1fr 340px; min-height: 100vh; }
    .board { padding: 18px; display: grid; gap: 14px; align-content: start; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; background: #0d1b2e; border: 1px solid #203650; border-radius: 8px; }
    h1 { margin: 0; font-size: 20px; }
    .muted { color: #9fb1c9; }
    .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    input, select, button { border-radius: 6px; border: 1px solid #334d6a; padding: 9px; background: #07111f; color: #edf4ff; }
    button { cursor: pointer; font-weight: 700; }
    button.start { background: #107a55; border-color: #21a574; }
    button.stop { background: #9b2838; border-color: #c9485a; }
    .kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .kpi { background: #0d1b2e; border: 1px solid #203650; border-radius: 8px; padding: 12px; }
    .kpi b { display: block; font-size: 24px; margin-top: 4px; }
    .machine-grid { display: grid; grid-template-columns: repeat(21, minmax(42px, 1fr)); grid-template-rows: 26px repeat(15, minmax(42px, 1fr)); gap: 3px; min-height: calc(100vh - 215px); background: #e5e7eb; border: 1px solid #94a3b8; border-radius: 8px; padding: 8px; overflow: auto; }
    .area-bg { border: 1px solid var(--area-border); background: var(--area-body); border-radius: 6px; z-index: 0; }
    .area-label { align-self: start; background: var(--area-header); color: white; font-weight: 800; font-size: clamp(7px, .65vw, 12px); padding: 2px 6px; border-radius: 6px 6px 0 0; z-index: 2; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .machine-cell { z-index: 1; padding: 1px; min-width: 0; min-height: 0; }
    .machine { border: 1px solid #9e9e9e; border-radius: 4px; min-height: 0; height: 100%; padding: 0; background: #f5f5f5; color: #111827; cursor: pointer; display: flex; flex-direction: column; gap: 0; position: relative; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
    .machine.selected { outline: 3px solid #f7c948; }
    .machine.off { opacity: .45; }
    .machine.Run_Time { border-color: #2e7d32; background: #e8f5e9; }
    .machine.Plan_Stop, .machine.Break_Time, .machine.Preventive, .machine.QC { border-color: #424242; background: #d5d5d5; }
    .machine.Stop_Time { border-color: #c62828; background: #ffebee; }
    .machine.MC_Alarm { border-color: #f04438; animation: pulse 1s infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 22px rgba(240,68,56,.5); } }
    .machine.Run_Time .name { background: #2e7d32; }
    .machine.Plan_Stop .name, .machine.Break_Time .name, .machine.Preventive .name, .machine.QC .name { background: #424242; }
    .machine.Stop_Time .name, .machine.MC_Alarm .name { background: #c62828; }
    .name { font-size: clamp(6px, .55vw, 10px); font-weight: 800; background: #bdbdbd; color: white; padding: 1px 2px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { font-weight: 800; font-size: clamp(5px, .45vw, 8px); padding: 1px 2px; width: auto; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .numbers { display: grid; grid-template-columns: 1fr 1fr; gap: 0 3px; font-size: clamp(5px, .45vw, 8px); padding: 0 2px 1px; line-height: 1.1; }
    .numbers span { color: #374151; }
    aside { border-left: 1px solid #203650; background: #0b1728; padding: 18px; display: grid; align-content: start; gap: 14px; }
    .panel { background: #102037; border: 1px solid #203650; border-radius: 8px; padding: 14px; display: grid; gap: 12px; }
    label { display: grid; gap: 6px; font-size: 13px; color: #b4c2d5; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .legend { display: grid; gap: 8px; font-size: 13px; }
    .dot { display: inline-block; width: 11px; height: 11px; border-radius: 99px; margin-right: 6px; vertical-align: middle; }
    @media (max-width: 1100px) { main { grid-template-columns: 1fr; } aside { border-left: 0; border-top: 1px solid #203650; } }
    @media (max-width: 650px) { .machine-grid, .kpis { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
<main>
  <section class="board">
    <div class="topbar">
      <div>
        <h1>MMS Machine Simulator GOT</h1>
        <div id="state" class="muted">Loading...</div>
      </div>
      <div class="toolbar">
        <span class="muted">Active max: __MAX_RUNNING__ / Display: __MACHINE_TOTAL__</span>
        <button class="start" onclick="startSim()">Start</button>
        <button class="stop" onclick="stopSim()">Stop</button>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><span class="muted">Output</span><b id="out">0</b></div>
      <div class="kpi"><span class="muted">NG</span><b id="ng">0</b></div>
      <div class="kpi"><span class="muted">Availability</span><b id="a">0%</b></div>
      <div class="kpi"><span class="muted">Performance</span><b id="p">0%</b></div>
      <div class="kpi"><span class="muted">OEE</span><b id="oee">0%</b></div>
    </div>
    <div id="machines" class="machine-grid"></div>
  </section>
  <aside>
    <div class="panel">
      <h2 id="panel-title" style="margin:0">Select Machine</h2>
      <label>Enable <select id="mc-enabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
      <label>Status <select id="mc-status"><option>auto</option><option>Run_Time</option><option>Plan_Stop</option><option>Stop_Time</option><option>MC_Alarm</option><option>Break_Time</option><option>Preventive</option><option>QC</option></select></label>
      <div class="row">
        <label>Status scan (sec)<input id="mc-interval" type="number" min="0.05" step="0.05" value="0.2"></label>
        <label>Planned stop sec/hr<input id="mc-plan" type="number" min="0" max="3600" value="120"></label>
      </div>
      <div class="row">
        <label>MQTT<input id="mqtt_url" value="mqtt://127.0.0.1:1883"></label>
        <label>Influx DB<input id="influx_database" value="machine_db"></label>
      </div>
      <label>Influx URL<input id="influx_url" value="http://127.0.0.1:8086"></label>
      <button onclick="applyPanel()">Apply To Machine</button>
    </div>
    <div class="panel">
      <h2 style="margin:0">Status Legend</h2>
      <div class="legend">
        <div><span class="dot" style="background:#17b26a"></span>Run_Time: output follows runtime / ideal CT</div>
        <div><span class="dot" style="background:#f7c948"></span>Plan_Stop / Break_Time / Preventive / QC: no output</div>
        <div><span class="dot" style="background:#8b9bb0"></span>Stop_Time: no output</div>
        <div><span class="dot" style="background:#f04438"></span>MC_Alarm: status + alarm, no output</div>
        <div class="muted">Only enabled machines publish production data. Disabled machines publish Plan_Stop. Maximum enabled machines: __MAX_RUNNING__.</div>
        <div class="muted">NG is randomized per machine between 0-5% and never exceeds output.</div>
      </div>
    </div>
  </aside>
</main>
<script>
let latest = null;
let selected = null;
let machineConfigs = {};
const AREA_LAYOUT = {
  DLC: { colStart: 1, colEnd: 4, rowStart: 1, rowEnd: 10, title: 'DLC Area' },
  ECM: { colStart: 4, colEnd: 7, rowStart: 1, rowEnd: 10, title: 'ECM Area' },
  CLASS1000: { colStart: 1, colEnd: 7, rowStart: 11, rowEnd: 16, title: 'Class 1000 Area' },
  CLASS100: { colStart: 7, colEnd: 22, rowStart: 1, rowEnd: 17, title: 'Class 100 Area' },
};
const AREA_OFFSET = {
  DLC: { colOffset: 1, rowOffset: 2 },
  ECM: { colOffset: 4, rowOffset: 2 },
  CLASS1000: { colOffset: 1, rowOffset: 11 },
  CLASS100: { colOffset: 7, rowOffset: 2 },
};
const AREA_THEME = {
  DLC: { header: '#0284c7', body: '#f0f9ff', border: '#bae6fd' },
  ECM: { header: '#9333ea', body: '#faf5ff', border: '#e9d5ff' },
  CLASS1000: { header: '#ea580c', body: '#fff7ed', border: '#fed7aa' },
  CLASS100: { header: '#0d9488', body: '#f0fdfa', border: '#99f6e4' },
};

function statusClass(status) { return (status || 'Stop_Time').replace(/[^A-Za-z0-9_]/g, '_'); }

async function getStatus() {
  const res = await fetch('/api/status');
  latest = await res.json();
  const stats = latest.stats || {};
  document.getElementById('out').textContent = stats.output || 0;
  document.getElementById('ng').textContent = stats.ng || 0;
  document.getElementById('a').textContent = (stats.metrics?.availability || 0) + '%';
  document.getElementById('p').textContent = (stats.metrics?.performance || 0) + '%';
  document.getElementById('oee').textContent = (stats.metrics?.oee || 0) + '%';
  document.getElementById('state').textContent = `${latest.running ? 'RUNNING' : 'STOPPED'} | active=${latest.running_machine_count || 0}/${latest.max_running_machines || __MAX_RUNNING__} | batches=${stats.batches || 0} | started=${stats.started_at || '-'}`;
  renderMachines();
}

function renderMachines() {
  const box = document.getElementById('machines');
  const areaLayers = Object.entries(AREA_LAYOUT).flatMap(([area, layout]) => {
    const theme = AREA_THEME[area];
    return [
      `<div class="area-bg" style="grid-column:${layout.colStart}/${layout.colEnd};grid-row:${layout.rowStart}/${layout.rowEnd};--area-body:${theme.body};--area-border:${theme.border};"></div>`,
      `<div class="area-label" style="grid-column:${layout.colStart}/${layout.colEnd};grid-row:${layout.rowStart};--area-header:${theme.header};">${layout.title}</div>`
    ];
  });
  const machineLayers = latest.targets.map(row => {
    const cfg = machineConfigs[row.machine] || row.config || {};
    machineConfigs[row.machine] = { ...cfg };
    const disabled = cfg.enabled === false || cfg.enabled === 'false';
    const liveStatus = disabled ? 'Plan_Stop' : (latest.stats.last_status[row.machine] || cfg.status || 'Offline');
    const state = row.state || {};
    const metrics = state.metrics || {};
    const offset = AREA_OFFSET[row.area] || { colOffset: 1, rowOffset: 2 };
    const layout = row.layout || { row: 0, col: 0 };
    const gridCol = layout.col + offset.colOffset;
    const gridRow = layout.row + offset.rowOffset;
    return `<div class="machine-cell" style="grid-column:${gridCol};grid-row:${gridRow};">
    <div class="machine ${disabled ? 'off' : ''} ${statusClass(liveStatus)} ${selected === row.machine ? 'selected' : ''}" onclick="selectMachine('${row.machine}')">
      <div class="name">${row.machine}</div>
      <div class="status">${liveStatus}</div>
      <div class="numbers">
        <div><span>OUT</span><br><b>${state.output || 0}</b></div>
        <div><span>NG</span><br><b>${state.ng || 0}</b></div>
        <div><span>CT</span><br><b>${row.ideal_ct}s</b></div>
        <div><span>OEE</span><br><b>${metrics.oee || 0}%</b></div>
      </div>
    </div></div>`;
  });
  box.innerHTML = [...areaLayers, ...machineLayers].join('');
}

function selectMachine(name) {
  selected = name;
  const row = latest.targets.find(x => x.machine === name);
  const cfg = machineConfigs[name] || row.config || {};
  document.getElementById('panel-title').textContent = name;
  document.getElementById('mc-enabled').value = String(cfg.enabled !== false);
  document.getElementById('mc-status').value = cfg.status || 'auto';
  document.getElementById('mc-interval').value = cfg.scan_interval || cfg.interval || 0.2;
  document.getElementById('mc-plan').value = cfg.planned_stop_seconds_per_hour || 120;
  renderMachines();
}

async function applyPanel() {
  if (!selected) return;
  machineConfigs[selected] = {
    ...(machineConfigs[selected] || {}),
    enabled: document.getElementById('mc-enabled').value === 'true',
    status: document.getElementById('mc-status').value,
    scan_interval: Number(document.getElementById('mc-interval').value || 0.2),
    planned_stop_seconds_per_hour: Number(document.getElementById('mc-plan').value || 0),
  };
  await fetch('/api/machine-config', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ machine: selected, config: machineConfigs[selected] })
  }).then(async res => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      alert(body.message || `Maximum ${latest?.max_running_machines || __MAX_RUNNING__} machines can be enabled.`);
      if (latest?.targets) {
        const row = latest.targets.find(x => x.machine === selected);
        if (row?.config) machineConfigs[selected] = { ...row.config };
      }
    }
  });
  await getStatus();
  renderMachines();
}

function readConfig() {
  return {
    scenario: 'stable',
    machine_count: __MACHINE_TOTAL__,
    interval: 0.05,
    planned_stop_seconds_per_hour: 120,
    mqtt_url: document.getElementById('mqtt_url').value,
    influx_url: document.getElementById('influx_url').value,
    influx_database: document.getElementById('influx_database').value,
    machine_configs: machineConfigs,
  };
}

async function startSim() {
  if (selected) await applyPanel();
  await fetch('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(readConfig()) });
  await getStatus();
}

async function stopSim() {
  await fetch('/api/stop', { method: 'POST' });
  await getStatus();
}

setInterval(getStatus, 1000);
getStatus();
</script>
</body>
</html>
"""

HTML = HTML.replace("__MACHINE_TOTAL__", str(DEFAULT_MACHINE_COUNT))
HTML = HTML.replace("__MAX_RUNNING__", str(MAX_RUNNING_MACHINES))


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, content: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self) -> None:
        if self.path == "/":
            self._send(200, HTML.encode("utf-8"), "text/html; charset=utf-8")
            return
        if self.path == "/api/status":
            self._send(200, json.dumps(RUNNER.snapshot()).encode("utf-8"), "application/json")
            return
        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        data = json.loads(raw or "{}")
        if self.path == "/api/start":
            config = {
                "mqtt_url": data.get("mqtt_url", DEFAULT_CONFIG["mqtt_url"]),
                "influx_url": data.get("influx_url", DEFAULT_CONFIG["influx_url"]),
                "influx_database": data.get("influx_database", DEFAULT_CONFIG["influx_database"]),
                "machine_count": len(selected_machines(data.get("machine_count", DEFAULT_CONFIG["machine_count"]))),
                "interval": float(data.get("interval", DEFAULT_CONFIG["interval"])),
                "scenario": data.get("scenario", DEFAULT_CONFIG["scenario"]),
                "planned_stop_seconds_per_hour": int(float(data.get("planned_stop_seconds_per_hour", DEFAULT_CONFIG["planned_stop_seconds_per_hour"]))),
                "machine_configs": data.get("machine_configs", {}),
            }
            RUNNER.start(config)
            self._send(200, json.dumps({"ok": True}).encode("utf-8"), "application/json")
            return
        if self.path == "/api/machine-config":
            ok = RUNNER.update_machine_config(str(data.get("machine", "")), data.get("config", {}))
            status = 200 if ok else 400
            self._send(
                status,
                json.dumps({"ok": ok, "message": RUNNER.stats.get("last_error", "")}).encode("utf-8"),
                "application/json",
            )
            return
        if self.path == "/api/stop":
            RUNNER.stop()
            self._send(200, json.dumps({"ok": True}).encode("utf-8"), "application/json")
            return
        self._send(404, b"not found", "text/plain")

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> int:
    port = int(os.environ.get("SIM_DASHBOARD_PORT", "5088"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"MMS machine simulator dashboard: http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        RUNNER.stop()
        print("\nStopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
