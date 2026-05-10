const dayjs = require("dayjs");
const { PrismaClient } = require("@prisma/client");
const { sumHourlyFields } = require("./oeeCalcService");
const { groupActualRowsByMachineAndDate, sumActualTotal } = require("./actualOutputService");

const prisma = new PrismaClient();

const SHIFT_HOURS = [
    "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18",
    "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06",
];

const DOWNTIME_CATEGORIES = {
    alarm: new Set(["MC_Alarm", "MC_Error"]),
    maintenance: new Set(["MM_Repair", "MM_Preventive", "MM_Check_Master", "Wait_MM"]),
    adjust: new Set(["Setter_Adjust", "Setter_Check_Master", "Setter_Preventive", "Prod_Check_Master", "QC_Check_Master", "Check_Master", "Prod_Cleaning"]),
};

function normalizeDateKey(date) {
    return dayjs(date).format("YYYY-MM-DD");
}

function monthKey(date) {
    return dayjs(date).format("YYYY-MM");
}

function isFutureMonth(bucketKey, today = new Date()) {
    return dayjs(`${bucketKey}-01`).startOf("month").isAfter(dayjs(today).startOf("month"));
}

function effectiveMonthDays(bucketKey, today = new Date()) {
    if (isFutureMonth(bucketKey, today)) return 0;
    const bucketStart = dayjs(`${bucketKey}-01`).startOf("month");
    const currentDay = dayjs(today);
    if (bucketStart.isSame(currentDay, "month")) return currentDay.date();
    return bucketStart.daysInMonth();
}

function perDay(total, days) {
    if (!days) return 0;
    return Number((Number(total || 0) / days).toFixed(2));
}

function sumValues(rows, field) {
    return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function avgValues(rows, field) {
    const values = rows.map((row) => Number(row[field] || 0)).filter((value) => value > 0);
    if (values.length === 0) return 0;
    return values.reduce((total, value) => total + value, 0) / values.length;
}

function resolveStatusCategory(status) {
    if (DOWNTIME_CATEGORIES.alarm.has(status)) return "alarm";
    if (DOWNTIME_CATEGORIES.maintenance.has(status)) return "maintenance";
    if (DOWNTIME_CATEGORIES.adjust.has(status)) return "adjust";
    return null;
}

function createMachineFilter({ area, type, machine }) {
    const where = { status: "active" };
    if (area && area !== "all") where.machine_area = area;
    if (type && type !== "all") where.machine_type = type;
    if (machine && machine !== "ALL" && machine !== "all") where.machine_name = machine;
    return where;
}

async function getMachines(filters) {
    return prisma.tbm_machine.findMany({
        where: createMachineFilter(filters),
        select: { machine_name: true, machine_area: true, machine_type: true },
        orderBy: { machine_name: "asc" },
    });
}

async function getReportRows(machineNames, startDate, endDate) {
    const where = {
        machine_name: { in: machineNames },
        date: { gte: startDate, lte: endDate },
    };

    return Promise.all([
        prisma.tb_output_target.findMany({ where }),
        prisma.tb_output_actual.findMany({ where }),
        prisma.tb_cycle_time_actual.findMany({ where }),
        prisma.tb_availability_actual.findMany({ where }),
        prisma.tb_efficiency_actual.findMany({ where }),
        prisma.tb_oee.findMany({ where }),
    ]);
}

async function getStatusRows(machineNames, startTime, endTime) {
    const carryRows = await Promise.all(machineNames.map((machineName) => (
        prisma.tb_MCStatus.findFirst({
            where: { MC: machineName, Datetime: { lt: startTime } },
            orderBy: { Datetime: "desc" },
            select: { MC: true, MCStatus: true, Datetime: true },
        })
    )));

    const rows = await prisma.tb_MCStatus.findMany({
        where: {
            MC: { in: machineNames },
            Datetime: { gte: startTime, lt: endTime },
        },
        orderBy: [{ MC: "asc" }, { Datetime: "asc" }],
        select: { MC: true, MCStatus: true, Datetime: true },
    });

    return [...carryRows.filter(Boolean).map((row) => ({ ...row, Datetime: startTime })), ...rows];
}

function buildTimeBuckets(start, count, unit) {
    return Array.from({ length: count }, (_, index) => {
        const bucketStart = unit === "day" ? dayjs(start).add(index, "day") : dayjs(start).add(index, "month");
        const bucketEnd = unit === "day" ? bucketStart.add(1, "day") : bucketStart.add(1, "month");
        return {
            key: unit === "day" ? bucketStart.format("YYYY-MM-DD") : bucketStart.format("YYYY-MM"),
            label: unit === "day" ? String(bucketStart.date()) : bucketStart.format("MMM"),
            start: bucketStart.toDate(),
            end: bucketEnd.toDate(),
        };
    });
}

function addDurationToBuckets(bucketMap, start, end, status) {
    const category = resolveStatusCategory(status);
    if (!category || end <= start) return;

    for (const bucket of bucketMap.values()) {
        const overlapStart = Math.max(start.getTime(), bucket.start.getTime());
        const overlapEnd = Math.min(end.getTime(), bucket.end.getTime());
        if (overlapEnd > overlapStart) {
            bucket.downtime[category] += (overlapEnd - overlapStart) / 60000;
        }
    }
}

function aggregateDowntime(statusRows, buckets) {
    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, {
        ...bucket,
        downtime: { alarm: 0, maintenance: 0, adjust: 0 },
    }]));
    const rowsByMachine = new Map();

    for (const row of statusRows) {
        if (!rowsByMachine.has(row.MC)) rowsByMachine.set(row.MC, []);
        rowsByMachine.get(row.MC).push(row);
    }

    for (const rows of rowsByMachine.values()) {
        rows.sort((a, b) => new Date(a.Datetime) - new Date(b.Datetime));
        for (let index = 0; index < rows.length; index += 1) {
            const current = rows[index];
            const next = rows[index + 1];
            const segmentStart = new Date(current.Datetime);
            const segmentEnd = next ? new Date(next.Datetime) : buckets[buckets.length - 1].end;
            addDurationToBuckets(bucketMap, segmentStart, segmentEnd, current.MCStatus);
        }
    }

    return bucketMap;
}

