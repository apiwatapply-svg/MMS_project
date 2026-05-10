/**
 * fix_ct_avail_hour.js — Manual Recalc: CT + Availability for any given hour
 *
 * Usage:
 *   node scripts/fix_ct_avail_hour.js --hour 09
 *   node scripts/fix_ct_avail_hour.js --hour 07 --date 2026-04-21
 *   node scripts/fix_ct_avail_hour.js --all          ← recalc ALL hours with missing data today
 *
 * Logic per hour:
 *   1. Query InfluxDB directly for that hour's output (source of truth)
 *   2. Find status_based machines with output > 0 but runtime = 0
 *   3. CT estimate = InfluxDB avg_ct if > 0, else avg(adjacent hours from MSSQL)
 *   4. runtime = output × CT_est
 *   5. avail = min(runtime / 3600 × 100, 100)
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getShiftDateUTC, SHIFT_HOURS } = require('../utils/timeUtils');
const { getMachineRunTimeMode } = require('../services/oeeCalcService');
const influxService = require('../services/influxService');
influxService.initClient();

// ── Parse CLI args ──
const args = process.argv.slice(2);
const hourArgIdx = args.indexOf('--hour');
const dateArgIdx = args.indexOf('--date');
const runAll = args.includes('--all');

const targetHour = hourArgIdx >= 0 ? args[hourArgIdx + 1] : null;
const dateOverride = dateArgIdx >= 0 ? args[dateArgIdx + 1] : null;

if (!runAll && !targetHour) {
    console.error('❌ Usage: node fix_ct_avail_hour.js --hour HH [--date YYYY-MM-DD]');
    console.error('         node fix_ct_avail_hour.js --all [--date YYYY-MM-DD]');
    process.exit(1);
}

// TH hour → UTC hour offset (TH = UTC+7, shift starts 07:00 TH = 00:00 UTC)
// TH HH → UTC = HH - 7 (mod 24)
function thHourToUtcHour(thHH) {
    return ((parseInt(thHH, 10) - 7 + 24) % 24).toString().padStart(2, '0');
}

// Get adjacent hours for CT fallback (prev and next in SHIFT_HOURS order)
function getAdjacentHours(thColumn) {
    const idx = SHIFT_HOURS.indexOf(thColumn);
    const prev = idx > 0 ? SHIFT_HOURS[idx - 1] : null;
    const next = idx < SHIFT_HOURS.length - 1 ? SHIFT_HOURS[idx + 1] : null;
    return [prev, next].filter(Boolean);
}

async function recalcHour(todayStr, targetDate, thColumn) {
    const utcHour = thHourToUtcHour(thColumn);
    const hStart = new Date(`${todayStr}T${utcHour}:00:00.000Z`);
    const hEnd   = new Date(hStart.getTime() + 60 * 60 * 1000);

    console.log(`\n─── Hour ${thColumn}:00 TH (UTC ${utcHour}:00) ─────────────────────`);

    // Step 1: Query InfluxDB for this hour
    const influxData = await influxService.queryAllMachinesForHour(hStart, hEnd);

    // Filter machines with output > 0
    const activeInFlux = Object.entries(influxData).filter(([, d]) => (d.output_count || 0) > 0);
    if (activeInFlux.length === 0) {
        console.log(`  ℹ️  InfluxDB: ไม่มี output ในชั่วโมงนี้ → ข้าม`);
        return;
    }

    // Load MSSQL rows
    const [ctRows, rtRows, availRows] = await Promise.all([
        prisma.tb_cycle_time_actual.findMany({ where: { date: targetDate } }),
        prisma.tb_mc_runtime_hourly.findMany({ where: { date: targetDate } }),
        prisma.tb_availability_actual.findMany({ where: { date: targetDate } }),
    ]);
    const ctMap   = Object.fromEntries(ctRows.map(r => [r.machine_name, r]));
    const rtMap   = Object.fromEntries(rtRows.map(r => [r.machine_name, r]));
    const availMap = Object.fromEntries(availRows.map(r => [r.machine_name, r]));

    let changed = 0;
    for (const [machineName, d] of activeInFlux) {
        const mode = getMachineRunTimeMode(machineName);
        if (mode === 'output_based') {
            // output_based ถูก cron จัดการเองอยู่แล้ว ข้าม
            continue;
        }

        const output = d.output_count;
        const rtRow   = rtMap[machineName];
        const currentRuntime = rtRow ? (rtRow[`runtime_${thColumn}`] || 0) : 0;

        if (currentRuntime > 0) {
            // Already has runtime — only fix if CT is missing
            const ctRow = ctMap[machineName];
            const currentCT = ctRow ? (ctRow[`cycle_${thColumn}`] || 0) : 0;
            if (currentCT > 0) {
                console.log(`  ✅ ${machineName}: runtime=${currentRuntime}s, CT=${currentCT}s → ข้ามแล้ว`);
                continue;
            }
        }

        // CT estimate (InfluxDB this hour first, then adjacent hours)
        const ctInflux = d.avg_cycle_time || 0;
        const ctRow = ctMap[machineName];
        const adjHours = getAdjacentHours(thColumn);
        const adjCTs = adjHours
            .map(h => ctRow ? (ctRow[`cycle_${h}`] || 0) : 0)
            .filter(v => v > 0);

        let ctEst = 0;
        let ctSource = '';
        if (ctInflux > 0) {
            ctEst = ctInflux;
            ctSource = `InfluxDB ${thColumn}:00 avg_ct`;
        } else if (adjCTs.length > 0) {
            ctEst = adjCTs.reduce((a, b) => a + b, 0) / adjCTs.length;
            ctSource = `avg adjacent hours (${adjHours.filter((_, i) => adjCTs[i] > 0).join(', ')})`;
        }

        if (ctEst <= 0) {
            console.log(`  ⚠️  ${machineName}: ไม่สามารถประมาณ CT ได้ (InfluxDB=0, adjacent=0) → ข้าม`);
            continue;
        }

        const runtimeEst = parseFloat((output * ctEst).toFixed(2));
        const availEst   = parseFloat(Math.min((runtimeEst / 3600) * 100, 100).toFixed(2));

        console.log(`  🔧 ${machineName}: output=${output}, CT_est=${ctEst.toFixed(2)}s [${ctSource}]`);
        console.log(`         → runtime=${runtimeEst}s, avail=${availEst}%`);

        // Update CT
        const ctData = { [`cycle_${thColumn}`]: parseFloat(ctEst.toFixed(2)) };
        if (ctRow) {
            await prisma.tb_cycle_time_actual.update({ where: { id: ctRow.id }, data: ctData });
        } else {
            await prisma.tb_cycle_time_actual.create({ data: { machine_name: machineName, date: targetDate, ...ctData } });
        }

        // Update runtime
        const rtData = { [`runtime_${thColumn}`]: runtimeEst };
        if (rtRow) {
            await prisma.tb_mc_runtime_hourly.update({ where: { id: rtRow.id }, data: rtData });
        } else {
            await prisma.tb_mc_runtime_hourly.create({ data: { machine_name: machineName, date: targetDate, ...rtData } });
        }

        // Update availability
        const availRow = availMap[machineName];
        const avData = { [`avail_${thColumn}`]: availEst };
        if (availRow) {
            await prisma.tb_availability_actual.update({ where: { id: availRow.id }, data: avData });
        } else {
            await prisma.tb_availability_actual.create({ data: { machine_name: machineName, date: targetDate, ...avData } });
        }

        console.log(`         ✅ Updated DB`);
        changed++;
    }

    if (changed === 0) {
        console.log(`  ℹ️  ไม่มี machine ที่ต้องแก้ไขในชั่วโมงนี้`);
    }
    return changed;
}

async function main() {
    const todayStr = dateOverride || getShiftDateUTC();
    const targetDate = new Date(todayStr + 'T00:00:00.000Z');

    const hoursToProcess = runAll ? SHIFT_HOURS : [targetHour.padStart(2, '0')];

    console.log(`\n🔧 fix_ct_avail_hour.js — ${runAll ? 'ALL hours' : `Hour ${hoursToProcess[0]}`} — ${todayStr}`);
    console.log(`   Processing ${hoursToProcess.length} hour(s)...\n`);

    let totalChanged = 0;
    for (const h of hoursToProcess) {
        const changed = await recalcHour(todayStr, targetDate, h);
        totalChanged += (changed || 0);
    }

    // Recalc daily totals for all affected rows
    console.log('\n📊 Recalculating daily totals for all machines...');
    const allMachines = await prisma.tbm_machine.findMany({
        where: { status: 'active' },
        select: { machine_name: true },
    });
    const machineNames = allMachines.map(m => m.machine_name);

    const rtRowsAll = await prisma.tb_mc_runtime_hourly.findMany({
        where: { date: targetDate, machine_name: { in: machineNames } },
    });
    await Promise.all(rtRowsAll.map(async row => {
        let sumRt = 0, sumEx = 0;
        for (const h of SHIFT_HOURS) { sumRt += row[`runtime_${h}`] || 0; sumEx += row[`excluded_${h}`] || 0; }
        await prisma.tb_mc_runtime_hourly.update({
            where: { id: row.id },
            data: { runtime_total: parseFloat(sumRt.toFixed(2)), excluded_total: parseFloat(sumEx.toFixed(2)) },
        });
    }));
    console.log(`  ✅ runtime_total recalculated for ${rtRowsAll.length} machines`);

    console.log(`\n✅ Done! Total changes: ${totalChanged}. Refresh Dashboard to see updated data.\n`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
