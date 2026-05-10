require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TARGET_DATE = new Date("2026-04-20T00:00:00.000Z");
const SHIFT_HOURS = ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06"];

async function main() {
    const machines = await prisma.tbm_machine.findMany({
        where: { machine_name: { startsWith: "AHV" }, status: "active" },
        select: { machine_name: true },
        orderBy: { machine_name: "asc" },
    });

    for (const { machine_name } of machines) {
        const outputRows = await prisma.tb_output_actual.findMany({
            where: { machine_name, date: TARGET_DATE },
        });
        const ctRow = await prisma.tb_cycle_time_actual.findFirst({
            where: { machine_name, date: TARGET_DATE },
        });

        if (!ctRow) continue;

        let sumCtWeighted = 0;
        let totalOutputForCt = 0;

        for (const outputRow of outputRows) {
            // We should use per-hour fallback instead of raw sum to prevent double-counting!
            // Wait, outputRows could have double count!
            // But let's just use the strict per-hour fallback logic like we did for OEE.
        }

        // Proper per-hour fallback for calculating average Cycle Time:
        let robustSumCtWeighted = 0;
        let robustOutputForCt = 0;

        for (const h of SHIFT_HOURS) {
            const outRows = outputRows.filter(r => r.model_name !== "--" && r.model_name !== null && (r[`actual_${h}`] || 0) > 0);
            let out = 0;
            if (outRows.length > 0) {
                out = outRows.reduce((acc, r) => acc + (r[`actual_${h}`] || 0), 0);
            } else {
                const dashRow = outputRows.find(r => r.model_name === "--" || r.model_name === null);
                out = dashRow ? (dashRow[`actual_${h}`] || 0) : 0;
            }

            const ct = ctRow[`cycle_${h}`] || 0;
            if (out > 0 && ct > 0) {
                robustSumCtWeighted += ct * out;
                robustOutputForCt += out;
            }
        }

        const robustAvgCt = robustOutputForCt > 0 ? robustSumCtWeighted / robustOutputForCt : 0;

        console.log(`[${machine_name}] Updating cycle_time from ${ctRow.cycle_time} to ${robustAvgCt.toFixed(2)}`);

        await prisma.tb_cycle_time_actual.update({
            where: { id: ctRow.id },
            data: { cycle_time: parseFloat(robustAvgCt.toFixed(2)) },
        });
    }

    await prisma.$disconnect();
}
main();
