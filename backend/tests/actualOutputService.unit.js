const assert = require("node:assert/strict");

const {
    applyCurrentHourMapOverride,
    applyCurrentHourOverride,
    buildPseudoActualRow,
    groupActualRowsByMachineAndDate,
    sumActualByHour,
    sumActualTotal,
} = require("../services/actualOutputService");

const cached = {
    output: {
        actual_07: 10,
        actual_08: 20,
    },
};
assert.deepEqual(buildPseudoActualRow("AHV-001", new Date("2026-05-10"), cached), {
    machine_name: "AHV-001",
    date: new Date("2026-05-10"),
    model_name: "--",
    actual_07: 10,
    actual_08: 20,
    actual_09: 0,
    actual_10: 0,
    actual_11: 0,
    actual_12: 0,
    actual_13: 0,
    actual_14: 0,
    actual_15: 0,
    actual_16: 0,
    actual_17: 0,
    actual_18: 0,
    actual_19: 0,
    actual_20: 0,
    actual_21: 0,
    actual_22: 0,
    actual_23: 0,
    actual_00: 0,
    actual_01: 0,
    actual_02: 0,
    actual_03: 0,
    actual_04: 0,
    actual_05: 0,
    actual_06: 0,
});

const rows = [
    { machine_name: "AHV-001", date: new Date("2026-05-10"), model_name: "--", actual_07: 100, actual_08: 50 },
    { machine_name: "AHV-001", date: new Date("2026-05-10"), model_name: "MODEL-A", actual_07: 40, actual_08: 0 },
    { machine_name: "AHV-001", date: new Date("2026-05-10"), model_name: "MODEL-B", actual_07: 60, actual_08: 0 },
];
assert.deepEqual(sumActualByHour(rows, ["07", "08"]), {
    actual_07: 100,
    actual_08: 50,
});
assert.equal(sumActualTotal(rows, ["07", "08"]), 150);

const grouped = groupActualRowsByMachineAndDate(rows, (date) => date.toISOString().slice(0, 10));
assert.equal(grouped["AHV-001"]["2026-05-10"].length, 3);

const overriddenExisting = applyCurrentHourOverride([{ machine_name: "AHV-001", date: "2026-05-10", model_name: "--" }], "AHV-001", "2026-05-10", "09", 12);
assert.equal(overriddenExisting[0].actual_09, 12);
assert.deepEqual(applyCurrentHourOverride([], "AHV-001", "2026-05-10", "09", 0), []);
assert.deepEqual(applyCurrentHourOverride([], "AHV-001", "2026-05-10", "09", 12), [{
    machine_name: "AHV-001",
    date: "2026-05-10",
    model_name: "--",
    actual_09: 12,
}]);

assert.deepEqual(applyCurrentHourMapOverride({ "AHV-001": 10 }, {
    "AHV-001": { output_count: 5 },
    "ABR-001": { output_count: 0 },
    "ACP-001": { output_count: 8 },
}), {
    "AHV-001": 15,
    "ACP-001": 8,
});

console.log("actualOutputService unit tests passed");
