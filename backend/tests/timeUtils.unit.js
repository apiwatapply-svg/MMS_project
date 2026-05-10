const assert = require("node:assert/strict");

const {
    SHIFT_HOURS,
    getCurrentHourBoundaries,
    getElapsedSecondsInHour,
    getFieldName,
    getHourBoundariesUTC,
    getPreviousHourBoundaries,
    getShiftDateUTC,
    getShiftIndex,
    thColumnToUtcHour,
    utcHourToThColumn,
} = require("../utils/timeUtils");

assert.equal(SHIFT_HOURS.length, 24);
assert.equal(SHIFT_HOURS[0], "07");
assert.equal(SHIFT_HOURS[17], "00");
assert.equal(SHIFT_HOURS[23], "06");

assert.equal(utcHourToThColumn(0), "07");
assert.equal(utcHourToThColumn(17), "00");
assert.equal(thColumnToUtcHour("07"), 0);
assert.equal(thColumnToUtcHour("00"), 17);
assert.equal(getFieldName("actual", 0), "actual_07");

const current = getCurrentHourBoundaries(new Date("2026-05-10T09:15:30.000Z"));
assert.equal(current.dateStr, "2026-05-10");
assert.equal(current.utcHour, 9);
assert.equal(current.thColumn, "16");
assert.equal(current.start.toISOString(), "2026-05-10T09:00:00.000Z");
assert.equal(current.end.toISOString(), "2026-05-10T10:00:00.000Z");

const previous = getPreviousHourBoundaries(new Date("2026-05-10T00:05:00.000Z"));
assert.equal(previous.dateStr, "2026-05-09");
assert.equal(previous.utcHour, 23);
assert.equal(previous.thColumn, "06");

assert.equal(getHourBoundariesUTC("2026-05-10", 5).start.toISOString(), "2026-05-10T05:00:00.000Z");
assert.equal(getShiftDateUTC(new Date("2026-05-10T23:59:00.000Z")), "2026-05-10");
assert.equal(getShiftIndex("15"), 8);
assert.equal(getElapsedSecondsInHour(new Date("2026-05-10T09:15:30.000Z")), 930);

console.log("timeUtils unit tests passed");
