require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const today = new Date('2026-04-23');

    const oeeList = await p.tb_oee.findMany({ 
        where: { date: today, availability: { gt: 100 } } 
    });
    
    console.log('--- Machines with Availability > 100 ---');
    if (oeeList.length === 0) console.log("None in tb_oee today");
    oeeList.forEach(o => console.log(`${o.machine_name} A=${o.availability} P=${o.performance} Q=${o.quality} OEE=${o.oee_value}`));

    const oeeListAll = await p.tb_oee.findMany({ 
        where: { date: today } 
    });
    console.log('\n--- All Machines Today ---');
    for(const o of oeeListAll) {
        if(o.machine_name.startsWith('ABR')){
            console.log(`${o.machine_name} A=${o.availability} P=${o.performance} Q=${o.quality} OEE=${o.oee_value}`);
        }
    }
}
main().catch(console.error).finally(() => p.$disconnect());
