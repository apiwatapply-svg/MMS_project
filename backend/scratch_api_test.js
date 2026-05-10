const influxService = require('./services/influxService');

async function check() {
    influxService.initClient();
    const client = influxService.getClient();

    const query = `
        SELECT *
        FROM "data_tb"
        WHERE "machine_name" = 'ABR-003'
        AND time >= '2026-04-18T05:00:00Z' AND time < '2026-04-18T06:00:00Z'
        LIMIT 5
    `;

    try {
        const results = await client.query(query);
        console.log("Raw points for Hour 12 (12:00-13:00 TH):");
        console.log(JSON.stringify(results, null, 2));
    } catch (err) {
        console.error(err);
    }
}
check();
