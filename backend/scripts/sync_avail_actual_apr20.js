require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TARGET_DATE = new Date("2026-04-20T00:00:00.000Z");

async function main() {
    console.log(`=== Syncing avail_actual from tb_oee for ALL machines on 2026-04-20 ===\n`);

    const availRows = await prisma.tb_availability_actual.findMany({
        where: { date: TARGET_DATE }
    });

    let updated = 0;
    for (const row of availRows) {
        const oeeRow = await prisma.tb_oee.findFirst({
            where: { machine_name: row.machine_name, date: TARGET_DATE },
            select: { availability: true }
        });

        const trueAvail = oeeRow?.availability || 0;

        if (row.avail_actual !== trueAvail) {
            console.log(`[${row.machine_name}] Syncing avail_actual: ${row.avail_actual} -> ${trueAvail}`);
            await prisma.tb_availability_actual.update({
                where: { id: row.id },
                data: { avail_actual: trueAvail }
            });
            updated++;
        }
    }

    console.log(`\n✅ Done. Synced ${updated} rows.`);
    await prisma.$disconnect();
}

main().catch(console.error);
