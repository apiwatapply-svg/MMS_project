/**
 * fix_model_name.js
 * ─────────────────────────────────────────────────────────────
 * Migration script: แก้ไขแถว model_name = "--" ใน tb_output_actual
 *
 * Logic:
 *   Case A: มีทั้ง "--" และ model จริง (เช่น "Dorado 10D") สำหรับ machine+date เดียวกัน
 *           → ลบแถว "--" ออก (เพราะข้อมูลซ้ำกัน)
 *
 *   Case B: มีแค่ "--" ไม่มี model จริง
 *           → Query InfluxDB หา LAST("Model") สำหรับ machine+date นั้น
 *           → Update model_name เป็น model จริง
 *           → ถ้า Influx ไม่มีข้อมูล → ทิ้งไว้เป็น "--" (ไม่แตะ)
 *
 * Run: node scripts/fix_model_name.js
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const Influx = require("influx");

const prisma = new PrismaClient();

const influxClient = new Influx.InfluxDB({
    host: process.env.INFLUX_HOST || "192.168.100.99",
    port: parseInt(process.env.INFLUX_PORT || "5012"),
    database: process.env.INFLUX_DATABASE || "machine_db",
});

const measurement = process.env.INFLUX_MEASUREMENT || "data_tb";

/**
 * ดึง LAST("Model") จาก InfluxDB สำหรับ machine+date ที่กำหนด
 * @param {string} machineName
 * @param {Date}   date  - UTC date object (00:00 UTC = start of shift)
 * @returns {string|null}
 */
async function getModelFromInflux(machineName, date) {
    try {
        // Shift window: วันนั้น 00:00 UTC ถึง วันถัดไป 00:00 UTC (= 07:00–07:00 TH)
        const shiftStart = new Date(date);
        const shiftEnd   = new Date(date.getTime() + 24 * 60 * 60 * 1000);

        const startISO = shiftStart.toISOString();
        const endISO   = shiftEnd.toISOString();

        const query = `
            SELECT LAST("Model") AS "model_name"
            FROM "${measurement}"
            WHERE "machine_name" = '${machineName}'
            AND time >= '${startISO}' AND time < '${endISO}'
        `;

        const results = await influxClient.query(query);
        if (results.length > 0) {
            return results[0].model_name || results[0].last || null;
        }
        return null;
    } catch (err) {
        console.error(`   ⚠️  InfluxDB query failed (${machineName}):`, err.message);
        return null;
    }
}

async function main() {
    console.log("🔧 Starting fix_model_name migration...\n");

    // 1. ดึงแถว "--" ทั้งหมด
    const dashRows = await prisma.tb_output_actual.findMany({
        where: { model_name: "--" },
        orderBy: [{ machine_name: "asc" }, { date: "asc" }],
    });

    if (dashRows.length === 0) {
        console.log('✅ ไม่พบแถว model_name = "--" ในระบบ');
        await prisma.$disconnect();
        return;
    }

    console.log(`📋 พบแถว model_name="--" ทั้งหมด ${dashRows.length} แถว\n`);

    let deletedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const row of dashRows) {
        const { id, machine_name, date } = row;
        const dateStr = date.toISOString().split("T")[0];

        // 2. เช็คว่ามี model จริง (ไม่ใช่ "--") สำหรับ machine+date นี้หรือไม่
        const realModelRow = await prisma.tb_output_actual.findFirst({
            where: {
                machine_name,
                date,
                model_name: { not: "--" },
            },
        });

        if (realModelRow) {
            // ─── Case A: มีแถว model จริงอยู่แล้ว → ลบแถว "--" ออก ───
            await prisma.tb_output_actual.delete({ where: { id } });
            console.log(`   🗑️  [Case A] ลบ "${machine_name}" ${dateStr} model="--" (มี "${realModelRow.model_name}" อยู่แล้ว)`);
            deletedCount++;
        } else {
            // ─── Case B: มีแค่ "--" → หา model จริงจาก InfluxDB ───
            const realModel = await getModelFromInflux(machine_name, date);

            if (realModel && realModel !== "--") {
                await prisma.tb_output_actual.update({
                    where: { id },
                    data: { model_name: realModel },
                });
                console.log(`   ✏️  [Case B] อัปเดต "${machine_name}" ${dateStr} "--" → "${realModel}"`);
                updatedCount++;
            } else {
                console.log(`   ⏭️  [Skip] "${machine_name}" ${dateStr} — Influx ไม่มีข้อมูล Model`);
                skippedCount++;
            }
        }
    }

    console.log(`
╔════════════════════════════════════╗
║ สรุปผล Migration                    ║
╠════════════════════════════════════╣
║  ลบ (Case A - มี model ซ้อน): ${String(deletedCount).padStart(4)}  ║
║  อัปเดต (Case B - ได้จาก Influx): ${String(updatedCount).padStart(4)}║
║  ข้าม (ไม่มีข้อมูลใน Influx):    ${String(skippedCount).padStart(4)}║
╚════════════════════════════════════╝`);

    await prisma.$disconnect();
    console.log("\n✅ Migration เสร็จสิ้น");
}

main().catch((err) => {
    console.error("❌ Migration failed:", err.message);
    prisma.$disconnect();
    process.exit(1);
});
