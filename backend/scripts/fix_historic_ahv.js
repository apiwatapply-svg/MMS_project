require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function cleanAll() {
    console.log('🧹 Scanning ALL historical records for AHV machines...');
    const result = await p.tb_output_actual.updateMany({
        where: {
            model_name: '--',
            machine_name: { startsWith: 'AHV-' }
        },
        data: {
            model_name: 'Dorado 10D'
        }
    });

    console.log(`✅ Updated ${result.count} rows from "--" to "Dorado 10D".`);
    p.$disconnect();
}
cleanAll().catch(e => { console.error(e.message); p.$disconnect(); });
