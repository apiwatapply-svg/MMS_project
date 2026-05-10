const assert = require("assert");
const {
    calculateTargets,
    shiftPatternToActiveHours,
    HOURS_ORDER,
} = require("../controllers/PlanConfigController");

function sumHourlyTargets(hourly) {
    return HOURS_ORDER.reduce((sum, hour) => sum + (hourly[`target_${hour}`] || 0), 0);
}

function run() {
    const shiftA = shiftPatternToActiveHours("A");
    assert.strictEqual(Object.values(shiftA).filter(Boolean).length, 8);
    assert.strictEqual(shiftA["07"], true);
    assert.strictEqual(shiftA["14"], true);
    assert.strictEqual(shiftA["15"], false);

    const shiftMN = shiftPatternToActiveHours("MN");
    assert.strictEqual(Object.values(shiftMN).filter(Boolean).length, 24);
    assert.strictEqual(shiftMN["07"], true);
    assert.strictEqual(shiftMN["06"], true);

    const activeHours = shiftPatternToActiveHours("A");
    const targets = calculateTargets({
        cycle_time_target: 4,
        eff_target: 90,
        active_hours: JSON.stringify(activeHours),
    });
    assert.strictEqual(targets.pc_target, 6480);
    assert.strictEqual(sumHourlyTargets(targets.hourly), targets.pc_target);
    assert.strictEqual(targets.hourly.target_07, 810);
    assert.strictEqual(targets.hourly.target_15, 0);

    const zeroCycle = calculateTargets({
        cycle_time_target: 0,
        eff_target: 90,
        active_hours: JSON.stringify(activeHours),
    });
    assert.strictEqual(zeroCycle.pc_target, 0);
    assert.deepStrictEqual(zeroCycle.hourly, {});

    console.log("planConfigController.unit.js passed");
}

run();
