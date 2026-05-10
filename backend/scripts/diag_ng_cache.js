require('dotenv').config();
const cacheService = require('../services/cacheService');
const { PrismaClient } = require('@prisma/client');

async function testCache() {
    const p = new PrismaClient();
    const data = await p.tb_output_actual.findMany({ where: { machine_name: 'ABR-003', date: new Date('2026-04-23') }});
    let sumNg = 0;
    data.forEach(d => {
        for(let i=0; i<24; i++) {
            sumNg += d[`ng_${String(i).padStart(2, '0')}`] || 0;
        }
    });

    console.log("MSSQL sumNg ABR-003:", sumNg);
    
    await p.$disconnect();
}
testCache();
