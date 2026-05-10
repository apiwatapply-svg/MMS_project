#!/usr/bin/env python3
from __future__ import annotations

import json
import os
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


DEFAULT_CONFIG = {
    "mqtt_url": os.environ.get("MQTT_URL", "mqtt://127.0.0.1:1883"),
    "influx_url": os.environ.get("INFLUX_URL", f"http://{os.environ.get('INFLUX_HOST', '127.0.0.1')}:{os.environ.get('INFLUX_PORT', '8086')}"),
    "influx_database": os.environ.get("INFLUX_DATABASE", "machine_db"),
    "machine_count": 8,
    "interval": 1.0,
    "scenario": "stable",
    "availability": SCENARIOS["stable"].availability,
    "performance": SCENARIOS["stable"].performance,
    "quality": SCENARIOS["stable"].quality,
    "planned_stop_seconds_per_hour": SCENARIOS["stable"].planned_stop_seconds_per_hour,
}


class SimulatorRunner:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.running = False
        self.config = DEFAULT_CONFIG.copy()
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
            machines = DEFAULT_MACHINES[: int(self.config["machine_count"])]
            target_rows = [
                {
                    "machine": machine["name"],
                    "ideal_ct": machine["ideal_ct"],
                    "target_per_hour": calculate_hourly_target(
                        machine["ideal_ct"],
                        float(self.config["performance"]),
                        int(self.config["planned_stop_seconds_per_hour"]),
                    ),
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

    def _run(self) -> None:
        client = None
        try:
            config = self.config.copy()
            machines = DEFAULT_MACHINES[: int(config["machine_count"])]
            states = {machine["name"]: create_machine_state(machine) for machine in machines}
            profile = get_profile(
                str(config["scenario"]),
                availability=float(config["availability"]),
                performance=float(config["performance"]),
                quality=float(config["quality"]),
                planned_stop_seconds_per_hour=int(config["planned_stop_seconds_per_hour"]),
            )
            client = connect_mqtt(str(config["mqtt_url"]))
            start_time = time.time()

            while not self.stop_event.is_set():
                batch_start = time.time()
                produced_this_batch = 0
                ng_this_batch = 0

                for idx, machine in enumerate(machines):
                    payloads = generate_machine_events(
                        machine,
                        states[machine["name"]],
                        profile,
                        elapsed_seconds=float(config["interval"]),
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
                elapsed_machine_seconds = elapsed * len(machines)
                run_seconds = elapsed_machine_seconds * (profile.availability / 100.0)
                excluded_seconds = elapsed_machine_seconds * (profile.planned_stop_seconds_per_hour / 3600.0)
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

                sleep_for = max(0.0, float(config["interval"]) - (time.time() - batch_start))
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
  <title>MMS Machine Simulator</title>
  <style>
    :root { color-scheme: dark; font-family: Arial, sans-serif; background: #07111f; color: #e6edf7; }
    body { margin: 0; padding: 24px; }
    main { max-width: 1180px; margin: 0 auto; display: grid; gap: 18px; }
    section { background: #101c2d; border: 1px solid #24354d; border-radius: 8px; padding: 18px; }
    h1, h2 { margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; font-size: 13px; color: #aab8ce; }
    input, select, button { border-radius: 6px; border: 1px solid #334963; padding: 10px; background: #07111f; color: #e6edf7; }
    button { cursor: pointer; font-weight: 700; }
    button.start { background: #11875d; border-color: #21a574; }
    button.stop { background: #9f2d3d; border-color: #c9485a; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .card { background: #07111f; border: 1px solid #24354d; border-radius: 8px; padding: 14px; }
    .value { font-size: 28px; font-weight: 800; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 9px; border-bottom: 1px solid #24354d; text-align: left; }
    .muted { color: #8fa1ba; }
    @media (max-width: 900px) { .grid, .cards { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 560px) { .grid, .cards { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <section>
    <h1>MMS Machine Simulator</h1>
    <p class="muted">Control MQTT + InfluxDB machine telemetry with target-aware OEE simulation.</p>
    <div class="grid">
      <label>Scenario<select id="scenario"></select></label>
      <label>Machines<input id="machine_count" type="number" min="1" max="10" value="8"></label>
      <label>Interval seconds<input id="interval" type="number" min="0.2" step="0.1" value="1"></label>
      <label>Planned stop sec/hr<input id="planned_stop_seconds_per_hour" type="number" min="0" max="3600" value="120"></label>
      <label>Availability %<input id="availability" type="number" min="0" max="100" step="0.1" value="95"></label>
      <label>Performance %<input id="performance" type="number" min="0" max="150" step="0.1" value="96"></label>
      <label>Quality %<input id="quality" type="number" min="0" max="100" step="0.1" value="98.5"></label>
      <label>MQTT URL<input id="mqtt_url" value="mqtt://127.0.0.1:1883"></label>
      <label>Influx URL<input id="influx_url" value="http://127.0.0.1:8086"></label>
      <label>Influx DB<input id="influx_database" value="machine_db"></label>
    </div>
    <div style="display:flex; gap:10px; margin-top:14px;">
      <button class="start" onclick="startSim()">Start</button>
      <button class="stop" onclick="stopSim()">Stop</button>
    </div>
  </section>
  <section>
    <h2>Live Metrics</h2>
    <div class="cards">
      <div class="card"><div class="muted">Availability</div><div id="a" class="value">0</div></div>
      <div class="card"><div class="muted">Performance</div><div id="p" class="value">0</div></div>
      <div class="card"><div class="muted">Quality</div><div id="q" class="value">0</div></div>
      <div class="card"><div class="muted">OEE</div><div id="oee" class="value">0</div></div>
    </div>
    <p id="state" class="muted"></p>
  </section>
  <section>
    <h2>Targets</h2>
    <table><thead><tr><th>Machine</th><th>Ideal CT</th><th>Target / hour</th><th>Status</th></tr></thead><tbody id="targets"></tbody></table>
  </section>
</main>
<script>
async function getStatus() {
  const res = await fetch('/api/status');
  const data = await res.json();
  const scenario = document.getElementById('scenario');
  if (!scenario.options.length) {
    Object.keys(data.scenarios).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      scenario.appendChild(opt);
    });
  }
  const stats = data.stats;
  document.getElementById('a').textContent = stats.metrics.availability + '%';
  document.getElementById('p').textContent = stats.metrics.performance + '%';
  document.getElementById('q').textContent = stats.metrics.quality + '%';
  document.getElementById('oee').textContent = stats.metrics.oee + '%';
  document.getElementById('state').textContent =
    (data.running ? 'Running' : 'Stopped') + ' | batches=' + stats.batches +
    ' | output=' + stats.output + ' | ng=' + stats.ng +
    (stats.last_error ? ' | error=' + stats.last_error : '');
  document.getElementById('targets').innerHTML = data.targets.map(row => {
    const status = stats.last_status[row.machine] || '-';
    return `<tr><td>${row.machine}</td><td>${row.ideal_ct}s</td><td>${row.target_per_hour}</td><td>${status}</td></tr>`;
  }).join('');
}
function readConfig() {
  const ids = ['scenario','machine_count','interval','planned_stop_seconds_per_hour','availability','performance','quality','mqtt_url','influx_url','influx_database'];
  const data = {};
  ids.forEach(id => data[id] = document.getElementById(id).value);
  return data;
}
async function startSim() {
  await fetch('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(readConfig()) });
  getStatus();
}
async function stopSim() {
  await fetch('/api/stop', { method: 'POST' });
  getStatus();
}
document.getElementById('scenario').addEventListener('change', async () => {
  const res = await fetch('/api/status');
  const data = await res.json();
  const profile = data.scenarios[document.getElementById('scenario').value];
  if (!profile) return;
  document.getElementById('availability').value = profile.availability;
  document.getElementById('performance').value = profile.performance;
  document.getElementById('quality').value = profile.quality;
  document.getElementById('planned_stop_seconds_per_hour').value = profile.planned_stop_seconds_per_hour;
});
setInterval(getStatus, 1000);
getStatus();
</script>
</body>
</html>
"""


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
                "machine_count": int(float(data.get("machine_count", DEFAULT_CONFIG["machine_count"]))),
                "interval": float(data.get("interval", DEFAULT_CONFIG["interval"])),
                "scenario": data.get("scenario", DEFAULT_CONFIG["scenario"]),
                "availability": float(data.get("availability", DEFAULT_CONFIG["availability"])),
                "performance": float(data.get("performance", DEFAULT_CONFIG["performance"])),
                "quality": float(data.get("quality", DEFAULT_CONFIG["quality"])),
                "planned_stop_seconds_per_hour": int(float(data.get("planned_stop_seconds_per_hour", DEFAULT_CONFIG["planned_stop_seconds_per_hour"]))),
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
