require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const list = await p.tb_oee.findMany({ 
        where: { availability: { gt: 100 } }
    });
    console.log(`\n--- ANY tb_oee A > 100 ---`, list.length);
    
    const countA = await p.tb_availability_actual.count();
    console.log(`Checked ${countA} availability rows...`);

    const badRows = await p.$queryRaw`
        SELECT machine_name, date FROM tb_availability_actual
        WHERE avail_07 > 100 OR avail_08 > 100 OR avail_09 > 100 OR avail_10 > 100
           OR avail_11 > 100 OR avail_12 > 100 OR avail_13 > 100 OR avail_14 > 100
           OR avail_15 > 100 OR avail_16 > 100 OR avail_17 > 100 OR avail_18 > 100
           OR avail_19 > 100 OR avail_20 > 100 OR avail_21 > 100 OR avail_22 > 100
           OR avail_23 > 100 OR avail_00 > 100 OR avail_01 > 100 OR avail_02 > 100
           OR avail_03 > 100 OR avail_04 > 100 OR avail_05 > 100 OR avail_06 > 100
    `;
    console.log("Bad A Hourly rows:", badRows.length);

    const badPerf = await p.tb_oee.findMany({ 
        where: { performance: { lt: 20, gt: 0 } }
    });
    console.log(`\n--- ANY tb_oee P < 20 ---`);
    for(const o of badPerf.slice(-10)) console.log(o.machine_name, o.date, o.performance);
}
main().catch(console.error).finally(() => p.$disconnect());
