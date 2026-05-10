require('dotenv').config();
const memOeeService = require('../services/memoryOeeService');
const { calcAvailability, calcPerformance } = require('../services/oeeCalcService');

async function check() {
    await memOeeService.hydrateFromMssql('2026-04-23');
    const now = new Date();
    const machineName = 'ABR-003';
    const { runTimeSec, excludedSec, totalSec } = memOeeService.getDurationsNow(machineName, now);

    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    
    // Fetch Output from cache/Influx mockup
    const out = await p.tb_output_actual.findMany({ where: { machine_name: machineName, date: new Date('2026-04-23') } });
    let totalOutput = 0;
    out.forEach(o => {
        for(let i=0; i<=24; i++) {
            totalOutput += o['actual_' + String(i).padStart(2, '0')] || 0;
        }
    });

    const targetEnt = await p.tb_output_target.findFirst({ where: { machine_name: machineName, date: new Date('2026-04-23') }});
    const idealCT = targetEnt ? targetEnt.cycle_time_target : 0;

    const A = calcAvailability(runTimeSec, excludedSec, totalSec);
    const P = calcPerformance(totalOutput, idealCT, runTimeSec);

    console.log('--- REALTIME (FAST LOOP) CALCULATION ---');
    console.log(`Run Time: ${runTimeSec}s`);
    console.log(`Excluded: ${excludedSec}s`);
    console.log(`TotalSec: ${totalSec}s`);
    console.log(`OperatingTime: ${totalSec - excludedSec}s`);
    console.log(`Output: ${totalOutput}`);
    console.log(`IdealCT: ${idealCT}`);
    console.log(`Availability: ${A}%`);
    console.log(`Performance: ${P}%`);
    
    await p.$disconnect();
}
check();
