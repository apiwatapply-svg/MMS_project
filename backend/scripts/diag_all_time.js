require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const list = await p.tb_oee.findMany({ 
        where: { availability: { gt: 100 } }
    });
    console.log(`\n--- ANY Machine ANY DATE where A > 100 ---`);
    for (const o of list) {
        console.log(`${o.date.toISOString().split('T')[0]} | ${o.machine_name} A=${o.availability} P=${o.performance}`);
    }
}
main().catch(console.error).finally(() => p.$disconnect());
