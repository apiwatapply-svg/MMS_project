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
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from typing import Any

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None


DEFAULT_MACHINES = [
    {"area": "ECM", "type": "AHV", "name": "AHV-001", "model": "Dorado 10D", "ct": (3.8, 5.2)},
    {"area": "ECM", "type": "AHV", "name": "AHV-002", "model": "Dorado 10D", "ct": (3.8, 5.2)},
    {"area": "CLASS100", "type": "ABR", "name": "ABR-001", "model": "V4G", "ct": (2.6, 4.8)},
    {"area": "CLASS100", "type": "ACP", "name": "ACP-002", "model": "Sierra 8D", "ct": (3.0, 5.5)},
    {"area": "ECM", "type": "ACR", "name": "ACR-001", "model": "Orion 7D", "ct": (4.0, 6.2)},
    {"area": "CLASS100", "type": "GE2", "name": "GE2-001", "model": "Helios 9D", "ct": (2.8, 4.4)},
    {"area": "CLASS100", "type": "HEL", "name": "HEL-001", "model": "Nova 6D", "ct": (3.2, 5.0)},
    {"area": "CLASS100", "type": "LSW", "name": "LSW-001", "model": "Luna 5D", "ct": (3.5, 5.7)},
    {"area": "CLASS100", "type": "VNS", "name": "VNS-001", "model": "Vega 11D", "ct": (4.2, 6.8)},
    {"area": "DLC", "type": "DLC", "name": "DLC-002", "model": "Delta 4D", "ct": (5.0, 7.5)},
]

STATUSES = ["Run_Time", "Run_Time", "Run_Time", "Plan_Stop", "Stop_Time", "MC_Alarm"]
ALARMS = [
    "Tray clamp timeout",
    "Vacuum pressure low",
    "Part transfer sensor mismatch",
    "Axis home position warning",
]


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
    timestamp_ns = int(payload["timestamp"]) * 1_000_000_000
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
        raise RuntimeError("Missing dependency: install paho-mqtt with `py -m pip install paho-mqtt`.")

    parsed = parse_mqtt_url(mqtt_url)
    client = mqtt.Client(client_id=f"mms-simulator-{random.randint(1000, 9999)}")
    if parsed["username"]:
        client.username_pw_set(parsed["username"], parsed["password"])
    client.connect(parsed["host"], parsed["port"], keepalive=30)
    client.loop_start()
    return client


def main() -> int:
    parser = argparse.ArgumentParser(description="Simulate MMS machine MQTT and InfluxDB data.")
    parser.add_argument("--mqtt-url", default=env("MQTT_URL", "mqtt://127.0.0.1:1883"))
    parser.add_argument("--influx-url", default=env("INFLUX_URL", f"http://{env('INFLUX_HOST', '127.0.0.1')}:{env('INFLUX_PORT', '8086')}"))
    parser.add_argument("--influx-database", default=env("INFLUX_DATABASE", "machine_db"))
    parser.add_argument("--types", type=int, default=8, help="Number of machine types to simulate, 1-10.")
    parser.add_argument("--interval", type=float, default=1.0, help="Delay between batches in seconds.")
    parser.add_argument("--cycles", type=int, default=120, help="Number of batches. Use 0 for continuous mode.")
    parser.add_argument("--no-influx", action="store_true", help="Publish MQTT only.")
    parser.add_argument("--status-every", type=int, default=8, help="Publish status events every N batches.")
    parser.add_argument("--alarm-every", type=int, default=25, help="Publish alarm events every N batches.")
    args = parser.parse_args()

    machine_count = max(1, min(args.types, len(DEFAULT_MACHINES)))
    machines = DEFAULT_MACHINES[:machine_count]

    client = connect_mqtt(args.mqtt_url)
    print(f"[MQTT] connected to {args.mqtt_url}")
    if not args.no_influx:
        print(f"[InfluxDB] writing to {args.influx_url}/{args.influx_database}")
    print(f"[Simulator] machines: {', '.join(m['name'] for m in machines)}")

    batch = 0
    try:
        while args.cycles == 0 or batch < args.cycles:
            batch += 1
            for idx, machine in enumerate(machines):
                payloads = [build_data_payload(machine, batch * 100 + idx)]
                if args.status_every > 0 and batch % args.status_every == 0:
                    payloads.append(build_status_payload(machine))
                if args.alarm_every > 0 and batch % args.alarm_every == 0:
                    payloads.append(build_alarm_payload(machine))

                for payload in payloads:
                    topic = f"factory/{machine['type']}/{machine['name']}/{payload['name']}"
                    client.publish(topic, json.dumps(payload), qos=1)
                    if not args.no_influx:
                        write_influx(args.influx_url, args.influx_database, payload)

            print(f"[Simulator] batch {batch} sent for {machine_count} machines")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n[Simulator] stopped")
    finally:
        client.loop_stop()
        client.disconnect()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
