require('dotenv').config();
const influxService = require('../services/influxService');
influxService.initClient();

async function main() {
    const now = new Date();
    const start = new Date(now);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const client = influxService.getClient();

    // Test 1: GROUP BY การen tag "Model" — ดูว่า influx npm return อะไร
    console.log('=== Test 1: GROUP BY Model tag ===');
    const r1 = await client.query(`
        SELECT COUNT("cycle_time") AS cnt, MEAN("cycle_time") AS avg_ct
        FROM "data_tb"
        WHERE "machine_name" = 'ABR-003'
          AND time >= '${start.toISOString()}' AND time < '${end.toISOString()}'
        GROUP BY "Model"
    `);
    console.log('Result rows:', r1.length);
    for (const r of r1) {
        console.log('  row keys:', Object.keys(r));
        console.log('  row:', JSON.stringify(r));
    }

    // Test 2: ดู last record ที่ Model เป็น Tag จริงๆ
    console.log('\n=== Test 2: SELECT LAST with Model as tag ===');
    const r2 = await client.query(`
        SELECT LAST("cycle_time"), "Total"
        FROM "data_tb"
        WHERE "machine_name" = 'ABR-003'
          AND time >= '${start.toISOString()}' AND time < '${end.toISOString()}'
        GROUP BY "Model"
    `);
    console.log('Result rows:', r2.length);
    for (const r of r2) {
        console.log('  row:', JSON.stringify(r));
    }
}

main().catch(console.error);
