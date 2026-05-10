const cronService = require('./services/cronService');

async function fix() {
    console.log("Fixing Hour 13 and Hour 14 for ABR...");
    
    // Hour 13 (13:00 - 14:00 TH) is 06:00 - 07:00 UTC
    const start13 = new Date('2026-04-20T06:00:00.000Z');
    const end13 = new Date('2026-04-20T07:00:00.000Z');
    const targetDate = new Date('2026-04-20');
    
    await cronService.upsertRuntimeAndAvailabilityForHour("13", start13, end13, targetDate, ['ABR-003'], null);
    
    // Hour 14 (14:00 - 15:00 TH) is 07:00 - 08:00 UTC
    const start14 = new Date('2026-04-20T07:00:00.000Z');
    const end14 = new Date('2026-04-20T08:00:00.000Z');
    await cronService.upsertRuntimeAndAvailabilityForHour("14", start14, end14, targetDate, ['ABR-003'], null);
    
    console.log("Done fixing.");
}

fix().finally(() => process.exit());
