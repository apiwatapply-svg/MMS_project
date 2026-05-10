from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import math
import random
from typing import Any


DEFAULT_MACHINES = [
    {"area": "ECM", "type": "AHV", "name": "AHV-001", "model": "Dorado 10D", "ideal_ct": 4.2},
    {"area": "ECM", "type": "AHV", "name": "AHV-002", "model": "Dorado 10D", "ideal_ct": 4.4},
    {"area": "CLASS100", "type": "ABR", "name": "ABR-001", "model": "V4G", "ideal_ct": 3.5},
    {"area": "CLASS100", "type": "ACP", "name": "ACP-002", "model": "Sierra 8D", "ideal_ct": 4.1},
    {"area": "ECM", "type": "ACR", "name": "ACR-001", "model": "Orion 7D", "ideal_ct": 5.0},
    {"area": "CLASS100", "type": "GE2", "name": "GE2-001", "model": "Helios 9D", "ideal_ct": 3.4},
    {"area": "CLASS100", "type": "HEL", "name": "HEL-001", "model": "Nova 6D", "ideal_ct": 4.0},
    {"area": "CLASS100", "type": "LSW", "name": "LSW-001", "model": "Luna 5D", "ideal_ct": 4.7},
    {"area": "CLASS100", "type": "VNS", "name": "VNS-001", "model": "Vega 11D", "ideal_ct": 5.8},
    {"area": "DLC", "type": "DLC", "name": "DLC-002", "model": "Delta 4D", "ideal_ct": 6.4},
]


@dataclass(frozen=True)
class SimulationProfile:
    name: str
    availability: float
    performance: float
    quality: float
    planned_stop_seconds_per_hour: int = 0
    force_status: str | None = None
    ng_rate_pct: float | None = None


@dataclass
class MachineRuntimeState:
    piece_carry: float = 0.0
    ng_carry: float = 0.0
    elapsed_in_hour: float = 0.0
    last_status: str | None = None
    seq: int = 0
    total_seconds: float = 0.0
    run_seconds: float = 0.0
    excluded_seconds: float = 0.0
    output_count: int = 0
    ng_count: int = 0


SCENARIOS = {
    "stable": SimulationProfile("stable", availability=95, performance=96, quality=98.5, planned_stop_seconds_per_hour=120),
    "target_ramp": SimulationProfile("target_ramp", availability=98, performance=108, quality=99, planned_stop_seconds_per_hour=0),
    "downtime": SimulationProfile("downtime", availability=72, performance=92, quality=98, planned_stop_seconds_per_hour=300),
    "quality_issue": SimulationProfile("quality_issue", availability=92, performance=95, quality=88, planned_stop_seconds_per_hour=120),
    "planned_stop": SimulationProfile("planned_stop", availability=100, performance=0, quality=100, planned_stop_seconds_per_hour=3600, force_status="Plan_Stop"),
    "alarm": SimulationProfile("alarm", availability=0, performance=0, quality=100, planned_stop_seconds_per_hour=0, force_status="MC_Alarm"),
}


def create_machine_state(machine: dict[str, Any]) -> MachineRuntimeState:
    return MachineRuntimeState()


def calculate_hourly_target(ideal_ct: float, efficiency_target: float, planned_stop_seconds: int = 0) -> int:
    operating_seconds = max(0.0, 3600.0 - float(planned_stop_seconds or 0))
    if ideal_ct <= 0:
        return 0
    return math.floor((operating_seconds / ideal_ct) * (float(efficiency_target or 0) / 100.0))


def calculate_expected_metrics(
    total_seconds: float,
    run_seconds: float,
    excluded_seconds: float,
    output_qty: int,
    ng_qty: int,
    ideal_ct: float,
) -> dict[str, float]:
    operating_seconds = max(0.0, total_seconds - excluded_seconds)
    availability = (run_seconds / operating_seconds) * 100 if operating_seconds > 0 else 0
    performance = ((output_qty * ideal_ct) / run_seconds) * 100 if run_seconds > 0 and ideal_ct > 0 else 0
    quality = ((output_qty - ng_qty) / output_qty) * 100 if output_qty > 0 else 0
    oee = (availability / 100) * (performance / 100) * (quality / 100) * 100 if min(availability, performance, quality) > 0 else 0
    return {
        "availability": round(availability, 2),
        "performance": round(performance, 2),
        "quality": round(quality, 2),
        "oee": round(oee, 2),
    }


def get_profile(name: str, **overrides: Any) -> SimulationProfile:
    base = SCENARIOS.get(name, SCENARIOS["stable"])
    force_status = overrides.get("force_status", base.force_status)
    if force_status in ("", "auto", "Auto"):
        force_status = base.force_status
    values = {
        "name": base.name,
        "availability": float(overrides.get("availability", base.availability)),
        "performance": float(overrides.get("performance", base.performance)),
        "quality": float(overrides.get("quality", base.quality)),
        "planned_stop_seconds_per_hour": int(overrides.get("planned_stop_seconds_per_hour", base.planned_stop_seconds_per_hour)),
        "force_status": force_status,
        "ng_rate_pct": overrides.get("ng_rate_pct", base.ng_rate_pct),
    }
    return SimulationProfile(**values)


