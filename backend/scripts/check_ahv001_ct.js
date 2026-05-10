require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TARGET_DATE = new Date("2026-04-20T00:00:00.000Z");

async function main() {
    console.log("=== Checking Cycle Time for AHV-001 on 2026-04-20 ===");
    
    const ct = await prisma.tb_cycle_time_actual.findFirst({
        where: { machine_name: "AHV-001", date: TARGET_DATE }
    });
    
    if (ct) {
        console.log("CT Record found:");
        console.dir(ct, { depth: null });
    } else {
        console.log("No CT Record found.");
    }
    
    const target = await prisma.tb_output_target.findFirst({
        where: { machine_name: "AHV-001", date: TARGET_DATE }
    });
    console.log("\nTarget CT:", target?.cycle_time_target);

    // Also check output per hour
    const out = await prisma.tb_output_actual.findMany({
        where: { machine_name: "AHV-001", date: TARGET_DATE }
    });
    console.log("\nOutput Actual:");
    out.forEach(o => {
        console.log(`Model: ${o.model_name}`);
        const SHIFT_HOURS = ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06"];
        let hrs = {};
        SHIFT_HOURS.forEach(h => {
             if(o[`actual_${h}`]) hrs[h] = o[`actual_${h}`];
        });
        console.log(hrs);
    });

    await prisma.$disconnect();
}
main();
