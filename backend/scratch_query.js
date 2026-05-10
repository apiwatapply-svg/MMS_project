const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
BigInt.prototype.toJSON = function() { return this.toString() };

async function run() {
    const date16 = new Date('2026-04-16T00:00:00.000Z');
    const HOURS = ['07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','00','01','02','03','04','05','06'];

    console.log("=== AHV-002 output per hour (Apr 16) ===");
    const out = await prisma.tb_output_actual.findFirst({ where: { machine_name: 'AHV-002', date: date16 } });
    if (out) {
        for (const h of HOURS) { if ((out['actual_' + h] || 0) > 0) console.log(`  actual_${h}: ${out['actual_' + h]}`); }
        console.log(`  Overall: ${out.Overall}`);
    } else console.log("  No record");

    console.log("\n=== AHV-002 cycle_time per hour (Apr 16) ===");
    const ct = await prisma.tb_cycle_time_actual.findFirst({ where: { machine_name: 'AHV-002', date: date16 } });
    if (ct) {
        for (const h of HOURS) { if ((ct['cycle_' + h] || 0) > 0) console.log(`  cycle_${h}: ${ct['cycle_' + h]}`); }
        console.log(`  cycle_time overall: ${ct.cycle_time}`);
    } else console.log("  No CT record — this is why A=0 (avgCT fallback=0 → runTime=0)");

    console.log("\n=== AHV-003 OEE entry (check OEE not updated) ===");
    const oee3 = await prisma.tb_oee.findFirst({ where: { machine_name: 'AHV-003', date: date16 } });
    console.log(oee3);
}

run().then(() => { prisma.$disconnect(); process.exit(0); })
     .catch(e => { console.error(e); process.exit(1); });
