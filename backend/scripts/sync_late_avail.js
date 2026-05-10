require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TARGET_DATE = new Date("2026-04-21T00:00:00.000Z");

async function main() {
    console.log(`=== Manual Late Data Sync for Availability on 2026-04-21 ===`);

    const machines = ["AHV-001", "AHV-002", "AHV-003", "AHV-004", "AHV-005", "AHV-006"];

    for (const machine_name of machines) {
        const outRows = await prisma.tb_output_actual.findMany({ where: { machine_name, date: TARGET_DATE } });
        const ctRow = await prisma.tb_cycle_time_actual.findFirst({ where: { machine_name, date: TARGET_DATE } });
        const availRow = await prisma.tb_availability_actual.findFirst({ where: { machine_name, date: TARGET_DATE } });
        
        if (!ctRow || !availRow || outRows.length === 0) continue;

        let dataUpdates = {};
        for (const h of ["07","08","09","10","11"]) {
            // Find valid output 
            const realRows = outRows.filter(r => r.model_name !== "--" && (r[`actual_${h}`] || 0) > 0);
            let out = 0;
            if (realRows.length > 0) {
                out = realRows.reduce((acc, r) => acc + (r[`actual_${h}`] || 0), 0);
            } else {
                const dashRow = outRows.find(r => r.model_name === "--");
                out = dashRow ? (dashRow[`actual_${h}`] || 0) : 0;
            }

            const ct = ctRow[`cycle_${h}`] || 0;
            const currentAvail = availRow[`avail_${h}`] || 0;

            if (out > 0 && currentAvail === 0) {
                const theoreticalMax = ct > 0 ? 3600 / ct : 0;
                const efficiency = theoreticalMax > 0 ? (out / theoreticalMax) * 100 : 0;
                dataUpdates[`avail_${h}`] = parseFloat(efficiency.toFixed(2));
                console.log(`[${machine_name}] Syncing avail_${h} = ${efficiency.toFixed(2)}% (out: ${out}, ct: ${ct})`);
            }
        }

        if (Object.keys(dataUpdates).length > 0) {
            await prisma.tb_availability_actual.update({
                where: { id: availRow.id },
                data: dataUpdates
            });
        }
    }
    await prisma.$disconnect();
}
main().catch(console.error);
