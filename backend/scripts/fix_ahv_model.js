require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { SHIFT_HOURS } = require('../utils/timeUtils');
const prisma = new PrismaClient();

async function mergeAllAhvModels() {
    console.log(`\n🧹 Starting Data Clean-up for ALL historical AHV records...`);

    const ahvMachines = await prisma.tbm_machine.findMany({
        where: { machine_name: { startsWith: 'AHV-' }, status: 'active' },
        select: { machine_name: true }
    });

    let modifiedCount = 0;

    for (const { machine_name } of ahvMachines) {
        // หาแถวทีเเป็น "--" ทั้งหมดของเครื่องนี้ (ข้ามวันไปเลย)
        const dashRows = await prisma.tb_output_actual.findMany({
            where: { machine_name, model_name: '--' }
        });

        for (const dashRow of dashRows) {
            const targetDate = dashRow.date;
            
            let doradoRow = await prisma.tb_output_actual.findFirst({
                where: { machine_name, date: targetDate, model_name: 'Dorado 10D' }
            });

            // ถ้ายังไม่มี Dorado 10D ให้สร้างใหม่ก่อน
            if (!doradoRow) {
                doradoRow = await prisma.tb_output_actual.create({
                    data: { machine_name, date: targetDate, model_name: 'Dorado 10D' }
                });
                console.log(`  ➕ Created "Dorado 10D" row for ${machine_name} on ${targetDate.toISOString().split('T')[0]}`);
            }

            // โอนถ่ายข้อมูลจาก "--" ไปหา "Dorado 10D"
            const updateData = {};
            let newOverall = doradoRow.Overall || 0;

            for (const h of SHIFT_HOURS) {
                const dashVal = dashRow[`actual_${h}`] || 0;
                const doradoVal = doradoRow[`actual_${h}`] || 0;
                if (dashVal > 0) {
                    updateData[`actual_${h}`] = doradoVal + dashVal;
                    newOverall += dashVal;
                }
            }
            updateData.Overall = newOverall;

            // Save "Dorado 10D"
            await prisma.tb_output_actual.update({
                where: { id: doradoRow.id },
                data: updateData
            });

            // ลบแถว "--" ทิ้งอย่างถาวร
            await prisma.tb_output_actual.delete({
                where: { id: dashRow.id }
            });

            console.log(`  ✅ Merged & Cleaned: ${machine_name} on ${targetDate.toISOString().split('T')[0]}`);
            modifiedCount++;
        }
    }

    console.log(`\n🎉 Success! Cleaned ${modifiedCount} historical records.`);
    prisma.$disconnect();
}

mergeAllAhvModels().catch(e => { console.error(e.message); prisma.$disconnect(); });
