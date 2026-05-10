const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function check() {
    const rows = await prisma.tb_MCStatus.findMany({
        where: { MC: 'ABR-003', Datetime: { gte: new Date('2026-04-20T00:00:00.000Z') } },
        orderBy: { Datetime: 'asc' }
    });
    console.log(`Found ${rows.length} rows for ABR-003 in tb_MCStatus.`);
    if (rows.length > 0) console.log('Last rows:', rows.slice(-5));
}
check().finally(() => process.exit());
