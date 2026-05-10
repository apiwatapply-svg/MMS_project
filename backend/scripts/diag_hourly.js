require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const hl = await p.tb_availability_actual.findMany({ 
        where: { machine_name: { startsWith: 'ABR' }, date: new Date('2026-04-23') }
    });
    // Wait, performance relates to tb_efficiency_actual or tb_oee ??
    const pl = await p.tb_cycle_time_actual.findMany({ 
        where: { machine_name: { startsWith: 'ABR' }, date: new Date('2026-04-23') }
    }); // Cycle Time actual, we can calc eff
    const outL = await p.tb_output_actual.findMany({ 
        where: { machine_name: { startsWith: 'ABR' }, date: new Date('2026-04-23') }
    });
    const tgt = await p.tb_output_target.findMany({
        where: { machine_name: { startsWith: 'ABR' }, date: new Date('2026-04-23') }
    });
    
    console.log(`\n--- ABR Hourly A and P Today ---`);
    for (const h of hl) {
        const outDb = outL.filter(x => x.machine_name === h.machine_name);
        for(let i=0; i<24; i++) {
            const hStr = String(i).padStart(2, '0');
            const hVal = h[`avail_${hStr}`];
            let outSum = 0;
            outDb.forEach(o => outSum += (o[`actual_${hStr}`] || 0));
            // Just print if A > 99 or out > 0
            if((hVal != null && hVal > 95) || outSum > 0) {
                console.log(`${h.machine_name} Hour ${i} | A=${hVal}% | Out=${outSum}`);
            }
        }
    }
}
main().catch(console.error).finally(() => p.$disconnect());
