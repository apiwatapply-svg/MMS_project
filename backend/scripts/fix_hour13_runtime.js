/**
 * fix_hour13_runtime.js — Recalculate runtime & availability for hour 13 (ABR-003)
 * After MCStatus sync, re-run upsertRuntimeAndAvailabilityForHour for today
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const influxService = require('../services/influxService');
const { upsertRuntimeAndAvailabilityForHour } = require('../services/cronService');

async function main() {
    influxService.initClient();

    const today = new Date('2026-04-22');
    const machine = 'ABR-003';

    // ชั่วโมงที่ต้องการ recalc: 13 TH = UTC 06:00-07:00
    const hours = [
        { thCol: '13', startUTC: new Date('2026-04-22T06:00:00.000Z'), endUTC: new Date('2026-04-22T07:00:00.000Z') },
    ];

    for (const { thCol, startUTC, endUTC } of hours) {
        console.log(`\n🔄 Recalculating hour ${thCol} (${startUTC.toISOString()} - ${endUTC.toISOString()})...`);
        await upsertRuntimeAndAvailabilityForHour(thCol, startUTC, endUTC, today, [machine], null);
        console.log(`✅ Done hour ${thCol}`);
    }

    // Verify result
    const avail = await p.tb_availability_actual.findFirst({ where: { machine_name: machine, date: today } });
    const rt    = await p.tb_mc_runtime_hourly.findFirst({ where: { machine_name: machine, date: today } });
    console.log('\n=== After fix ===');
    console.log('avail_13:', avail?.avail_13, '| avail_actual:', avail?.avail_actual);
    console.log('runtime_13:', rt?.runtime_13);
}

main().catch(console.error).finally(() => p.$disconnect());
