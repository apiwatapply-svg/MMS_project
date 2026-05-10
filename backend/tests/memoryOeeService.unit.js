const assert = require("node:assert/strict");

const memoryOeeService = require("../services/memoryOeeService");

memoryOeeService.getStateMap().clear();

memoryOeeService.processStatusChange("AHV-001", "Run_Time", new Date("2026-05-10T00:00:00.000Z"));
memoryOeeService.processStatusChange("AHV-001", "Stop_Time", new Date("2026-05-10T00:20:00.000Z"));
memoryOeeService.processStatusChange("AHV-001", "Plan_Stop", new Date("2026-05-10T00:35:00.000Z"));

assert.deepEqual(memoryOeeService.getDurationsNow("AHV-001", new Date("2026-05-10T00:45:00.000Z")), {
    runTimeSec: 1200,
    excludedSec: 600,
    totalSec: 2700,
});

memoryOeeService.processStatusChange("AHV-001", "Run_Time", new Date("2026-05-10T00:45:00.000Z"));
assert.deepEqual(memoryOeeService.getDurationsNow("AHV-001", new Date("2026-05-10T01:00:00.000Z")), {
    runTimeSec: 2100,
    excludedSec: 600,
    totalSec: 3600,
});

memoryOeeService.setManualNg("AHV-001", 7);
assert.equal(memoryOeeService.getManualNg("AHV-001"), 7);

memoryOeeService.resetShift("AHV-001", "2026-05-11");
assert.deepEqual(memoryOeeService.getDurationsNow("AHV-001", new Date("2026-05-11T00:10:00.000Z")), {
    runTimeSec: 0,
    excludedSec: 0,
    totalSec: 0,
});

memoryOeeService.restoreStateMap({
    "ABR-001": {
        runTimeSec: 60,
        excludedSec: 30,
        lastStatus: "Run_Time",
        lastStatusTime: "2026-05-10T00:01:00.000Z",
        shiftDate: "2026-05-10",
        manualNgQty: 2,
    },
});
assert.equal(memoryOeeService.getStateMap().get("ABR-001").lastStatusTime instanceof Date, true);
assert.equal(memoryOeeService.getManualNg("ABR-001"), 2);

memoryOeeService.getStateMap().clear();

console.log("memoryOeeService unit tests passed");
