/**
 * Manual Recalc: Hour 09 for all status_based machines
 * that have output but CT=0 and runtime=0
 *
 * Logic:
 *   CT_est = avg(cycle_10, cycle_11) from adjacent hours
 *   runtime_09 = output_09 × CT_est
 *   avail_09 = min(runtime_09 / 3600 × 100, 100)
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getShiftDateUTC } = require('../utils/timeUtils');
const { getMachineRunTimeMode } = require('../services/oeeCalcService');

async function main() {
    const todayStr = getShiftDateUTC();
    const targetDate = new Date(todayStr + 'T00:00:00.000Z');
    console.log(`\n🔧 Manual Recalc Hour 09 — ${todayStr}\n`);

    // ── Query InfluxDB directly for hour 09 output ──
    // MSSQL tb_output_actual.actual_09 was already overwritten/reset to 0
    // Source of truth for "did this machine produce in hour 09?" = InfluxDB
    const influxService = require('../services/influxService');
    influxService.initClient();

    // TH 09:00-10:00 = UTC 02:00-03:00
    const h09Start = new Date(todayStr + 'T02:00:00.000Z');
    const h09End   = new Date(todayStr + 'T03:00:00.000Z');
    const influx09  = await influxService.queryAllMachinesForHour(h09Start, h09End);
    console.log('InfluxDB hour 09 data:', JSON.stringify(influx09, null, 2));

    // รวม output per machine จาก InfluxDB (ถูกต้องน่าเชื่อถือกว่า MSSQL ณ จุดนี้)
    const outputPerMachine = {};
    const ctFromInflux09 = {};
    for (const [machine, d] of Object.entries(influx09)) {
        if ((d.output_count || 0) <= 0) continue;
        outputPerMachine[machine] = d.output_count;
        ctFromInflux09[machine] = d.avg_cycle_time || 0;
    }

    if (Object.keys(outputPerMachine).length === 0) {
        console.log('⚠️  InfluxDB hour 09: ไม่พบ machine ที่มี output');
        return;
    }


    // Step 2: โหลด CT rows ทั้งหมดสำหรับวันนี้
    const ctRows = await prisma.tb_cycle_time_actual.findMany({
        where: { date: targetDate },
    });
    const ctMap = {};
    for (const r of ctRows) ctMap[r.machine_name] = r;

    // Step 3: โหลด runtime rows
    const rtRows = await prisma.tb_mc_runtime_hourly.findMany({
        where: { date: targetDate },
    });
    const rtMap = {};
    for (const r of rtRows) rtMap[r.machine_name] = r;

    // Step 4: โหลด avail rows
    const availRows = await prisma.tb_availability_actual.findMany({
        where: { date: targetDate },
    });
    const availMap = {};
    for (const r of availRows) availMap[r.machine_name] = r;

    // Step 5: กรอง เฉพาะ status_based machines ที่ CT_09 = 0 หรือ runtime_09 = 0
    const candidates = [];
    for (const [machineName, output09] of Object.entries(outputPerMachine)) {
        const mode = getMachineRunTimeMode(machineName);
        if (mode === 'output_based') continue; // output_based จัดการเองอยู่แล้ว

        const ctRow = ctMap[machineName];
        const rtRow = rtMap[machineName];
        const ct09 = ctRow ? (ctRow.cycle_09 || 0) : 0;
        const rt09 = rtRow ? (rtRow.runtime_09 || 0) : 0;

        // Force recalc เสมอ (แม้จะมีค่าอยู่แล้ว เพราะอาจมาจากข้อมูลผิดพลาด)
        candidates.push({ machineName, output09, ctRow, rtRow, availRow: availMap[machineName] });
    }

    if (candidates.length === 0) {
        console.log('✅ ไม่มี machine ที่ต้องแก้ไข');
        return;
    }

    console.log(`\nพบ ${candidates.length} machines ที่ต้อง recalc:\n`);

    for (const { machineName, output09, ctRow, rtRow, availRow } of candidates) {
        // CT estimate order of priority:
        //  1. InfluxDB avg_ct for hour 09 itself (if > 0)
        //  2. Average of MSSQL cycle_10, cycle_11 (adjacent hour actuals)
        const ctInflux09 = ctFromInflux09[machineName] || 0;
        const ct10 = ctRow ? (ctRow.cycle_10 || 0) : 0;
        const ct11 = ctRow ? (ctRow.cycle_11 || 0) : 0;
        const adjVals = [ct10, ct11].filter(v => v > 0);

        let ctEst = 0;
        let ctSource = '';
        if (ctInflux09 > 0) {
            ctEst = ctInflux09;
            ctSource = `InfluxDB hour 09 (avg_ct=${ctInflux09.toFixed(2)}s)`;
        } else if (adjVals.length > 0) {
            ctEst = adjVals.reduce((a, b) => a + b, 0) / adjVals.length;
            ctSource = `avg of hours 10/11 (${adjVals.join(', ')})`;
        }

        if (ctEst <= 0) {
            console.log(`  ⚠️  ${machineName}: ไม่สามารถประมาณ CT ได้ ข้ามไป`);
            continue;
        }

        const runtimeEst = parseFloat((output09 * ctEst).toFixed(2));
        const availEst = parseFloat(Math.min((runtimeEst / 3600) * 100, 100).toFixed(2));

        console.log(`  🔧 ${machineName}: output_09=${output09}, CT_est=${ctEst.toFixed(2)}s [${ctSource}]`);
        console.log(`        runtime_09=${runtimeEst}s, avail_09=${availEst}%`);

        // Update CT
        if (ctRow) {
            await prisma.tb_cycle_time_actual.update({
                where: { id: ctRow.id },
                data: { cycle_09: parseFloat(ctEst.toFixed(2)) },
            });
        } else {
            await prisma.tb_cycle_time_actual.create({
                data: { machine_name: machineName, date: targetDate, cycle_09: parseFloat(ctEst.toFixed(2)) },
            });
        }

        // Update runtime
        if (rtRow) {
            await prisma.tb_mc_runtime_hourly.update({
                where: { id: rtRow.id },
                data: { runtime_09: runtimeEst },
            });
        } else {
            await prisma.tb_mc_runtime_hourly.create({
                data: { machine_name: machineName, date: targetDate, runtime_09: runtimeEst },
            });
        }

        // Update availability
        if (availRow) {
            await prisma.tb_availability_actual.update({
                where: { id: availRow.id },
                data: { avail_09: availEst },
            });
        } else {
            await prisma.tb_availability_actual.create({
                data: { machine_name: machineName, date: targetDate, avail_09: availEst },
            });
        }

        console.log(`        ✅ Updated DB`);
    }

    // Step 6: Recalc daily totals (runtime_total, avail_actual) ผ่าน cronService
    const { SHIFT_HOURS } = require('../utils/timeUtils');
    const machineNames = candidates.map(c => c.machineName);

    const [runtimeRowsAll, availRowsAll] = await Promise.all([
        prisma.tb_mc_runtime_hourly.findMany({ where: { date: targetDate, machine_name: { in: machineNames } } }),
        prisma.tb_availability_actual.findMany({ where: { date: targetDate, machine_name: { in: machineNames } } }),
    ]);

    console.log('\n📊 Recalculating daily totals...');
    for (const row of runtimeRowsAll) {
        let sumRt = 0, sumEx = 0;
        for (const h of SHIFT_HOURS) { sumRt += row[`runtime_${h}`] || 0; sumEx += row[`excluded_${h}`] || 0; }
        await prisma.tb_mc_runtime_hourly.update({
            where: { id: row.id },
            data: { runtime_total: parseFloat(sumRt.toFixed(2)), excluded_total: parseFloat(sumEx.toFixed(2)) },
        });
    }

    for (const row of availRowsAll) {
        // Recalc avail_actual: SUM(runtime) / SUM(active_seconds) × 100
        // ใช้ tb_oee เพื่อ consistency (เหมือน recalcRuntimeAndAvailTotals)
        const oeeRow = await prisma.tb_oee.findFirst({
            where: { machine_name: row.machine_name, date: targetDate },
            select: { availability: true },
        });
        if (oeeRow?.availability != null) {
            await prisma.tb_availability_actual.update({
                where: { id: row.id },
                data: { avail_actual: oeeRow.availability },
            });
            console.log(`  ${row.machine_name}: avail_actual (from tb_oee) = ${oeeRow.availability}%`);
        } else {
            // fallback: simple average of non-zero hours
            let sum = 0, cnt = 0;
            for (const h of SHIFT_HOURS) { const v = row[`avail_${h}`] || 0; if (v > 0) { sum += v; cnt++; } }
            const avgAvail = cnt > 0 ? parseFloat((sum / cnt).toFixed(2)) : 0;
            await prisma.tb_availability_actual.update({
                where: { id: row.id },
                data: { avail_actual: avgAvail },
            });
            console.log(`  ${row.machine_name}: avail_actual (avg fallback) = ${avgAvail}%`);
        }
    }

    console.log('\n✅ Done! Refresh Dashboard to see updated Hour 09 data.\n');
}

main().catch(console.error).finally(() => prisma.$disconnect());
