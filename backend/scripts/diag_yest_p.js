require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const list = await p.tb_oee.findMany({ 
        where: { machine_name: { startsWith: 'ABR' }, date: new Date('2026-04-22') }
    });
    console.log(`\n--- ABR P YESTERDAY ---`);
    for (const o of list) {
        console.log(`${o.machine_name} A=${o.availability} P=${o.performance}`);
    }
}
main().catch(console.error).finally(() => p.$disconnect());
