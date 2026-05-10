require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const list = await p.tb_oee.findMany({ 
        where: { machine_name: 'ABR-003', date: new Date('2026-04-23') }
    });
    console.log(`\n--- ABR-003 OEE Today ---`, list);
}
main().catch(console.error).finally(() => p.$disconnect());
