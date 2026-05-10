const assert = require("node:assert/strict");

const { __private } = require("../services/reportDashboardService");

assert.equal(__private.isFutureMonth("2026-06", "2026-05-08"), true);
assert.equal(__private.isFutureMonth("2026-05", "2026-05-08"), false);
assert.equal(__private.isFutureMonth("2026-04", "2026-05-08"), false);

assert.equal(__private.effectiveMonthDays("2026-04", "2026-05-08"), 30);
assert.equal(__private.effectiveMonthDays("2026-05", "2026-05-08"), 8);
assert.equal(__private.effectiveMonthDays("2026-06", "2026-05-08"), 0);

const monthlyRows = __private.aggregateMonthlyRows({
    buckets: [
        { key: "2026-04", label: "Apr" },
        { key: "2026-06", label: "Jun" },
    ],
    targets: [{ date: new Date("2026-04-01"), accum_target: 300, eff_target: 95, cycle_time_target: 10 }],
    actuals: [],
    cycles: [],
    avails: [],
    effs: [],
    oees: [],
}, "2026-05-08");
assert.deepEqual(monthlyRows.map((row) => row.key), ["2026-04", "2026-06"]);
assert.equal(monthlyRows[0].outputTargetPerDay, 10);
assert.equal(monthlyRows[1].outputTargetPerDay, null);
assert.equal(monthlyRows[1].availability, null);

const buckets = [
    {
        key: "2026-05-10",
        label: "10",
        start: new Date("2026-05-10T00:00:00.000Z"),
        end: new Date("2026-05-11T00:00:00.000Z"),
    },
];
const dailyRows = __private.aggregateDailyRows({
    buckets,
    targets: [{ date: new Date("2026-05-10"), accum_target: 1000, eff_target: 90, cycle_time_target: 4 }],
    actuals: [
        { machine_name: "AHV-001", date: new Date("2026-05-10"), model_name: "--", actual_07: 10, actual_08: 10 },
        { machine_name: "AHV-001", date: new Date("2026-05-10"), model_name: "MODEL-A", actual_07: 25, actual_08: 0 },
        { machine_name: "ABR-001", date: new Date("2026-05-10"), model_name: "--", actual_07: 5, actual_08: 0 },
    ],
    cycles: [{ date: new Date("2026-05-10"), cycle_time: 4.2 }],
    avails: [{ date: new Date("2026-05-10"), avail_actual: 85 }],
    effs: [{ date: new Date("2026-05-10"), eff_actual: 80 }],
    oees: [{ date: new Date("2026-05-10"), availability: 77, performance: 92, quality: 98, oee_value: 76.64 }],
});
assert.equal(dailyRows[0].output, 40);
assert.equal(dailyRows[0].outputTarget, 1000);
assert.equal(dailyRows[0].availability, 85);
assert.equal(dailyRows[0].performance, 92);
assert.equal(dailyRows[0].quality, 98);
assert.equal(dailyRows[0].oee, 76.64);

const downtime = __private.aggregateDowntime([
    { MC: "AHV-001", Datetime: new Date("2026-05-10T00:00:00.000Z"), MCStatus: "MC_Alarm" },
    { MC: "AHV-001", Datetime: new Date("2026-05-10T00:10:00.000Z"), MCStatus: "MM_Repair" },
    { MC: "AHV-001", Datetime: new Date("2026-05-10T00:25:00.000Z"), MCStatus: "Setter_Adjust" },
    { MC: "AHV-001", Datetime: new Date("2026-05-10T00:40:00.000Z"), MCStatus: "Run_Time" },
], [{
    key: "2026-05-10",
    label: "10",
    start: new Date("2026-05-10T00:00:00.000Z"),
    end: new Date("2026-05-10T01:00:00.000Z"),
}]);
assert.deepEqual(downtime.get("2026-05-10").downtime, {
    alarm: 10,
    maintenance: 15,
    adjust: 15,
});

console.log("reportDashboardService unit tests passed");
