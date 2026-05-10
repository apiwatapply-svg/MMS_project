require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const hl = await p.tb_availability_actual.findMany({ 
        where: { machine_name: { startsWith: 'ABR' }, date: new Date('2026-04-22') }
    });
    const outL = await p.tb_output_actual.findMany({ 
        where: { machine_name: { startsWith: 'ABR' }, date: new Date('2026-04-22') }
    });
    
    console.log(`\n--- ABR Hourly A YESTERDAY ---`);
    for (const h of hl) {
        const outDb = outL.filter(x => x.machine_name === h.machine_name);
        for(let i=0; i<24; i++) {
            const hStr = String(i).padStart(2, '0');
            const hVal = h[`avail_${hStr}`];
            let outSum = 0;
            outDb.forEach(o => outSum += (o[`actual_${hStr}`] || 0));
            if(hVal != null && hVal > 100) {
                console.log(`${h.machine_name} Hour ${i} | A=${hVal}% | Out=${outSum}`);
            }
        }
    }
}
main().catch(console.error).finally(() => p.$disconnect());
