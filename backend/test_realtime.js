const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calcMcStatusDurations } = require('./services/oeeCalcService');

async function test() {
    // Mimic exactly what realtimeService.js evaluates right now
    const nowLocal = new Date('2026-04-20T15:24:00+07:00'); // the time of the screenshot
    const now = new Date(nowLocal.getTime());
    
    // start is the start of current UTC hour. Hour 15 TH = 08:00 - 09:00 UTC
    const start = new Date('2026-04-20T08:00:00.000Z');
    
    // Also shiftStart for query
    const shiftStart = new Date(Date.UTC(2026, 3, 20, 7, 0, 0)); // 07:00 UTC = 14:00 TH
    const TH_OFFSET_MS = 7 * 60 * 60 * 1000;
    const nowTH = new Date(now.getTime() + TH_OFFSET_MS);

    // Fetch records representing sharedMcRecordsCache
    const todayMcStatus = await prisma.tb_MCStatus.findMany({
        where: { MC: 'ABR-003', Datetime: { gte: shiftStart, lte: nowTH } },
        orderBy: { Datetime: 'asc' },
        select: { MC: true, Datetime: true, MCStatus: true }
    });

    const carryOverRows = await prisma.$queryRaw`
        SELECT MC, MCStatus, Datetime FROM (
            SELECT MC, MCStatus, Datetime, ROW_NUMBER() OVER (PARTITION BY MC ORDER BY Datetime DESC) AS rn
            FROM tb_MCStatus WHERE MC='ABR-003' AND Datetime < ${shiftStart}
        ) t WHERE rn = 1
    `;

    const mcRecords = [];
    if (carryOverRows && carryOverRows.length > 0) {
        mcRecords.push({ ...carryOverRows[0], Datetime: shiftStart });
    }
    mcRecords.push(...todayMcStatus);
    
    console.log("mcRecords fetched:", mcRecords);

    // Calculate currentHourRun
    const TH_OFFSET = 7 * 3600000;
    const startTH = new Date(new Date(start).getTime() + TH_OFFSET); // 15:00 UTC?
    // Wait... start is 08:00 UTC. 08:00 UTC + 7h = 15:00 UTC.
    const nowTH_calc = new Date(now.getTime() + TH_OFFSET); // 08:24 UTC + 7h = 15:24 UTC
    
    console.log("start:", start.toISOString());
    console.log("startTH:", startTH.toISOString());
    console.log("now:", now.toISOString());
    console.log("nowTH_calc:", nowTH_calc.toISOString());

    const { runTimeSeconds, excludedSeconds } = calcMcStatusDurations(mcRecords, startTH, nowTH_calc);
    console.log("runTimeSeconds:", runTimeSeconds, "excludedSeconds:", excludedSeconds);
    
    const totalHourSecs = Math.max(0, (now.getTime() - start.getTime()) / 1000);
    console.log("totalHourSecs:", totalHourSecs);
    
    let calcAvailability = (runTime, excluded, totalSecs) => {
        const d = totalSecs - excluded;
        return d > 0 ? (runTime / d) * 100 : 0;
    };
    
    console.log("calcAvailability:", calcAvailability(runTimeSeconds, excludedSeconds, totalHourSecs));
}

test().finally(()=>process.exit());
