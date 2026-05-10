require('dotenv').config();
const influxService = require('../services/influxService');
influxService.initClient();

async function main() {
    const client = influxService.getClient();

    // ดู rows ล่าสุดหลัง Telegraf restart — ช่วง 06:40 UTC เป็นต้นไป
    const results = await client.query(
        `SELECT LAST("cycle_time"), "Total"
         FROM "data_tb"
         WHERE "machine_name" = 'ABR-003'
           AND time >= '2026-04-21T06:40:00Z'
         GROUP BY "Model"
         LIMIT 5`
    );
    console.log('rows:', results.length);
    for (const r of results) {
        console.log(JSON.stringify(r));
    }
}

main().catch(console.error);
