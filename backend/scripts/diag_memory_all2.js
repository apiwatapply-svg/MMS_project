require('dotenv').config();
const memOeeService = require('../services/memoryOeeService');
const { calcAvailability, calcPerformance } = require('../services/oeeCalcService');

async function check() {
    await memOeeService.hydrateFromMssql('2026-04-23');
    const now = new Date(); // Right now

    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    
    // Output
    const outList = await p.tb_output_actual.findMany({ where: { date: new Date('2026-04-23') } });
    const targetList = await p.tb_output_target.findMany({ where: { date: new Date('2026-04-23') }});
    
    const machines = [...new Set(outList.map(o => o.machine_name))];

    console.log("--- ALL MACHINES IN MEMORY TODAY ---");
    for(const machineName of machines) {
        const { runTimeSec, excludedSec, totalSec } = memOeeService.getDurationsNow(machineName, now);

        let totalOutput = 0;
        outList.filter(o => o.machine_name === machineName).forEach(o => {
            for(let i=0; i<=24; i++) {
                totalOutput += o['actual_' + String(i).padStart(2, '0')] || 0;
            }
        });

        const targetEnt = targetList.find(t => t.machine_name === machineName);
        const idealCT = targetEnt ? targetEnt.cycle_time_target : 0;

        const A = calcAvailability(runTimeSec, excludedSec, totalSec);
        const P = calcPerformance(totalOutput, idealCT, runTimeSec);

        if (A >= 100 || P < 20 || runTimeSec > 5) {
            console.log(`${machineName} | A=${A.toFixed(2)} | P=${P.toFixed(2)} | Out=${totalOutput} | CT=${idealCT} | Run=${runTimeSec.toFixed(0)} | Total=${totalSec.toFixed(0)}`);
        }
    }
    
    await p.$disconnect();
}
check();
