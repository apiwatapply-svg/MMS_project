require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const { calcMcStatusDurations } = require('../services/oeeCalcService');

async function main() {
    // Window hour 13: UTC 06:00-07:00
    const startUTC = new Date('2026-04-22T06:00:00.000Z');
    const endUTC   = new Date('2026-04-22T07:00:00.000Z');

    // สิ่งที่ upsertRuntimeAndAvailabilityForHour ทำ
    const TH_OFFSET_MS = 7 * 60 * 60 * 1000;
    const startTH = new Date(startUTC.getTime() + TH_OFFSET_MS);
    const endTH   = new Date(endUTC.getTime()   + TH_OFFSET_MS);

    console.log('startTH (used for query + calc):', startTH.toISOString()); // = 13:00:00Z ← ที่จริงคือ 13:00 TH
    console.log('endTH   (used for query + calc):', endTH.toISOString());   // = 14:00:00Z ← ที่จริงคือ 14:00 TH

    // Query MCStatus เหมือน cronService
    const mcStatusRows = await p.tb_MCStatus.findMany({
        where: { MC: 'ABR-003', Datetime: { gte: startTH, lt: endTH } },
        orderBy: { Datetime: 'asc' },
        select: { Datetime: true, MCStatus: true },
    });

    const carryRows = await p.tb_MCStatus.findFirst({
        where: { MC: 'ABR-003', Datetime: { lt: startTH } },
        orderBy: { Datetime: 'desc' },
        select: { Datetime: true, MCStatus: true },
    });

    console.log('\nCarry-over raw Datetime:', carryRows?.Datetime?.toISOString(), carryRows?.MCStatus);
    console.log('MCStatus in window:');
    mcStatusRows.forEach(r => console.log('  raw:', r.Datetime.toISOString(), r.MCStatus));

    // Build records exactly like cronService does
    const mcRecords = [];
    if (carryRows) {
        mcRecords.push({ Datetime: startTH, MCStatus: carryRows.MCStatus });
    }
    mcRecords.push(...mcStatusRows);

    console.log('\nFinal mcRecords passed to calcMcStatusDurations:');
    mcRecords.forEach(r => console.log('  Datetime.getTime()=', r.Datetime.getTime(), r.Datetime.toISOString(), r.MCStatus));

    console.log('\nstartTH.getTime()=', startTH.getTime());
    console.log('endTH.getTime()=',   endTH.getTime());

    const result = calcMcStatusDurations(mcRecords, startTH, endTH);
    console.log('\n=== calcMcStatusDurations result ===');
    console.log('runTimeSeconds:', result.runTimeSeconds);
    console.log('excludedSeconds:', result.excludedSeconds);
    console.log('totalSeconds:', result.totalSeconds);
}

main().catch(console.error).finally(() => p.$disconnect());
