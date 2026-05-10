require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const today = new Date("2026-04-20");
const SHIFT_HOURS = ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06"];

prisma.tb_cycle_time_actual.findFirst({
    where: { machine_name: "AHV-003", date: today }
}).then(row => {
    if (!row) { console.log("ไม่มีข้อมูลใน tb_cycle_time_actual"); return; }
    let sumCt = 0, countHours = 0;
    for (const h of SHIFT_HOURS) {
        const ct = row[`cycle_${h}`] || 0;
        if (ct > 0) {
            console.log(`  hour ${h}: cycle_time = ${ct}s`);
            sumCt += ct;
            countHours++;
        }
    }
    console.log(`\navgCt จาก tb_cycle_time_actual: ${countHours > 0 ? (sumCt/countHours).toFixed(3) : 0}s (${countHours} hours)`);
    return prisma.$disconnect();
}).catch(e => { console.error(e.message); prisma.$disconnect(); });
