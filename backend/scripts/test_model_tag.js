require('dotenv').config();
const influxService = require('../services/influxService');
influxService.initClient();

async function main() {
    const now = new Date();
    // Query ชั่วโมงปัจจุบัน (13:00-14:00 TH = 06:00-07:00 UTC)
    const start = new Date(now);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    console.log(`\nQuerying InfluxDB data_tb for current hour (${start.toISOString()} → ${end.toISOString()})...\n`);

    const data = await influxService.queryAllMachinesForHour(start, end);

    // แสดง ABR machines
    const abrMachines = Object.keys(data).filter(m => m.startsWith('ABR'));
    if (abrMachines.length === 0) {
        console.log('⚠️  ไม่พบข้อมูล ABR machines ในขณะนี้');
    } else {
        for (const m of abrMachines) {
            const d = data[m];
            console.log(`${m}: output=${d.output_count}, avg_CT=${d.avg_cycle_time?.toFixed(2)}`);
            console.log(`  Models: ${JSON.stringify(d.models)}`);
        }
    }

    // Raw query เพื่อดู tag จริงๆ จาก InfluxDB
    console.log('\n--- Raw InfluxDB rows (last 5 records ABR-003) ---');
    const client = influxService.getClient();
    const rawResults = await client.query(`
        SELECT "cycle_time", "Total", "Model"
        FROM "data_tb"
        WHERE "machine_name" = 'ABR-003'
        AND time >= '${start.toISOString()}' AND time < '${end.toISOString()}'
        ORDER BY time DESC LIMIT 5
    `);
    if (rawResults.length === 0) {
        console.log('  ⚠️  ไม่มี record ในชั่วโมงนี้');
    } else {
        for (const r of rawResults) {
            // ลอง access Model ทั้งสองวิธี
            const modelField = r.Model;
            const modelTag = r.tags?.Model || r.machine_name; // tags object
            console.log(`  time=${r.time.toISOString()} | cycle_time=${r.cycle_time} | Total=${r.Total}`);
            console.log(`    r.Model (field)=${modelField} | r.tags?.Model (tag)=${modelTag}`);
        }
    }
}

main().catch(console.error);
