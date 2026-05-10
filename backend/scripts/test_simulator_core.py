import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from simulator_core import (
    MachineRuntimeState,
    SimulationProfile,
    calculate_expected_metrics,
    calculate_hourly_target,
    create_machine_state,
    generate_machine_events,
)


class SimulatorCoreTests(unittest.TestCase):
    def test_hourly_target_uses_operating_time_ideal_ct_and_efficiency(self):
        self.assertEqual(
            calculate_hourly_target(ideal_ct=4.0, efficiency_target=90, planned_stop_seconds=600),
            675,
        )

    def test_expected_metrics_follow_oee_formula(self):
        metrics = calculate_expected_metrics(
            total_seconds=3600,
            run_seconds=3000,
            excluded_seconds=300,
            output_qty=690,
            ng_qty=14,
            ideal_ct=4.0,
        )

        self.assertEqual(metrics["availability"], 90.91)
        self.assertEqual(metrics["performance"], 92.0)
        self.assertEqual(metrics["quality"], 97.97)
        self.assertEqual(metrics["oee"], 81.94)

    def test_running_events_are_rate_limited_by_cycle_time(self):
        profile = SimulationProfile(
            name="stable",
            availability=100,
            performance=100,
            quality=100,
            planned_stop_seconds_per_hour=0,
        )
        machine = {
            "area": "ECM",
            "type": "AHV",
            "name": "AHV-001",
            "model": "Dorado 10D",
            "ideal_ct": 4.0,
        }
        state = create_machine_state(machine)

        first = generate_machine_events(machine, state, profile, elapsed_seconds=1.0, seq_base=100)
        second = generate_machine_events(machine, state, profile, elapsed_seconds=3.0, seq_base=200)

        self.assertEqual(len([p for p in first if p["name"] == "data_tb"]), 0)
        self.assertEqual(len([p for p in second if p["name"] == "data_tb"]), 1)
        self.assertIsInstance(state, MachineRuntimeState)

    def test_one_second_scans_do_not_publish_output_before_cycle_time(self):
        profile = SimulationProfile(
            name="stable",
            availability=100,
            performance=100,
            quality=100,
            planned_stop_seconds_per_hour=0,
        )
        machine = {
            "area": "ECM",
            "type": "AHV",
            "name": "AHV-001",
            "model": "Dorado 10D",
            "ideal_ct": 4.2,
        }
        state = create_machine_state(machine)

        first_four_seconds = [
            payload
            for second in range(4)
            for payload in generate_machine_events(machine, state, profile, elapsed_seconds=1.0, seq_base=second * 100)
            if payload["name"] == "data_tb"
        ]
        fifth_second = [
            payload
            for payload in generate_machine_events(machine, state, profile, elapsed_seconds=1.0, seq_base=500)
            if payload["name"] == "data_tb"
        ]

        self.assertEqual(first_four_seconds, [])
        self.assertEqual(len(fifth_second), 1)

    def test_plan_stop_emits_status_but_no_output(self):
        profile = SimulationProfile(
            name="plan_stop",
            availability=100,
            performance=100,
            quality=100,
            planned_stop_seconds_per_hour=3600,
            force_status="Plan_Stop",
        )
        machine = {
            "area": "ECM",
            "type": "AHV",
            "name": "AHV-001",
            "model": "Dorado 10D",
            "ideal_ct": 4.0,
        }
        state = create_machine_state(machine)

        events = generate_machine_events(machine, state, profile, elapsed_seconds=30.0, seq_base=100)

        self.assertEqual([p["name"] for p in events], ["status_tb"])
        self.assertEqual(events[0]["fields"]["Status"], "Plan_Stop")
        self.assertEqual(state.output_count, 0)
        self.assertEqual(state.ng_count, 0)

    def test_preventive_and_qc_emit_status_but_no_output(self):
        machine = {
            "area": "ECM",
            "type": "AHV",
            "name": "AHV-001",
            "model": "Dorado 10D",
            "ideal_ct": 4.0,
        }
        for status in ("Preventive", "QC"):
            profile = SimulationProfile(
                name=status,
                availability=100,
                performance=100,
                quality=100,
                planned_stop_seconds_per_hour=0,
                force_status=status,
            )
            state = create_machine_state(machine)

            events = generate_machine_events(machine, state, profile, elapsed_seconds=30.0, seq_base=100)

            self.assertEqual([p["name"] for p in events], ["status_tb"])
            self.assertEqual(events[0]["fields"]["Status"], status)
            self.assertEqual(state.output_count, 0)
            self.assertEqual(state.ng_count, 0)
            self.assertEqual(state.excluded_seconds, 30.0)

    def test_ng_count_is_randomized_but_capped_by_configured_rate(self):
        profile = SimulationProfile(
            name="stable",
            availability=100,
            performance=100,
            quality=100,
            planned_stop_seconds_per_hour=0,
            ng_rate_pct=5,
        )
        machine = {
            "area": "ECM",
            "type": "AHV",
            "name": "AHV-001",
            "model": "Dorado 10D",
            "ideal_ct": 1.0,
        }
        state = create_machine_state(machine)

        events = generate_machine_events(machine, state, profile, elapsed_seconds=1000.0, seq_base=100)
        output_events = [p for p in events if p["name"] == "data_tb"]
        ng_events = [p for p in output_events if p["fields"]["ng_indicator"] == "NG"]

        self.assertEqual(state.output_count, len(output_events))
        self.assertEqual(state.ng_count, len(ng_events))
        self.assertLessEqual(state.ng_count, int(state.output_count * 0.05))
        self.assertEqual(state.output_count, (state.output_count - state.ng_count) + state.ng_count)


if __name__ == "__main__":
    unittest.main()
