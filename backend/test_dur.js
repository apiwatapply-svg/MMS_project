const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { calcMcStatusDurations } = require('./services/oeeCalcService');
async function test() {
    const TH_OFFSET_MS = 7 * 60 * 60 * 1000;
    const startTH = new Date('2026-04-20T14:00:00.000Z');
    const endTH = new Date('2026-04-20T15:00:00.000Z');
    
    const mcStatusRows = await prisma.tb_MCStatus.findMany({
        where: { MC: 'ABR-003', Datetime: { gte: startTH, lt: endTH } },
        orderBy: { Datetime: 'asc' },
        select: { MC: true, Datetime: true, MCStatus: true }
    });
    
    const carryOverRows = await prisma.$queryRaw`SELECT MC, MCStatus, Datetime FROM (SELECT MC, MCStatus, Datetime, ROW_NUMBER() OVER (PARTITION BY MC ORDER BY Datetime DESC) AS rn FROM tb_MCStatus WHERE MC='ABR-003' AND Datetime < ${startTH}) t WHERE rn = 1`;
    
    const allMcRecs = [];
    if (carryOverRows && carryOverRows.length > 0) {
        allMcRecs.push({ MC: carryOverRows[0].MC, Datetime: startTH, MCStatus: carryOverRows[0].MCStatus });
    }
    allMcRecs.push(...mcStatusRows);
    
    console.log("Records passed to calcMcStatusDurations:", allMcRecs);
    const { runTimeSeconds, excludedSeconds } = calcMcStatusDurations(allMcRecs, startTH, endTH);
    console.log('RunTime:', runTimeSeconds, 'Excluded:', excludedSeconds);
}
test().finally(()=>process.exit());
