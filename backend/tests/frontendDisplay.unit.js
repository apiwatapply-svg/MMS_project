const assert = require("assert");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");

function read(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assertNotContains(source, patterns, fileName) {
    for (const pattern of patterns) {
        assert.ok(!pattern.test(source), `${fileName} should not contain ${pattern}`);
    }
}

function run() {
    const updateOee = read("fontend/src/app/oee_production/update_oee/page.tsx");
    const machineNg = read("fontend/src/app/oee_production/machine_ng/page.tsx");
    const machineReport = read("fontend/src/app/oee_production/machine_report/page.tsx");

    assertNotContains(updateOee, [
        /Fill NG/i,
        /Edit NG/i,
        /Manual/i,
        /manual-ng/i,
        /modalManualNg/i,
        /modalBatchMulti/i,
    ], "update_oee/page.tsx");
    assert.ok(/Auto OEE \/ NG Monitor/.test(updateOee));
    assert.ok(/Showing \{machines\.length\} auto machines/.test(updateOee));

    assertNotContains(machineNg, [
        /Over Reject/i,
        /over_reject/i,
        /Over_Reject/i,
        /Visual NG/i,
        /Auto NG/i,
        /Manual/i,
    ], "machine_ng/page.tsx");
    assert.ok(/NG Qty/.test(machineNg));
    assert.ok(/updates in realtime/.test(machineNg));

    assertNotContains(machineReport, [
        /Over Reject/i,
        /over_reject/i,
        /isManualToday/i,
        /hideOeeFields/i,
    ], "machine_report/page.tsx");
    assert.ok(/NG Qty/.test(machineReport));

    console.log("frontendDisplay.unit.js passed");
}

run();
