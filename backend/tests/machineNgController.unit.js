const assert = require("assert");
const { __private } = require("../controllers/MachineNgController");

function run() {
    const dailyData = {
        "2026-05-10": {
            has_production: true,
            stations: {},
            Machine_Output: 100,
            Total_Output: 100,
            All: 8,
            Visual_NG: "-",
            Over_Reject: "-",
            Over_Reject_Percent: "-",
        },
    };

    __private.applyVisualNgRows(dailyData, [
        {
            machine_name: "MC-01",
            date: new Date("2026-05-10T00:00:00.000Z"),
            ng_qty: 3,
            quality: 97,
            oee_value: 90,
        },
    ], "MC-01", "manual");

    assert.strictEqual(dailyData["2026-05-10"].Visual_NG, 3);
    assert.strictEqual(dailyData["2026-05-10"].Over_Reject, 5);
    assert.strictEqual(dailyData["2026-05-10"].Over_Reject_Percent, 5);

    const untouched = {
        "2026-05-11": {
            has_production: false,
            stations: {},
            Machine_Output: "-",
            Total_Output: "-",
            All: 0,
            Visual_NG: "-",
            Over_Reject: "-",
            Over_Reject_Percent: "-",
        },
    };
    __private.applyVisualNgRows(untouched, [
        {
            machine_name: "MC-01",
            date: new Date("2026-05-11T00:00:00.000Z"),
            ng_qty: 0,
            quality: 0,
            oee_value: 0,
        },
    ], "MC-01", "manual");
    assert.strictEqual(untouched["2026-05-11"].Visual_NG, "-");

    console.log("machineNgController.unit.js passed");
}

run();
