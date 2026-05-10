require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const today = new Date('2026-04-23'); // Today
    const machine = 'ABR-003';

    console.log('--- OEE TABLE ---');
    const oee = await p.tb_oee.findFirst({ where: { machine_name: machine, date: today } });
    console.log(oee);

    console.log('\n--- OUTPUT ACTUAL ---');
    const out = await p.tb_output_actual.findMany({ where: { machine_name: machine, date: today } });
    let totalOut = 0;
    out.forEach(o => {
        let hSum = 0;
        for(let i=0; i<24; i++) {
            const h = String(i).padStart(2, '0');
            hSum += o[`actual_${h}`] || 0;
        }
        console.log(`Model: ${o.model_name}, Total: ${hSum}`);
        totalOut += hSum;
    });

    console.log('\n--- TARGET ---');
    const tgt = await p.tb_output_target.findFirst({ where: { machine_name: machine, date: today } });
    console.log(`Target CT: ${tgt?.cycle_time_target}`);

    console.log('\n--- RUNTIME HOURLY ---');
    const rt = await p.tb_mc_runtime_hourly.findFirst({ where: { machine_name: machine, date: today } });
    if(rt){
        for(let i=0; i<24; i++) {
            const h = String(i).padStart(2, '0');
            if(rt[`runtime_${h}`] > 0 || rt[`excluded_${h}`] > 0){
                console.log(`Hour ${h}: RT=${Math.round(rt[`runtime_${h}`])}s, EXC=${Math.round(rt[`excluded_${h}`])}s`);
            }
        }
    }
}
main().catch(console.error).finally(() => p.$disconnect());