def current_status(profile: SimulationProfile, elapsed_in_hour: float) -> str:
    if profile.force_status:
        return profile.force_status

    planned_stop = max(0, min(3600, profile.planned_stop_seconds_per_hour))
    if planned_stop > 0 and elapsed_in_hour >= 3600 - planned_stop:
        return "Plan_Stop"

    operating_seconds = max(0.0, 3600.0 - planned_stop)
    downtime_seconds = operating_seconds * max(0.0, 1.0 - (profile.availability / 100.0))
    downtime_start = operating_seconds * 0.45
    operating_elapsed = min(elapsed_in_hour, operating_seconds)
    if downtime_start <= operating_elapsed < downtime_start + downtime_seconds:
        return "Stop_Time"

    return "Run_Time"


def now_parts() -> tuple[datetime, str, str, str, str]:
    utc_now = datetime.now(timezone.utc)
    local_now = utc_now.astimezone(timezone(timedelta(hours=7)))
    shift = "A" if 7 <= local_now.hour < 15 else "B" if 15 <= local_now.hour < 23 else "C"
    return (
        utc_now,
        utc_now.strftime("%Y-%m-%d %H:%M:%S"),
        local_now.strftime("%Y-%m-%d"),
        local_now.strftime("%H:%M:%S"),
        shift,
    )


def build_data_payload(machine: dict[str, Any], state: MachineRuntimeState, profile: SimulationProfile, seq: int, is_ng: bool) -> dict[str, Any]:
    utc_now, utc_text, date_local, time_local, shift = now_parts()
    ideal_ct = float(machine["ideal_ct"])
    performance_rate = max(0.01, profile.performance / 100.0)
    actual_ct = round(ideal_ct / performance_rate, 2)
    stations = ["OK", "OK", "OK", "OK", "OK"]
    if is_ng:
        stations[seq % len(stations)] = "NG"

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
            "cycle_time": actual_ct,
            "date_local": date_local,
            "emp_no": f"OP{100 + (seq % 20)}",
            "id": int(utc_now.timestamp() * 1_000_000_000) + seq,
            "judg_result": ",".join(stations),
            "lot_no": f"LOT-{machine['type']}-{seq // 100:04d}",
            "lot_size": calculate_hourly_target(ideal_ct, profile.performance, profile.planned_stop_seconds_per_hour),
            "ng_indicator": "NG" if is_ng else "",
            "shift": shift,
            "target_per_hour": calculate_hourly_target(ideal_ct, profile.performance, profile.planned_stop_seconds_per_hour),
            "time_interval": actual_ct,
            "time_local": time_local,
        },
        "timestamp": int(utc_now.timestamp()),
    }


def build_status_payload(machine: dict[str, Any], status: str) -> dict[str, Any]:
    utc_now, utc_text, date_local, time_local, shift = now_parts()
    return {
        "name": "status_tb",
        "tags": {
            "machine_name": machine["name"],
            "machine_type": machine["type"],
        },
        "fields": {
            "Date_Time_UTC": utc_text,
            "Status": status,
            "date_local": date_local,
            "shift": shift,
            "time_local": time_local,
        },
        "timestamp": int(utc_now.timestamp()),
    }


def build_alarm_payload(machine: dict[str, Any], alarm: str) -> dict[str, Any]:
    utc_now, utc_text, date_local, time_local, shift = now_parts()
    return {
        "name": "alarm_tb",
        "tags": {
            "machine_name": machine["name"],
            "machine_type": machine["type"],
        },
        "fields": {
            "Date_Time_UTC": utc_text,
            "Alarm": alarm,
            "Device": f"{machine['type']}-SIM",
            "date_local": date_local,
            "shift": shift,
            "time_local": time_local,
        },
        "timestamp": int(utc_now.timestamp()),
    }


def generate_machine_events(
    machine: dict[str, Any],
    state: MachineRuntimeState,
    profile: SimulationProfile,
    elapsed_seconds: float,
    seq_base: int,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    state.elapsed_in_hour = (state.elapsed_in_hour + elapsed_seconds) % 3600
    state.total_seconds += elapsed_seconds
    status = current_status(profile, state.elapsed_in_hour)
    if status == "Run_Time":
        state.run_seconds += elapsed_seconds
    elif status in ("Plan_Stop", "Break_Time") or "Preventive" in status:
        state.excluded_seconds += elapsed_seconds

    if status != state.last_status:
        events.append(build_status_payload(machine, status))
        state.last_status = status

    if status == "MC_Alarm":
        events.append(build_alarm_payload(machine, "Simulated machine alarm"))

    if status != "Run_Time":
        return events

    ideal_ct = float(machine["ideal_ct"])
    state.piece_carry += (elapsed_seconds * (profile.performance / 100.0)) / ideal_ct
    piece_count = int(state.piece_carry)
    state.piece_carry -= piece_count

    ng_rate = max(0.0, min(0.05, (profile.ng_rate_pct / 100.0) if profile.ng_rate_pct is not None else (1.0 - (profile.quality / 100.0))))
    for index in range(piece_count):
        state.seq += 1
        state.output_count += 1
        state.ng_carry += ng_rate * random.uniform(0.6, 1.4)
        max_ng_count = math.floor(state.output_count * ng_rate)
        is_ng = state.ng_carry >= 1 and state.ng_count < max_ng_count
        if is_ng:
            state.ng_carry -= 1
            state.ng_count += 1
        events.append(build_data_payload(machine, state, profile, seq_base + state.seq + index, is_ng))

    return events
