const assert = require("assert");
const oeeUpdateController = require("../controllers/OeeUpdateController");
const realtimeService = require("../services/realtimeService");

function run() {
    const listResults = oeeUpdateController.__private.buildAutoListResults({
        machines: [
            { machine_name: "MC-01", machine_type: "A", machine_area: "AREA-1" },
            { machine_name: "MC-02", machine_type: "B", machine_area: "AREA-1" },
        ],
        oeeRecords: [
            { machine_name: "MC-01", ng_qty: 2, quality: 98, availability: 90, performance: 95, oee_value: 83.79 },
        ],
        outputRecords: [
            { machine_name: "MC-01", Overall: 100 },
            { machine_name: "MC-02", Overall: 0 },
        ],
        shiftDate: "2026-05-10",
    });

    assert.strictEqual(listResults.length, 2);
    assert.deepStrictEqual(listResults.map(row => row.oee_mode), ["auto", "auto"]);
    assert.strictEqual(listResults[0].display_date, "2026-05-10");
    assert.strictEqual(listResults[0].ng_qty, 2);
    assert.strictEqual(listResults[1].ng_qty, 0);
    assert.ok(!("manual" in listResults[0]));
    assert.ok(!("over_reject_qty" in listResults[0]));

    const dailyPayload = realtimeService.__private.buildAutoDailyPayload({
        availability: 90,
        performance: 80,
        totalOutput: 100,
        ngQty: 5,
    });
    assert.strictEqual(dailyPayload.oeeMode, "auto");
    assert.strictEqual(dailyPayload.ngQty, 5);
    assert.strictEqual(dailyPayload.quality, 95);
    assert.strictEqual(dailyPayload.oee, 68.4);
    assert.ok(!("over_reject_qty" in dailyPayload));

    const clampedPayload = realtimeService.__private.buildAutoDailyPayload({
        availability: 90,
        performance: 80,
        totalOutput: 10,
        ngQty: 99,
    });
    assert.strictEqual(clampedPayload.ngQty, 10);
    assert.strictEqual(clampedPayload.quality, 0);
    assert.strictEqual(clampedPayload.oee, 0);

    console.log("autoOnlyPolicy.unit.js passed");
}

run();
