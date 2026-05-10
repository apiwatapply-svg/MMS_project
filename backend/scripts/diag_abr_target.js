require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const list = await p.tb_output_target.findMany({ 
        where: { machine_name: { startsWith: 'ABR' }, date: new Date('2026-04-23') }
    });
    console.log(`\n--- ABR Target ---`);
    for (const o of list) {
        console.log(`${o.machine_name} CT=${o.cycle_time_target}`);
    }
}
main().catch(console.error).finally(() => p.$disconnect());
