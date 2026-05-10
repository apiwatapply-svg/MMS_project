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
    calculate_expected_metrics,
    calculate_hourly_target,
    create_machine_state,
    generate_machine_events,
    get_profile,
)
from simulate_machine_mqtt import connect_mqtt, publish_mqtt, write_influx


DEFAULT_MACHINE_COUNT = len(DEFAULT_MACHINES)


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
    for machine in DEFAULT_MACHINES:
        configs[machine["name"]] = {
            "enabled": True,
            "status": "auto",
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
            self.thread = threading.Thread(target=self._run, daemon=True)
            self.running = True
            self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=3)
        with self.lock:
            self.running = False

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

    def _run(self) -> None:
        client = None
        try:
            config = self.config.copy()
            machines = selected_machines(config["machine_count"])
            states = {machine["name"]: create_machine_state(machine) for machine in machines}
            with self.lock:
                self.machine_states = states
            machine_configs = self.machine_configs.copy()
            profiles = {
                machine["name"]: get_profile(
                    str(config["scenario"]),
                    availability=100,
                    performance=100,
                    quality=100,
                    planned_stop_seconds_per_hour=int(machine_configs[machine["name"]]["planned_stop_seconds_per_hour"]),
                    force_status=machine_configs[machine["name"]]["status"],
                    ng_rate_pct=float(machine_configs[machine["name"]].get("ng_rate_pct", random.uniform(0, 5))),
                )
                for machine in machines
            }
            next_due = {machine["name"]: 0.0 for machine in machines}
            last_tick = {machine["name"]: time.monotonic() for machine in machines}
            client = connect_mqtt(str(config["mqtt_url"]))
            start_time = time.time()

            while not self.stop_event.is_set():
                batch_start = time.time()
                produced_this_batch = 0
                ng_this_batch = 0

                for idx, machine in enumerate(machines):
                    machine_config = machine_configs[machine["name"]]
                    if not machine_config.get("enabled", True):
                        continue
                    now_mono = time.monotonic()
                    if now_mono < next_due[machine["name"]]:
                        continue
                    scan_interval = max(0.05, float(machine_config.get("scan_interval", machine_config.get("interval", 0.2))))
                    elapsed_seconds = max(0.0, now_mono - last_tick[machine["name"]])
                    last_tick[machine["name"]] = now_mono
                    next_due[machine["name"]] = now_mono + scan_interval
                    payloads = generate_machine_events(
                        machine,
                        states[machine["name"]],
                        profiles[machine["name"]],
                        elapsed_seconds=elapsed_seconds,
                        seq_base=int(time.time() * 1000) + idx * 100,
                    )
                    for payload in payloads:
                        topic = f"factory/{machine['type']}/{machine['name']}/{payload['name']}"
                        publish_mqtt(client, str(config["mqtt_url"]), topic, payload)
                        write_influx(str(config["influx_url"]), str(config["influx_database"]), payload)
                        if payload["name"] == "status_tb":
                            with self.lock:
                                self.stats["last_status"][machine["name"]] = payload["fields"]["Status"]
                        if payload["name"] == "data_tb":
                            produced_this_batch += 1
                            if payload["fields"].get("ng_indicator") == "NG":
                                ng_this_batch += 1

                elapsed = max(1.0, time.time() - start_time)
                active_states = [states[m["name"]] for m in machines if machine_configs[m["name"]].get("enabled", True)]
                elapsed_machine_seconds = sum(s.total_seconds for s in active_states) or elapsed
                run_seconds = sum(s.run_seconds for s in active_states)
                excluded_seconds = sum(s.excluded_seconds for s in active_states)
                avg_ideal_ct = sum(float(m["ideal_ct"]) for m in machines) / len(machines)

                with self.lock:
                    self.stats["batches"] += 1
                    self.stats["output"] += produced_this_batch
                    self.stats["ng"] += ng_this_batch
                    self.stats["metrics"] = calculate_expected_metrics(
                        total_seconds=elapsed_machine_seconds,
                        run_seconds=run_seconds,
                        excluded_seconds=excluded_seconds,
                        output_qty=self.stats["output"],
                        ng_qty=self.stats["ng"],
                        ideal_ct=avg_ideal_ct,
                    )

                sleep_for = max(0.02, min(0.1, float(config["interval"]) - (time.time() - batch_start)))
                self.stop_event.wait(sleep_for)
        except Exception as exc:
            with self.lock:
                self.stats["last_error"] = str(exc)
        finally:
            if client is not None:
                client.loop_stop()
                client.disconnect()
            with self.lock:
                self.running = False


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
    .machine-grid { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 10px; }
    .machine { border: 2px solid #30465e; border-radius: 8px; min-height: 136px; padding: 10px; background: #102037; cursor: pointer; display: grid; gap: 7px; position: relative; }
    .machine.selected { outline: 3px solid #f7c948; }
    .machine.off { opacity: .45; }
    .machine.Run_Time { border-color: #17b26a; box-shadow: inset 0 0 0 1px rgba(23,178,106,.35); }
    .machine.Plan_Stop, .machine.Break_Time { border-color: #f7c948; }
    .machine.Stop_Time { border-color: #8b9bb0; }
    .machine.MC_Alarm { border-color: #f04438; animation: pulse 1s infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 22px rgba(240,68,56,.5); } }
    .name { font-size: 18px; font-weight: 800; }
    .status { font-weight: 800; font-size: 13px; padding: 5px 7px; border-radius: 5px; background: rgba(255,255,255,.08); width: max-content; }
    .numbers { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; font-size: 12px; }
    .numbers span { color: #9fb1c9; }
    aside { border-left: 1px solid #203650; background: #0b1728; padding: 18px; display: grid; align-content: start; gap: 14px; }
    .panel { background: #102037; border: 1px solid #203650; border-radius: 8px; padding: 14px; display: grid; gap: 12px; }
    label { display: grid; gap: 6px; font-size: 13px; color: #b4c2d5; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .legend { display: grid; gap: 8px; font-size: 13px; }
    .dot { display: inline-block; width: 11px; height: 11px; border-radius: 99px; margin-right: 6px; vertical-align: middle; }
    @media (max-width: 1100px) { main { grid-template-columns: 1fr; } aside { border-left: 0; border-top: 1px solid #203650; } .machine-grid { grid-template-columns: repeat(3, minmax(150px, 1fr)); } }
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
        <label class="muted">Machines <input id="machine_count" type="number" min="1" max="__MACHINE_TOTAL__" value="__MACHINE_TOTAL__" style="width:76px"></label>
        <span class="muted">/ All</span>
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
      <label>Status <select id="mc-status"><option>auto</option><option>Run_Time</option><option>Plan_Stop</option><option>Stop_Time</option><option>MC_Alarm</option><option>Break_Time</option></select></label>
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
        <div><span class="dot" style="background:#f7c948"></span>Plan_Stop / Break_Time: no output</div>
        <div><span class="dot" style="background:#8b9bb0"></span>Stop_Time: no output</div>
        <div><span class="dot" style="background:#f04438"></span>MC_Alarm: status + alarm, no output</div>
        <div class="muted">NG is randomized per machine between 0-5% and never exceeds output.</div>
      </div>
    </div>
  </aside>
</main>
<script>
let latest = null;
let selected = null;
let machineConfigs = {};

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
  document.getElementById('state').textContent = `${latest.running ? 'RUNNING' : 'STOPPED'} | batches=${stats.batches || 0} | started=${stats.started_at || '-'}`;
  renderMachines();
}

function renderMachines() {
  const box = document.getElementById('machines');
  box.innerHTML = latest.targets.map(row => {
    const cfg = machineConfigs[row.machine] || row.config || {};
    machineConfigs[row.machine] = { ...cfg };
    const liveStatus = latest.stats.last_status[row.machine] || cfg.status || 'Offline';
    const state = row.state || {};
    const metrics = state.metrics || {};
    const disabled = cfg.enabled === false || cfg.enabled === 'false';
    return `<div class="machine ${disabled ? 'off' : ''} ${statusClass(liveStatus)} ${selected === row.machine ? 'selected' : ''}" onclick="selectMachine('${row.machine}')">
      <div class="name">${row.machine}</div>
      <div class="muted">${row.area} / ${row.type} / ${row.model}</div>
      <div class="status">${disabled ? 'Disabled' : liveStatus}</div>
      <div class="numbers">
        <div><span>OUT</span><br><b>${state.output || 0}</b></div>
        <div><span>NG</span><br><b>${state.ng || 0}</b></div>
        <div><span>OK</span><br><b>${state.ok || 0}</b></div>
        <div><span>Target/hr</span><br><b>${row.target_per_hour}</b></div>
        <div><span>CT</span><br><b>${row.ideal_ct}s</b></div>
        <div><span>OEE</span><br><b>${metrics.oee || 0}%</b></div>
      </div>
    </div>`;
  }).join('');
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

function applyPanel() {
  if (!selected) return;
  machineConfigs[selected] = {
    ...(machineConfigs[selected] || {}),
    enabled: document.getElementById('mc-enabled').value === 'true',
    status: document.getElementById('mc-status').value,
    scan_interval: Number(document.getElementById('mc-interval').value || 0.2),
    planned_stop_seconds_per_hour: Number(document.getElementById('mc-plan').value || 0),
  };
  renderMachines();
}

function readConfig() {
  return {
    scenario: 'stable',
    machine_count: Number(document.getElementById('machine_count').value || __MACHINE_TOTAL__),
    interval: 0.05,
    planned_stop_seconds_per_hour: 120,
    mqtt_url: document.getElementById('mqtt_url').value,
    influx_url: document.getElementById('influx_url').value,
    influx_database: document.getElementById('influx_database').value,
    machine_configs: machineConfigs,
  };
}

async function startSim() {
  if (selected) applyPanel();
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
