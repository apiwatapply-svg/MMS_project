require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const today = new Date('2026-04-20T00:00:00.000Z');

async function check() {
    // 1. ตรวจแถว '--' ใน MSSQL วันนี้
    const staleRows = await p.tb_output_actual.findMany({
        where: { date: today, model_name: '--' },
        select: { machine_name: true, model_name: true, actual_07: true, actual_08: true, actual_09: true, actual_10: true, actual_13: true }
    });
    console.log('=== Stale "--" rows today (' + staleRows.length + ' found) ===');
    if (staleRows.length > 0) console.log(JSON.stringify(staleRows, null, 2));
    else console.log('  ✅ NONE — clean!');

    // 2. ตรวจแถว model ทั้งหมดของ AHV-003 วันนี้
    const ahv3Rows = await p.tb_output_actual.findMany({
        where: { date: today, machine_name: 'AHV-003' },
        select: { model_name: true, actual_07: true, actual_08: true, actual_09: true, actual_10: true, actual_11: true, actual_12: true, actual_13: true }
    });
    console.log('\n=== AHV-003 all rows today ===');
    console.log(JSON.stringify(ahv3Rows, null, 2));

    // 3. คำนวณ SUM per hour ของ AHV-003 (ไม่รวม "--")
    const realOnly = ahv3Rows.filter(r => r.model_name !== '--');
    const hours = ['07','08','09','10','11','12','13'];
    console.log('\n=== AHV-003 SUM (excluding "--") ===');
    for (const h of hours) {
        const s = realOnly.reduce((acc, r) => acc + (r['actual_' + h] || 0), 0);
        console.log('  actual_' + h + ' = ' + s);
    }

    p.$disconnect();
}
check().catch(e => { console.error(e.message); p.$disconnect(); });