async function getAlarmSummary(machineNames, startTime, endTime, limit = 8) {
    const rows = await prisma.tb_MCAlarm.findMany({
        where: {
            MC: { in: machineNames },
            Datetime: { gte: startTime, lt: endTime },
        },
        select: { MCAlarm: true },
    });

    const counts = new Map();
    for (const row of rows) {
        const key = row.MCAlarm || "Unknown";
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([alarm, count]) => ({ alarm, count }));
}

function aggregateDailyRows({ buckets, targets, actuals, cycles, avails, effs, oees }) {
    const actualRowsByMachineDate = groupActualRowsByMachineAndDate(actuals, normalizeDateKey);

    return buckets.map((bucket) => {
        const targetRows = targets.filter((row) => normalizeDateKey(row.date) === bucket.key);
        const cycleRows = cycles.filter((row) => normalizeDateKey(row.date) === bucket.key);
        const availRows = avails.filter((row) => normalizeDateKey(row.date) === bucket.key);
        const effRows = effs.filter((row) => normalizeDateKey(row.date) === bucket.key);
        const oeeRows = oees.filter((row) => normalizeDateKey(row.date) === bucket.key);
        const actualTotal = Object.values(actualRowsByMachineDate).reduce((total, rowsByDate) => {
            return total + sumActualTotal(rowsByDate[bucket.key] || [], SHIFT_HOURS);
        }, 0);

        return {
            key: bucket.key,
            label: bucket.label,
            output: actualTotal,
            outputTarget: sumValues(targetRows, "accum_target") || targetRows.reduce((total, row) => total + sumHourlyFields(row, "target", SHIFT_HOURS), 0),
            availability: avgValues(availRows, "avail_actual") || avgValues(effRows, "eff_actual") || avgValues(oeeRows, "availability"),
            efficiencyTarget: avgValues(targetRows, "eff_target"),
            cycleTime: avgValues(cycleRows, "cycle_time"),
            cycleTimeTarget: avgValues(targetRows, "cycle_time_target"),
            performance: avgValues(oeeRows, "performance"),
            quality: avgValues(oeeRows, "quality"),
            oee: avgValues(oeeRows, "oee_value"),
        };
    });
}

function emptyFutureMonth(bucket) {
    return {
        key: bucket.key,
        label: bucket.label,
        output: null,
        outputTarget: null,
        outputPerDay: null,
        outputTargetPerDay: null,
        availability: null,
        efficiencyTarget: null,
        cycleTime: null,
        cycleTimeTarget: null,
        performance: null,
        quality: null,
        oee: null,
    };
}

