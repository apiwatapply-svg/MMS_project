const assert = require("assert");
const { __private } = require("../controllers/OeeUpdateController");

function run() {
    const date = __private.parseDateToUtcMidnight("2026-05-10");
    assert.strictEqual(date.toISOString(), "2026-05-10T00:00:00.000Z");

    assert.strictEqual(__private.normalizeNgQty("3", 100), 3);
    assert.strictEqual(__private.normalizeNgQty("-5", 100), 0);
    assert.strictEqual(__private.normalizeNgQty("999", 100), 100);
    assert.strictEqual(__private.normalizeNgQty("bad-value", 100), 0);
    assert.strictEqual(__private.normalizeNgQty("5", 0), 0);

    const payload = __private.buildRealtimeUpdatePayload("2026-05-10", [
        {
            machine_name: "MC-01",
            availability: 95.12,
            performance: 96.34,
            quality: 98.5,
            oee_value: 90.1,
            ng_qty: 4,
        },
    ]);

    assert.strictEqual(payload.shiftDate, "2026-05-10");
    assert.strictEqual(payload.machines["MC-01"].daily.oeeMode, "auto");
    assert.strictEqual(payload.machines["MC-01"].daily.ngQty, 4);

    console.log("oeeUpdateController.unit.js passed");
}

run();
