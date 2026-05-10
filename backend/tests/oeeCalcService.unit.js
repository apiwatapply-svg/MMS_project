const assert = require("node:assert/strict");

const {
    calcAvailability,
    calcAutoOeeMetrics,
    calcMcStatusDurations,
    calcMcStatusDurationsPerHour,
    calcManualNgMetrics,
    calcOeeValue,
    calcPerformance,
    calcRejectSummary,
    calcVisualQuality,
    isExcludedStatus,
    sumHourlyFields,
    sumHourlyRows,
} = require("../services/oeeCalcService");
const { sumActualByHour, sumActualTotal } = require("../services/actualOutputService");

assert.equal(isExcludedStatus("Plan_Stop"), true);
assert.equal(isExcludedStatus("Break_Time"), true);
assert.equal(isExcludedStatus("Preventive"), true);
assert.equal(isExcludedStatus("Preventive_Maintenance"), true);
assert.equal(isExcludedStatus("QC"), false);
assert.equal(isExcludedStatus("Stop_Time"), false);

const targetRow = {
    target_07: 10,
    target_08: 20,
    target_09: null,
};
assert.equal(sumHourlyFields(targetRow, "target", ["07", "08", "09"]), 30);
assert.equal(sumHourlyRows([targetRow, { target_07: 5, target_08: 0, target_09: 1 }], "target", ["07", "08", "09"]), 36);

assert.deepEqual(calcRejectSummary(100, 12), {
    rejectQty: 12,
    totalOutput: 88,
    rejectPercent: 12,
});
assert.deepEqual(calcRejectSummary(0, 12), {
    rejectQty: 12,
    totalOutput: 0,
    rejectPercent: 0,
});

assert.equal(calcAvailability(3000, 300, 3600), 90.9090909090909);
assert.equal(calcAvailability(0, 3600, 3600), 0);
assert.equal(calcAvailability(4000, 0, 3600), 100);

assert.equal(calcPerformance(690, 4, 3000), 92);
assert.equal(calcPerformance(2000, 4, 3000), 150);
assert.equal(calcPerformance(100, 0, 3000), 0);

assert.equal(calcVisualQuality(100, 5), 95);
assert.equal(calcVisualQuality(100, 120), 0);
assert.equal(calcVisualQuality(0, 1), 0);

assert.equal(calcOeeValue(80, 90, 95), 68.4);
assert.equal(calcOeeValue(0, 90, 95, 12.3), 12.3);

assert.deepEqual(calcManualNgMetrics(100, 5, 80, 90), {
    quality: 95,
    oeeValue: 68.4,
});
assert.deepEqual(calcManualNgMetrics(0, 5, 80, 90), {
    quality: 0,
    oeeValue: 0,
});

assert.deepEqual(
    calcAutoOeeMetrics({
        totalOutput: 100,
        ngQty: 10,
        availability: 80,
        idealCT: 2,
        runTimeSeconds: 200,
    }),
    {
        outputForOee: 100,
        performance: 100,
        quality: 90,
        oeeValue: 72,
    }
);

const shiftStart = new Date("2026-05-10T00:00:00.000Z");
const shiftEnd = new Date("2026-05-10T01:00:00.000Z");
assert.deepEqual(
    calcMcStatusDurations([
        { Datetime: new Date("2026-05-10T00:00:00.000Z"), MCStatus: "Run_Time" },
        { Datetime: new Date("2026-05-10T00:20:00.000Z"), MCStatus: "Stop_Time" },
        { Datetime: new Date("2026-05-10T00:35:00.000Z"), MCStatus: "Plan_Stop" },
        { Datetime: new Date("2026-05-10T00:45:00.000Z"), MCStatus: "Run_Time" },
    ], shiftStart, shiftEnd),
    {
        runTimeSeconds: 2100,
        excludedSeconds: 600,
        totalSeconds: 3600,
    }
);
assert.deepEqual(calcMcStatusDurations([], shiftStart, shiftEnd), {
    runTimeSeconds: 0,
    excludedSeconds: 0,
    totalSeconds: 3600,
});
assert.deepEqual(
    calcMcStatusDurationsPerHour([
        { Datetime: new Date("2026-05-10T00:00:00.000Z"), MCStatus: "Run_Time" },
        { Datetime: new Date("2026-05-10T01:00:00.000Z"), MCStatus: "Preventive" },
    ], shiftStart, 2),
    [
        { runTimeSeconds: 3600, excludedSeconds: 0, totalSeconds: 3600 },
        { runTimeSeconds: 0, excludedSeconds: 3600, totalSeconds: 3600 },
    ]
);

const actualRows = [
    { model_name: "--", actual_07: 5, actual_08: 7 },
    { model_name: "MODEL-A", actual_07: 2, actual_08: 0 },
    { model_name: "MODEL-B", actual_07: 3, actual_08: 0 },
];
assert.deepEqual(sumActualByHour(actualRows, ["07", "08"]), {
    actual_07: 5,
    actual_08: 7,
});
assert.equal(sumActualTotal(actualRows, ["07", "08"]), 12);

console.log("oeeCalcService unit tests passed");
