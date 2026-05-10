require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { recalculateAPQForDay } = require("../services/oeeCalcService");

const TARGET_DATE = new Date("2026-04-20T00:00:00.000Z");

async function main() {
    console.log(`=== Recalculating A, P, Q, OEE for ALL Active Machines on 2026-04-20 ===\n`);

    const machines = await prisma.tbm_machine.findMany({
        where: { status: "active" },
        select: { machine_name: true },
        orderBy: { machine_name: "asc" },
    });

    console.log(`Found ${machines.length} active machines to recalculate.\n`);

    let successCount = 0;
    let failCount = 0;

    for (const { machine_name } of machines) {
        try {
            await recalculateAPQForDay(machine_name, TARGET_DATE);
            successCount++;
        } catch (err) {
            console.error(`❌ Failed to recalculate ${machine_name}: ${err.message}`);
            failCount++;
        }
    }

    console.log(`\n=== Recalculation Complete ===`);
    console.log(`✅ Success: ${successCount} machines`);
    console.log(`❌ Failed: ${failCount} machines`);

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
