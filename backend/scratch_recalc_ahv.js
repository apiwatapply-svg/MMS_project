const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { recalculateAPQForDay } = require("./services/oeeCalcService");

async function main() {
    const dates = [
        new Date("2026-04-18T00:00:00Z"),
        new Date("2026-04-19T00:00:00Z"),
        new Date("2026-04-20T00:00:00Z"),
    ];

    const machines = await prisma.tbm_machine.findMany({
        where: { machine_type: "AHV", status: "active" },
        select: { machine_name: true }
    });

    console.log(`Found ${machines.length} AHV machines.`);

    for (const date of dates) {
        console.log(`\n=== Recalculating for ${date.toISOString().split('T')[0]} ===`);
        for (const m of machines) {
            await recalculateAPQForDay(m.machine_name, date);
        }
    }
    
    console.log("\nDone!");
    await prisma.$disconnect();
}

main().catch(err => {
    console.error(err);
    prisma.$disconnect();
});
