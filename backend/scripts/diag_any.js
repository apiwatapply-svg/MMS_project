require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const list = await p.tb_oee.findMany({ 
        where: { date: new Date('2026-04-23'), availability: { gt: 100 } }
    });
    console.log(`\n--- ANY Machine where A > 100 Today ---`);
    for (const o of list) {
        console.log(`${o.machine_name} A=${o.availability} P=${o.performance}`);
    }

    const hl = await p.tb_availability_actual.findMany({ 
        where: { date: new Date('2026-04-23') }
    });
    console.log(`\n--- ANY Machine Hourly where A > 100 Today ---`);
    for (const h of hl) {
        for(let i=0; i<24; i++) {
            const hVal = h[`avail_${String(i).padStart(2, '0')}`];
            if(hVal > 100) {
                console.log(`${h.machine_name} Hour ${i} A=${hVal}`);
            }
        }
    }
}
main().catch(console.error).finally(() => p.$disconnect());
