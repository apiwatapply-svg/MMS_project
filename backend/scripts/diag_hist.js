require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const list = await p.tb_oee.findMany({ 
        where: { machine_name: { startsWith: 'ABR' }, availability: { gt: 100 } },
        orderBy: { date: 'desc' }
    });
    console.log(`\n--- ABR Days where A > 100 ---`);
    for (const o of list) {
        console.log(`${o.date.toISOString().split('T')[0]} | ${o.machine_name} A=${o.availability} P=${o.performance}`);
    }

    const hl = await p.tb_availability_actual.findMany({ 
        where: { machine_name: { startsWith: 'ABR' } },
    });
    console.log(`\n--- ABR Hourly where A > 100 ---`);
    for (const h of hl) {
        for(let i=0; i<24; i++) {
            const hVal = h[`avail_${String(i).padStart(2, '0')}`];
            if(hVal > 100) {
                console.log(`${h.date.toISOString().split('T')[0]} | ${h.machine_name} Hour ${i} A=${hVal}`);
            }
        }
    }
}
main().catch(console.error).finally(() => p.$disconnect());
