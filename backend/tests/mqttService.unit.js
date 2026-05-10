const assert = require("assert");
const mqttService = require("../services/mqttService");

function run() {
    const { __private } = mqttService;

    assert.strictEqual(__private.truncateDbText(null, 5), null);
    assert.strictEqual(__private.truncateDbText("abcdef", 3), "abc");
    assert.strictEqual(__private.truncateDbText(123456, 4), "1234");

    assert.strictEqual(__private.isDbValueTooLongError({ code: "P2000" }), true);
    assert.strictEqual(__private.isDbValueTooLongError({ message: "String or binary data would be truncated" }), true);
    assert.strictEqual(__private.isDbValueTooLongError({ message: "other error" }), false);
    assert.strictEqual(__private.getIsUTC("ANY-MACHINE"), false);

    mqttService.restoreMachineStateMem({
        "MC-01": {
            machine_name: "MC-01",
            current_hour_actual: 7,
            last_update: "2026-05-10T00:00:00.000Z",
        },
    });
    const restored = mqttService.getMachineStateMem().get("MC-01");
    assert.strictEqual(restored.current_hour_actual, 7);
    assert.ok(restored.last_update instanceof Date);

    mqttService.updateStateFromMssqlPoller("MC-02", "Run_Time", "No Alarm");
    const created = mqttService.getMachineStateMem().get("MC-02");
    assert.strictEqual(created.live_status, "Run_Time");
    assert.strictEqual(created.live_alarm, "No Alarm");

    console.log("mqttService.unit.js passed");
}

run();
