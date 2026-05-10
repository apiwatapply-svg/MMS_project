const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 
async function main() { 
    const d = new Date('2026-04-21T00:00:00Z'); 
    const out = await prisma.tb_output_actual.findMany({where:{machine_name:'ABR-003', date:d}}); 
    const ct = await prisma.tb_cycle_time_actual.findFirst({where:{machine_name:'ABR-003', date:d}}); 
    const avail = await prisma.tb_availability_actual.findFirst({where:{machine_name:'ABR-003', date:d}}); 
    const rt = await prisma.tb_mc_runtime_hourly.findFirst({where:{machine_name:'ABR-003', date:d}}); 
    const data = {out, ct, avail, rt};
    console.log(JSON.stringify(data, null, 2)); 
} 
main().finally(()=>prisma.$disconnect());
