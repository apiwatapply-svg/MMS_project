const cronService = require('./services/cronService');
const influxService = require('./services/influxService');
const { getPreviousHourBoundaries } = require('./utils/timeUtils');

async function debugSummarize() {
    // Override getPreviousHourBoundaries or just provide exact args to a modified query
    const targetDateStr = '2026-04-20';
    const thColumn = '13';
    
    // In UTC, Hour 13 TH is 06:00 to 07:00 UTC
    const start = new Date('2026-04-20T06:00:00.000Z');
    const end = new Date('2026-04-20T07:00:00.000Z');
    const targetDate = new Date(targetDateStr);

    console.log("Querying InfluxDB for Hour 13 (UTC 06-07)...");
    const machineData = await influxService.queryAllMachinesForHour(start, end);
    const machineNames = Object.keys(machineData);
    console.log(`Found ${machineNames.length} machines with data in Influx.`);
    if (machineNames.includes('ABR-003')) {
        console.log("ABR-003 found in InfluxDB output!");
    } else {
        console.log("WAIT. ABR-003 NOT FOUND in InfluxDB output!");
    }

    // Now let's try the DB query exactly as done in cronService
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    const TH_OFFSET_MS = 7 * 60 * 60 * 1000;
    const startTH = new Date(start.getTime() + TH_OFFSET_MS);
    const endTH = new Date(end.getTime() + TH_OFFSET_MS);

    const mcStatusRows = await prisma.tb_MCStatus.findMany({
        where: { Datetime: { gte: startTH, lt: endTH } },
        orderBy: { Datetime: 'asc' },
        select: { MC: true, Datetime: true, MCStatus: true },
    });
    console.log(`Found ${mcStatusRows.length} total MCStatus rows for all machines in hour 13.`);
    
    const carryOverRows = await prisma.$queryRaw`
        SELECT MC, MCStatus, Datetime FROM (
            SELECT MC, MCStatus, Datetime, ROW_NUMBER() OVER (PARTITION BY MC ORDER BY Datetime DESC) AS rn
            FROM tb_MCStatus WHERE Datetime < ${startTH}
        ) t WHERE rn = 1
    `;
    console.log(`Found ${carryOverRows.length} carry over rows.`);
    const abrCarry = carryOverRows.find(r => r.MC === 'ABR-003');
    console.log("Carry over row for ABR-003:", abrCarry);
    
    const mcStatusByMachine = {};
    for (const row of carryOverRows) {
        if (machineNames.includes(row.MC)) {
            mcStatusByMachine[row.MC] = [{ MC: row.MC, Datetime: startTH, MCStatus: row.MCStatus }];
        }
    }
    for (const rec of mcStatusRows) {
        if (!machineNames.includes(rec.MC)) continue;
        if (!mcStatusByMachine[rec.MC]) mcStatusByMachine[rec.MC] = [];
        mcStatusByMachine[rec.MC].push(rec);
    }
    
    console.log("Final records array for ABR-003:");
    console.log(mcStatusByMachine['ABR-003']);
}

debugSummarize().finally(()=>process.exit());
