require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { recalculateAPQForDay } = require("../services/oeeCalcService");

const DATES = [
    new Date("2026-04-19T00:00:00.000Z"),
    new Date("2026-04-20T00:00:00.000Z"),
    new Date("2026-04-21T00:00:00.000Z")
];

async function main() {
    console.log(`=== Recalculating A, P, Q, OEE & Syncing avail_actual for 19th, 20th, 21st ===\n`);

    const machines = await prisma.tbm_machine.findMany({
        where: { status: "active" },
        select: { machine_name: true },
        orderBy: { machine_name: "asc" },
    });

    for (const targetDate of DATES) {
        console.log(`\n--- Processing Date: ${targetDate.toISOString().split("T")[0]} ---`);
        let synced = 0;
        for (const { machine_name } of machines) {
            try {
                // 1) Update tb_oee via accurate recalculateAPQForDay
                await recalculateAPQForDay(machine_name, targetDate);

                // 2) Sync tb_availability_actual.avail_actual with the newly updated tb_oee.availability to clear any average-of-averages bug
                const oeeRow = await prisma.tb_oee.findFirst({
                    where: { machine_name, date: targetDate },
                    select: { availability: true }
                });
                
                if (oeeRow) {
                    const availRow = await prisma.tb_availability_actual.findFirst({
                        where: { machine_name, date: targetDate }
                    });
                    
                    if (availRow && availRow.avail_actual !== oeeRow.availability) {
                        await prisma.tb_availability_actual.update({
                            where: { id: availRow.id },
                            data: { avail_actual: oeeRow.availability }
                        });
                        synced++;
                    }
                }
            } catch (err) {
                console.error(`❌ Failed: ${machine_name} on ${targetDate.toISOString()}: ${err.message}`);
            }
        }
        console.log(`✅ ${targetDate.toISOString().split("T")[0]} processed. Synced discrepancies for ${synced} machines.`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
