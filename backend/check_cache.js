const cacheService = require('./services/cacheService');
const cronService = require('./services/cronService');

async function test() {
    await cacheService.hydrateFromMSSQL();
    const rt = cacheService.getRuntime('ABR-003');
    const av = cacheService.getAvailability('ABR-003');
    console.log('Runtime:', JSON.stringify(rt));
    console.log('Availability:', JSON.stringify(av));
}
test().finally(() => process.exit());
