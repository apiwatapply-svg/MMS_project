#!/usr/bin/env python3
"""
Simulate factory machine telemetry for the MMS demo.

The script publishes JSON payloads to MQTT using the same structure that
backend/services/mqttService.js consumes. It can also write the same records to
InfluxDB 1.x line protocol so the current-hour dashboard and reports can query
real time-series data during a demo.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

from simulator_core import (
    DEFAULT_MACHINES,
    SCENARIOS,
    calculate_expected_metrics,
    create_machine_state,
    generate_machine_events,
    get_profile,
)


def env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def parse_mqtt_url(url: str) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(url)
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 1883,
        "username": urllib.parse.unquote(parsed.username) if parsed.username else None,
        "password": urllib.parse.unquote(parsed.password) if parsed.password else None,
    }


def now_parts() -> tuple[datetime, str, str, str]:
    utc_now = datetime.now(timezone.utc)
    local_now = utc_now.astimezone(timezone(timedelta(hours=7)))
    shift = "A" if 7 <= local_now.hour < 15 else "B" if 15 <= local_now.hour < 23 else "C"
    return (
        utc_now,
        utc_now.strftime("%Y-%m-%d %H:%M:%S"),
        local_now.strftime("%Y-%m-%d"),
        local_now.strftime("%H:%M:%S"),
    )


def build_data_payload(machine: dict[str, Any], seq: int) -> dict[str, Any]:
    utc_now, utc_text, date_local, time_local = now_parts()
    is_ng = random.random() < 0.06
    stations = ["OK", "OK", "OK", "OK", "OK"]
    if is_ng:
        stations[random.randrange(len(stations))] = "NG"

    cycle_time = round(random.uniform(*machine["ct"]), 2)
    return {
        "name": "data_tb",
        "tags": {
            "machine_name": machine["name"],
            "machine_type": machine["type"],
        },
        "fields": {
            "Date_Time_UTC": utc_text,
            "Drop_Empty_Column": "",
            "Model": machine["model"],
            "cycle_time": cycle_time,
            "date_local": date_local,
            "emp_no": f"OP{100 + (seq % 20)}",
            "id": int(utc_now.timestamp() * 1_000_000_000) + seq,
            "judg_result": ",".join(stations),
            "lot_no": f"LOT-{machine['type']}-{seq // 100:04d}",
            "lot_size": 5000,
            "ng_indicator": "NG" if is_ng else "",
            "shift": "A",
            "time_interval": cycle_time,
            "time_local": time_local,
        },
        "timestamp": int(utc_now.timestamp()),
    }


def build_status_payload(machine: dict[str, Any]) -> dict[str, Any]:
    utc_now, utc_text, date_local, time_local = now_parts()
    return {
        "name": "status_tb",
        "tags": {
            "machine_name": machine["name"],
            "machine_type": machine["type"],
        },
        "fields": {
            "Date_Time_UTC": utc_text,
            "Status": random.choice(STATUSES),
            "date_local": date_local,
            "shift": "A",
            "time_local": time_local,
        },
        "timestamp": int(utc_now.timestamp()),
    }


def build_alarm_payload(machine: dict[str, Any]) -> dict[str, Any]:
    utc_now, utc_text, date_local, time_local = now_parts()
    return {
        "name": "alarm_tb",
        "tags": {
            "machine_name": machine["name"],
            "machine_type": machine["type"],
        },
        "fields": {
            "Date_Time_UTC": utc_text,
            "Alarm": random.choice(ALARMS),
            "Device": f"{machine['type']}-SIM",
            "date_local": date_local,
            "shift": "A",
            "time_local": time_local,
        },
        "timestamp": int(utc_now.timestamp()),
    }


def escape_tag(value: Any) -> str:
    return str(value).replace(" ", r"\ ").replace(",", r"\,").replace("=", r"\=")


def escape_string(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace('"', r"\"")


def field_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return f"{value}i"
    if isinstance(value, float):
        return str(value)
    return f'"{escape_string(value)}"'


def to_influx_line(payload: dict[str, Any]) -> str:
    measurement = payload["name"]
    tags = ",".join(f"{escape_tag(k)}={escape_tag(v)}" for k, v in payload["tags"].items())
    fields = ",".join(f"{escape_tag(k)}={field_value(v)}" for k, v in payload["fields"].items())
    timestamp_ns = int(payload["fields"].get("id") or (int(payload["timestamp"]) * 1_000_000_000))
    return f"{measurement},{tags} {fields} {timestamp_ns}"


def write_influx(influx_url: str, database: str, payload: dict[str, Any]) -> bool:
    line = to_influx_line(payload).encode("utf-8")
    url = f"{influx_url.rstrip('/')}/write?db={urllib.parse.quote(database)}"
    request = urllib.request.Request(url, data=line, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return 200 <= response.status < 300
    except Exception as exc:
        print(f"[InfluxDB] write failed: {exc}", file=sys.stderr)
        return False


def connect_mqtt(mqtt_url: str):
    if mqtt is None:
        return None

    parsed = parse_mqtt_url(mqtt_url)
    client = mqtt.Client(client_id=f"mms-simulator-{random.randint(1000, 9999)}")
    if parsed["username"]:
        client.username_pw_set(parsed["username"], parsed["password"])
    client.connect(parsed["host"], parsed["port"], keepalive=30)
    client.loop_start()
    return client


def publish_mqtt(client: Any, mqtt_url: str, topic: str, payload: dict[str, Any]) -> None:
    payload_text = json.dumps(payload)
    if client is not None:
        client.publish(topic, payload_text, qos=1)
        return

    mosquitto_pub = shutil.which("mosquitto_pub") or r"C:\Program Files\Mosquitto\mosquitto_pub.exe"
    if not os.path.exists(mosquitto_pub):
        raise RuntimeError(
            "Missing MQTT publisher. Install paho-mqtt or make mosquitto_pub.exe available in PATH."
        )

    parsed = parse_mqtt_url(mqtt_url)
    cmd = [
        mosquitto_pub,
        "-h",
        parsed["host"],
        "-p",
        str(parsed["port"]),
        "-t",
        topic,
        "-m",
        payload_text,
        "-q",
        "1",
    ]
    if parsed["username"]:
        cmd.extend(["-u", parsed["username"], "-P", parsed["password"] or ""])
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


def main() -> int:
    parser = argparse.ArgumentParser(description="Simulate MMS machine MQTT and InfluxDB data.")
    parser.add_argument("--mqtt-url", default=env("MQTT_URL", "mqtt://127.0.0.1:1883"))
    parser.add_argument("--influx-url", default=env("INFLUX_URL", f"http://{env('INFLUX_HOST', '127.0.0.1')}:{env('INFLUX_PORT', '8086')}"))
    parser.add_argument("--influx-database", default=env("INFLUX_DATABASE", "machine_db"))
    parser.add_argument("--types", type=int, default=8, help="Number of machine types to simulate, 1-10.")
    parser.add_argument("--interval", type=float, default=1.0, help="Delay between batches in seconds.")
    parser.add_argument("--cycles", type=int, default=120, help="Number of batches. Use 0 for continuous mode.")
    parser.add_argument("--no-influx", action="store_true", help="Publish MQTT only.")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS.keys()), default="stable", help="Machine situation profile.")
    parser.add_argument("--availability", type=float, help="Override scenario availability percent.")
    parser.add_argument("--performance", type=float, help="Override scenario performance percent.")
    parser.add_argument("--quality", type=float, help="Override scenario quality percent.")
    parser.add_argument("--planned-stop", type=int, help="Override planned stop seconds per hour.")
    args = parser.parse_args()

    machine_count = max(1, min(args.types, len(DEFAULT_MACHINES)))
    machines = DEFAULT_MACHINES[:machine_count]
    profile = get_profile(
        args.scenario,
        availability=args.availability if args.availability is not None else SCENARIOS[args.scenario].availability,
        performance=args.performance if args.performance is not None else SCENARIOS[args.scenario].performance,
        quality=args.quality if args.quality is not None else SCENARIOS[args.scenario].quality,
        planned_stop_seconds_per_hour=args.planned_stop if args.planned_stop is not None else SCENARIOS[args.scenario].planned_stop_seconds_per_hour,
    )
    states = {machine["name"]: create_machine_state(machine) for machine in machines}

    client = connect_mqtt(args.mqtt_url)
    publisher = "paho-mqtt" if client is not None else "mosquitto_pub.exe"
    print(f"[MQTT] publishing to {args.mqtt_url} via {publisher}")
    if not args.no_influx:
        print(f"[InfluxDB] writing to {args.influx_url}/{args.influx_database}")
    print(f"[Simulator] machines: {', '.join(m['name'] for m in machines)}")
    print(
        "[Scenario] "
        f"{profile.name} | A={profile.availability}% P={profile.performance}% Q={profile.quality}% "
        f"planned_stop={profile.planned_stop_seconds_per_hour}s/hr"
    )

    batch = 0
    produced = 0
    ng_qty = 0
    try:
        while args.cycles == 0 or batch < args.cycles:
            batch += 1
            for idx, machine in enumerate(machines):
                payloads = generate_machine_events(
                    machine,
                    states[machine["name"]],
                    profile,
                    elapsed_seconds=args.interval,
                    seq_base=batch * 1000 + idx * 100,
                )

                for payload in payloads:
                    topic = f"factory/{machine['type']}/{machine['name']}/{payload['name']}"
                    publish_mqtt(client, args.mqtt_url, topic, payload)
                    if not args.no_influx:
                        write_influx(args.influx_url, args.influx_database, payload)
                    if payload["name"] == "data_tb":
                        produced += 1
                        if payload["fields"].get("ng_indicator") == "NG":
                            ng_qty += 1

            if batch % 5 == 0 or args.cycles == 1:
                elapsed_total = batch * args.interval * machine_count
                run_seconds = elapsed_total * (profile.availability / 100.0)
                excluded_seconds = elapsed_total * (profile.planned_stop_seconds_per_hour / 3600.0)
                avg_ideal_ct = sum(float(m["ideal_ct"]) for m in machines) / len(machines)
                metrics = calculate_expected_metrics(
                    total_seconds=elapsed_total,
                    run_seconds=run_seconds,
                    excluded_seconds=excluded_seconds,
                    output_qty=produced,
                    ng_qty=ng_qty,
                    ideal_ct=avg_ideal_ct,
                )
                print(
                    f"[Simulator] batch {batch} | output={produced} ng={ng_qty} "
                    f"A={metrics['availability']} P={metrics['performance']} "
                    f"Q={metrics['quality']} OEE={metrics['oee']}"
                )
            else:
                print(f"[Simulator] batch {batch} sent for {machine_count} machines")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n[Simulator] stopped")
    finally:
        if client is not None:
            client.loop_stop()
            client.disconnect()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
