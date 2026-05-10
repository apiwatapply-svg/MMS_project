const assert = require("assert");
const cacheService = require("../services/cacheService");

function run() {
    cacheService.__private.resetForTest();
    cacheService.__private.setTargetForTest("MC-01", "2026-05-10", {
        target_07: 100,
        target_08: 100,
    });

    cacheService.updateHour("MC-01", "07", 50, 4, 75.555);
    cacheService.updateHour("MC-01", "08", 25, 5, 60.444);

    const hourly = cacheService.getHourlyArrays("MC-01");
    assert.strictEqual(hourly.outputActual[0], 50);
    assert.strictEqual(hourly.outputActual[1], 25);
    assert.strictEqual(hourly.outputActualAccum[1], 75);
    assert.strictEqual(hourly.cycleTimeActual[0], 4);
    assert.strictEqual(hourly.efficiencyActual[0], 75.56);

    const fullDay = cacheService.getFullDay("MC-01");
    assert.strictEqual(fullDay.overall.totalOutput, 75);
    assert.strictEqual(fullDay.overall.avgCycleTime, 4.33);

    cacheService.updateHourRuntime("MC-01", "07", 3540.126, 60.984);
    const runtime = cacheService.getRuntime("MC-01");
    assert.strictEqual(runtime.runtime[0], 3540.13);
    assert.strictEqual(runtime.excluded[0], 60.98);

    cacheService.updateHourAvailability("MC-01", "07", 98.765);
    assert.strictEqual(cacheService.getAvailability("MC-01")[0], 98.77);

    assert.strictEqual(cacheService.updateHourNg("MC-01", "07", 2), true);
    assert.strictEqual(cacheService.updateHourNg("MC-01", "08", 3), true);
    assert.strictEqual(cacheService.getNgPastHours("MC-01"), 5);
    assert.strictEqual(cacheService.isNgHourConfirmed("MC-01", "07"), true);
    assert.strictEqual(cacheService.isNgHourConfirmed("MC-01", "09"), false);

    cacheService.__private.resetForTest();
    assert.strictEqual(cacheService.getFullDay("MC-01"), null);
    assert.deepStrictEqual(cacheService.getHourlyArrays("UNKNOWN").outputActual, new Array(24).fill(0));

    console.log("cacheService.unit.js passed");
}

run();
