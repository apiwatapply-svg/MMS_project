require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const rows = await p.tb_output_actual.findMany({
        where: { machine_name: 'ABR-003', date: new Date('2026-04-21') },
    });
    console.log(`ALL output_actual rows for ABR-003 (${rows.length} rows):`);
    for (const r of rows) {
        console.log(JSON.stringify({
            id: r.id,
            model: r.model_name,
            actual_09: r.actual_09,
            actual_10: r.actual_10,
            actual_11: r.actual_11,
            actual_12: r.actual_12,
            actual_13: r.actual_13,
        }));
    }
}

main().catch(console.error).finally(() => p.$disconnect());
