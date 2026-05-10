/**
 * Diagnostic: ABR-003 hour 09 missing CT & A
 * ตรวจสอบข้อมูลใน MSSQL สำหรับ ABR-003 วันนี้ ชั่วโมง 07-13
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getShiftDateUTC } = require('../utils/timeUtils');

const MACHINE = 'ABR-003';
const CHECK_HOURS = ['07', '08', '09', '10', '11', '12', '13'];

async function main() {
    const todayStr = getShiftDateUTC();
    const targetDate = new Date(todayStr + 'T00:00:00.000Z');
    console.log(`\n🔍 Diagnostic for ${MACHINE} on ${todayStr}\n`);

    // 1. Output actual
    const outputRows = await prisma.tb_output_actual.findMany({
        where: { machine_name: MACHINE, date: targetDate },
    });
    console.log('── tb_output_actual ──');
    for (const h of CHECK_HOURS) {
        const vals = outputRows.map(r => `${r.model_name || '--'}: ${r[`actual_${h}`] || 0}`).join(' | ');
        console.log(`  ${h}:00 → ${vals || '(no row)'}`);
    }

    // 2. Cycle time actual
    const ctRow = await prisma.tb_cycle_time_actual.findFirst({
        where: { machine_name: MACHINE, date: targetDate },
    });
    console.log('\n── tb_cycle_time_actual ──');
    for (const h of CHECK_HOURS) {
        const val = ctRow ? (ctRow[`cycle_${h}`] ?? '(null)') : '(no row)';
        console.log(`  ${h}:00 → CT = ${val}`);
    }

    // 3. Availability actual
    const availRow = await prisma.tb_availability_actual.findFirst({
        where: { machine_name: MACHINE, date: targetDate },
    });
    console.log('\n── tb_availability_actual ──');
    for (const h of CHECK_HOURS) {
        const val = availRow ? (availRow[`avail_${h}`] ?? '(null)') : '(no row)';
        console.log(`  ${h}:00 → A = ${val}`);
    }

    // 4. Runtime hourly
    const rtRow = await prisma.tb_mc_runtime_hourly.findFirst({
        where: { machine_name: MACHINE, date: targetDate },
    });
    console.log('\n── tb_mc_runtime_hourly ──');
    for (const h of CHECK_HOURS) {
        const rt = rtRow ? (rtRow[`runtime_${h}`] ?? '(null)') : '(no row)';
        const ex = rtRow ? (rtRow[`excluded_${h}`] ?? '(null)') : '(no row)';
        console.log(`  ${h}:00 → runtime=${rt}s, excluded=${ex}s`);
    }

    // 5. MCStatus records for hour 09 (02:00-03:00 UTC → 09:00-10:00 TH)
    const th09Start = new Date(todayStr + 'T09:00:00.000+07:00');
    const th09End   = new Date(todayStr + 'T10:00:00.000+07:00');
    // MCStatus stores Thai local time
    const th08Start = new Date(todayStr + 'T08:00:00.000+07:00');
    const th10End   = new Date(todayStr + 'T11:00:00.000+07:00');

    const statusRows = await prisma.tb_MCStatus.findMany({
        where: {
            MC: MACHINE,
            Datetime: { gte: th08Start, lt: th10End },
        },
        orderBy: { Datetime: 'asc' },
    });

    console.log(`\n── tb_MCStatus (08:00-11:00 TH) — ${statusRows.length} records ──`);
    if (statusRows.length === 0) {
        console.log('  ⚠️  NO MCStatus records in this window!');
    } else {
        for (const r of statusRows) {
            console.log(`  ${r.Datetime.toISOString()} (TH: ${new Date(r.Datetime.getTime()).toLocaleString('th-TH')}) → ${r.MCStatus}`);
        }
    }

    // 6. Check carry-over (last status BEFORE hour 09 TH = before 09:00 TH)
    const carryOver = await prisma.tb_MCStatus.findFirst({
        where: { MC: MACHINE, Datetime: { lt: th09Start } },
        orderBy: { Datetime: 'desc' },
    });
    console.log(`\n── Last MCStatus BEFORE 09:00 TH ──`);
    if (carryOver) {
        console.log(`  ${carryOver.Datetime.toISOString()} → ${carryOver.MCStatus}`);
    } else {
        console.log('  ⚠️  No carry-over status found at all!');
    }

    // 7. OEE row
    const oeeRow = await prisma.tb_oee.findFirst({
        where: { machine_name: MACHINE, date: targetDate },
    });
    console.log('\n── tb_oee (daily) ──');
    console.log(oeeRow
        ? `  A=${oeeRow.availability}%, P=${oeeRow.performance}%, Q=${oeeRow.quality}%, OEE=${oeeRow.oee}%`
        : '  (no row)');

    console.log('\n✅ Diagnostic complete.\n');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
