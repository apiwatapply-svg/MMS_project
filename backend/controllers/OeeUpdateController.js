const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { queryNgCount } = require("../services/influxService");
const { getShiftDateUTC } = require("../utils/timeUtils");

function parseDateToUtcMidnight(dateStr) {
    const parts = dateStr.split("-");
    return new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
}

function normalizeNgQty(rawValue, totalOutput) {
    const parsed = parseInt(rawValue, 10);
    const ngQty = Number.isFinite(parsed) ? parsed : 0;
    const maxOutput = Math.max(0, Number(totalOutput) || 0);
    return Math.max(0, Math.min(ngQty, maxOutput));
}

function buildRealtimeUpdatePayload(shiftDate, rows, mode = "auto") {
    const machines = {};
    for (const row of rows) {
        machines[row.machine_name] = {
            daily: {
                availability: row.availability,
                performance: row.performance,
                quality: row.quality,
                oee: row.oee_value,
                ngQty: row.ng_qty,
                oeeMode: mode,
            },
        };
    }

    return {
        serverTimeUTC: new Date().toISOString(),
        shiftDate,
        machines,
    };
}

const controller = {
    list: async (req, res) => {
        try {
            const { area, type } = req.query;
            const where = {};
            if (area && area !== "all") where.machine_area = area;
            if (type && type !== "all") where.machine_type = type;

            const machines = await prisma.tbm_machine.findMany({
                where,
                orderBy: { machine_name: "asc" },
            });

            const todayStr = getShiftDateUTC();
            const today = parseDateToUtcMidnight(todayStr);

            const [oeeRecords, outputRecords] = await Promise.all([
                prisma.tb_oee.findMany({ where: { date: today } }),
                prisma.tb_output_actual.findMany({ where: { date: today } }),
            ]);
            const oeeMap = new Map(oeeRecords.map(o => [o.machine_name, o]));
            const outputMap = new Map(outputRecords.map(o => [o.machine_name, o]));

            const results = machines.map(machine => {
                const oee = oeeMap.get(machine.machine_name);
                const output = outputMap.get(machine.machine_name);
                return {
                    machine_name: machine.machine_name,
                    machine_type: machine.machine_type,
                    machine_area: machine.machine_area,
                    oee_mode: "auto",
                    ng_qty: oee?.ng_qty || 0,
                    quality: oee?.quality || 0,
                    availability: oee?.availability || 0,
                    performance: oee?.performance || 0,
                    oee_value: oee?.oee_value || 0,
                    total_output: output?.Overall || 0,
                    display_date: todayStr,
                };
            });

            res.json({ results });
        } catch (err) {
            console.error("OEE list error:", err);
            res.status(500).json({ message: "Error listing OEE data" });
        }
    },

    setMode: async (req, res) => {
        try {
            const { machine_name, oee_mode } = req.body;
            if (!machine_name || oee_mode !== "auto") {
                return res.status(400).json({ message: "MMS uses auto NG/OEE mode for every machine" });
            }

            await prisma.tb_machine_plan_config.upsert({
                where: { machine_name },
                update: { oee_mode: "auto" },
                create: {
                    machine_name,
                    eff_target: 90,
                    cycle_time_target: 4.2,
                    active_hours: JSON.stringify({
                        "07": true, "08": true, "09": true, "10": true, "11": true, "12": true,
                        "13": true, "14": true, "15": true, "16": true, "17": true, "18": true,
                        "19": true, "20": true, "21": true, "22": true, "23": true, "00": true,
                        "01": true, "02": true, "03": true, "04": true, "05": true, "06": true,
                    }),
                    oee_mode: "auto",
                },
            });

            res.json({ success: true, message: `OEE mode set to auto for ${machine_name}` });
        } catch (err) {
            console.error("Set mode error:", err);
            res.status(500).json({ message: "Error setting OEE mode" });
        }
    },

    history: async (req, res) => {
        try {
            const { machine } = req.params;
            const { year, month, days } = req.query;

            let since;
            let until;
            if (year && month) {
                since = new Date(parseInt(year), parseInt(month) - 1, 1);
                until = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
            } else {
                const d = parseInt(days || "30", 10);
                since = new Date();
                since.setDate(since.getDate() - d);
                since.setHours(0, 0, 0, 0);
                until = new Date();
            }

            const dateFilter = { gte: since, lte: until };
            const [oeeRecords, outputs] = await Promise.all([
                prisma.tb_oee.findMany({
                    where: { machine_name: machine, date: dateFilter },
                    orderBy: { date: "desc" },
                }),
                prisma.tb_output_actual.findMany({
                    where: { machine_name: machine, date: dateFilter },
                }),
            ]);

            const outputMap = new Map(outputs.map(o => [o.date.toISOString().split("T")[0], o.Overall || 0]));
            const oeeMap = new Map(oeeRecords.map(o => [o.date.toISOString().split("T")[0], o]));
            const allDates = new Set([...outputMap.keys(), ...oeeMap.keys()]);
            const results = Array.from(allDates)
                .sort((a, b) => b.localeCompare(a))
                .map(dateStr => {
                    const oee = oeeMap.get(dateStr);
                    return {
                        date: dateStr,
                        ng_qty: oee?.ng_qty || 0,
                        quality: oee?.quality || 0,
                        availability: oee?.availability || 0,
                        performance: oee?.performance || 0,
                        oee_value: oee?.oee_value || 0,
                        total_output: outputMap.get(dateStr) || 0,
                    };
                });

            res.json({ results });
        } catch (err) {
            console.error("OEE history error:", err);
            res.status(500).json({ message: "Error fetching OEE history" });
        }
    },

    autoNg: async (req, res) => {
        try {
            const { machine } = req.params;
            const now = new Date();
            const year = now.getUTCFullYear();
            const month = now.getUTCMonth();
            const day = now.getUTCDate();
            const shiftStart = new Date(Date.UTC(year, month, day, 0, 0, 0));
            const shiftEnd = now;

            const ngCount = await queryNgCount(machine, shiftStart, shiftEnd);
            res.json({ machine_name: machine, ng_count: ngCount, shift_start: shiftStart, shift_end: shiftEnd });
        } catch (err) {
            console.error("Auto NG error:", err);
            res.status(500).json({ message: "Error querying NG count" });
        }
    },
};

controller.__private = {
    parseDateToUtcMidnight,
    normalizeNgQty,
    buildRealtimeUpdatePayload,
};

module.exports = controller;
