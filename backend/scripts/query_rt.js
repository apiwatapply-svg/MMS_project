const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 
async function main() { 
    const d = new Date('2026-04-21T00:00:00Z'); 
    
    const rt = await prisma.tb_mc_runtime_hourly.findFirst({
        where:{machine_name:'ABR-003'},
        orderBy:{date:'desc'}
    }); 
    const oee = await prisma.tb_oee.findFirst({
        where:{machine_name:'ABR-003'},
        orderBy:{date:'desc'}
    }); 
    const avail = await prisma.tb_availability_actual.findFirst({
        where:{machine_name:'ABR-003'},
        orderBy:{date:'desc'}
    });
    console.log(JSON.stringify({rt, oee, avail}, null, 2)); 
} 
main().finally(()=>prisma.$disconnect());