function aggregateMonthlyRows({ buckets, targets, actuals, cycles, avails, effs, oees }, today = new Date()) {
    const actualRowsByMachineDate = groupActualRowsByMachineAndDate(actuals, normalizeDateKey);

    return buckets.map((bucket) => {
        if (isFutureMonth(bucket.key, today)) return emptyFutureMonth(bucket);

        const targetRows = targets.filter((row) => monthKey(row.date) === bucket.key);
        const cycleRows = cycles.filter((row) => monthKey(row.date) === bucket.key);
        const availRows = avails.filter((row) => monthKey(row.date) === bucket.key);
        const effRows = effs.filter((row) => monthKey(row.date) === bucket.key);
        const oeeRows = oees.filter((row) => monthKey(row.date) === bucket.key);
        const actualEntries = Object.values(actualRowsByMachineDate).flatMap((rowsByDate) => {
            return Object.entries(rowsByDate).filter(([dateKey]) => monthKey(dateKey) === bucket.key);
        });
        const hasReportData = targetRows.length > 0 || cycleRows.length > 0 || availRows.length > 0 || effRows.length > 0 || oeeRows.length > 0 || actualEntries.length > 0;
        if (!hasReportData) return null;
        const monthDays = effectiveMonthDays(bucket.key, today);

        const output = Object.values(actualRowsByMachineDate).reduce((total, rowsByDate) => {
            return total + Object.entries(rowsByDate).reduce((dateTotal, [dateKey, rows]) => {
                return monthKey(dateKey) === bucket.key ? dateTotal + sumActualTotal(rows, SHIFT_HOURS) : dateTotal;
            }, 0);
        }, 0);
        const outputTarget = sumValues(targetRows, "accum_target") || targetRows.reduce((total, row) => total + sumHourlyFields(row, "target", SHIFT_HOURS), 0);

        return {
            key: bucket.key,
            label: bucket.label,
            output,
            outputTarget,
            outputPerDay: perDay(output, monthDays),
            outputTargetPerDay: perDay(outputTarget, monthDays),
            availability: avgValues(availRows, "avail_actual") || avgValues(effRows, "eff_actual") || avgValues(oeeRows, "availability"),
            efficiencyTarget: avgValues(targetRows, "eff_target"),
            cycleTime: avgValues(cycleRows, "cycle_time"),
            cycleTimeTarget: avgValues(targetRows, "cycle_time_target"),
            performance: avgValues(oeeRows, "performance"),
            quality: avgValues(oeeRows, "quality"),
            oee: avgValues(oeeRows, "oee_value"),
        };
    }).filter(Boolean);
}

function getDistinctValues(rows, field) {
    return [...new Set(rows.map((row) => row[field]).filter((value) => value && value !== "--"))];
}

async function getDailyDashboard({ month, area = "all", type = "all", machine = "ALL", model = "all" }) {
    const monthStart = dayjs(month).startOf("month");
    const monthEnd = dayjs(month).endOf("month");
    const machines = await getMachines({ area, type, machine });
    const machineNames = machines.map((item) => item.machine_name);
    if (machineNames.length === 0) return { filters: { month, area, type, machine, model }, machines: [], days: [], alarmSummary: [] };

    const [targets, actualsRaw, cycles, avails, effs, oees] = await getReportRows(machineNames, monthStart.toDate(), monthEnd.toDate());
    const actuals = model && model !== "all" ? actualsRaw.filter((row) => row.model_name === model) : actualsRaw;
    const buckets = buildTimeBuckets(monthStart, monthEnd.date(), "day");
    const statusRows = await getStatusRows(machineNames, monthStart.toDate(), monthEnd.add(1, "day").toDate());
    const downtimeMap = aggregateDowntime(statusRows, buckets);
    const days = aggregateDailyRows({ buckets, targets, actuals, cycles, avails, effs, oees }).map((day) => ({
        ...day,
        downtime: downtimeMap.get(day.key)?.downtime || { alarm: 0, maintenance: 0, adjust: 0 },
    }));

    return {
        filters: { month, area, type, machine, model },
        machines,
        modelNames: getDistinctValues(actualsRaw, "model_name"),
        days,
        alarmSummary: await getAlarmSummary(machineNames, monthStart.toDate(), monthEnd.add(1, "day").toDate()),
    };
}

async function getMonthlyDashboard({ year, area = "all", type = "all", machine = "ALL", model = "all" }) {
    const fiscalStart = dayjs(`${year}-04-01`).startOf("month");
    const fiscalEnd = fiscalStart.add(12, "month").subtract(1, "day");
    const machines = await getMachines({ area, type, machine });
    const machineNames = machines.map((item) => item.machine_name);
    if (machineNames.length === 0) return { filters: { year, area, type, machine, model }, machines: [], months: [], alarmSummary: [] };

    const [targets, actualsRaw, cycles, avails, effs, oees] = await getReportRows(machineNames, fiscalStart.toDate(), fiscalEnd.toDate());
    const actuals = model && model !== "all" ? actualsRaw.filter((row) => row.model_name === model) : actualsRaw;
    const buckets = buildTimeBuckets(fiscalStart, 12, "month");
    const statusRows = await getStatusRows(machineNames, fiscalStart.toDate(), fiscalEnd.add(1, "day").toDate());
    const downtimeMap = aggregateDowntime(statusRows, buckets);
    const months = aggregateMonthlyRows({ buckets, targets, actuals, cycles, avails, effs, oees }).map((monthRow) => ({
        ...monthRow,
        downtime: downtimeMap.get(monthRow.key)?.downtime || { alarm: 0, maintenance: 0, adjust: 0 },
    }));

    return {
        filters: { year, area, type, machine, model },
        machines,
        modelNames: getDistinctValues(actualsRaw, "model_name"),
        months,
        alarmSummary: await getAlarmSummary(machineNames, fiscalStart.toDate(), fiscalEnd.add(1, "day").toDate()),
    };
}

module.exports = {
    getDailyDashboard,
    getMonthlyDashboard,
    __private: {
        aggregateMonthlyRows,
        effectiveMonthDays,
        isFutureMonth,
        perDay,
    },
};
