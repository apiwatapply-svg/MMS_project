const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.tbm_machine.findMany({ where: { status: 'active' } }).then(machines => {
    console.log("Machines:", machines.map(m => m.machine_name).join(', '));
    p.$disconnect();
});
