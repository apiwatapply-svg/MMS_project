require('dotenv').config();
const influxService = require('../services/influxService');
influxService.initClient();

async function main() {
    const today = '2026-04-21';
    // TH 09:00-10:00 = UTC 02:00-03:00
    const start = new Date(today + 'T02:00:00.000Z');
    const end   = new Date(today + 'T03:00:00.000Z');
    console.log('Querying InfluxDB data_tb for ABR-003 hour 09:00-10:00 TH (02:00-03:00 UTC)...');
    const data = await influxService.queryAllMachinesForHour(start, end);
    const abr = data['ABR-003'];
    if (!abr) {
        console.log('⚠️  NO data for ABR-003 in InfluxDB for this hour!');
    } else {
        console.log('InfluxDB result:', JSON.stringify(abr, null, 2));
    }

    // Also check status_tb
    const statusData = await influxService.queryStatusRange(start, end);
    const abrStatus = statusData.filter(d => d.machine_name === 'ABR-003');
    console.log(`\nstatus_tb records for ABR-003 (02:00-03:00 UTC): ${abrStatus.length}`);
    for (const r of abrStatus) {
        console.log(`  ${r.time.toISOString()} → ${r.status}`);
    }
}

main().catch(console.error);
