require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const list = await p.tb_MCStatus.findMany({ 
        where: { MC: 'ABR-003', Datetime: { gte: new Date('2026-04-23') } },
        orderBy: { Datetime: 'desc' },
        take: 10
    });
    console.log(`\n--- ABR-003 Top 10 MCStatus ---`);
    for (const o of list.reverse()) {
        console.log(`${o.Datetime.toISOString()} (UTC_Time: ${o.UTC_Time ? o.UTC_Time.toISOString() : '?'}) | ${o.MCStatus}`);
    }
}
main().catch(console.error).finally(() => p.$disconnect());
