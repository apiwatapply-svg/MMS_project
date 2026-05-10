require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TARGET_DATE = new Date("2026-04-21T00:00:00.000Z");

async function main() {
    const row = await prisma.tb_availability_actual.findFirst({
        where: { machine_name: "AHV-001", date: TARGET_DATE }
    });
    console.log("=== AHV-001 Hourly Availability (tb_availability_actual) ===");
    console.log(JSON.stringify(row, null, 2));
    
    // Also check output to cross reference
    const acts = await prisma.tb_output_actual.findMany({
        where: { machine_name: "AHV-001", date: TARGET_DATE }
    });
    console.log("\n=== AHV-001 Hourly Output (tb_output_actual) ===");
    acts.forEach(r => {
        console.log(`Model: ${r.model_name}`);
        ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06"].forEach(h => {
            console.log(`  ${h}: ${r['actual_' + h]}`);
        });
    });

    const ct = await prisma.tb_cycle_time_actual.findFirst({
        where: { machine_name: "AHV-001", date: TARGET_DATE }
    });
    console.log("\n=== AHV-001 Hourly CT (tb_cycle_time_actual) ===");
    console.log(JSON.stringify(ct, null, 2));

    await prisma.$disconnect();
}
main().catch(console.error);
