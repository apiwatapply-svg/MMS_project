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


if __name__ == "__main__":
    unittest.main()
