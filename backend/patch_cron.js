const fs = require('fs');
let code = fs.readFileSync('services/cronService.js', 'utf8');

// The block to move
const phase25and26 = `        // 2.5 🆕 Sync Status/Alarm Events from InfluxDB for the last hour
        try {
            console.log(\`   🔄 Syncing InfluxDB events to MSSQL for last hour...\`);
            await syncEventsFromInfluxDb(start, end);
        } catch (e) {
            console.error("   ⚠️ Failed to sync InfluxDB events in summarizeLastHour:", e.message);
        }

        // 2.6 🆕 [Phase 6] Runtime + Availability per machine for the last hour
        try {
            await upsertRuntimeAndAvailabilityForHour(thColumn, start, end, targetDate, Object.keys(machineData), machineData);
        } catch (e) {
            console.error("   ⚠️ Failed to upsert runtime/availability in summarizeLastHour:", e.message);
        }`;

// Remove it from the original location
code = code.replace(phase25and26, "");

// Insert it right before the Phase 2 loop
const targetMarker = `        const targetDate = new Date(dateStr);`;
code = code.replace(targetMarker, targetMarker + "\n\n" + phase25and26);

// Now, update Phase 2 loop to support ct_calc_modes
const oldLoopBody = `            const { output_count, avg_cycle_time } = data;
            const theoreticalMax = avg_cycle_time > 0 ? 3600 / avg_cycle_time : 0;
            const efficiency = theoreticalMax > 0 ? (output_count / theoreticalMax) * 100 : 0;

            // ✅ Run 3 upserts in parallel instead of sequential
            await Promise.all([
                upsertHourlyField("tb_output_actual", machineName, targetDate, \`actual_\${thColumn}\`, output_count, "Overall", null),
                upsertHourlyField("tb_cycle_time_actual", machineName, targetDate, \`cycle_\${thColumn}\`, parseFloat(avg_cycle_time.toFixed(2)), "cycle_time", null),
                upsertHourlyField("tb_efficiency_actual", machineName, targetDate, \`eff_\${thColumn}\`, parseFloat(efficiency.toFixed(2)), "eff_actual", null),
            ]);

            cacheService.updateHour(machineName, thColumn, output_count, avg_cycle_time, efficiency);
            console.log(\`   ✅ \${machineName}: output=\${output_count}, ct=\${avg_cycle_time.toFixed(2)}, eff=\${efficiency.toFixed(1)}%\`);`;

const newLoopBody = `            let { output_count, avg_cycle_time } = data;
            
            // 🆕 Support ct_calc_modes
            const ctMode = getCTCalcMode(machineName);
            if (ctMode === "runtime_based") {
                const mcCache = cacheService.getMachineCache(machineName) || { runtime: {} };
                // 🕒 Because Phase 2.6 ran first, runtime cache is already updated for this hour!
                const hourRuntime = mcCache.runtime[\`runtime_\${thColumn}\`] || 0;
                if (output_count > 0) {
                    avg_cycle_time = hourRuntime / output_count;
                } else {
                    avg_cycle_time = 0;
                }
            }
            
            const theoreticalMax = avg_cycle_time > 0 ? 3600 / avg_cycle_time : 0;
            const efficiency = theoreticalMax > 0 ? (output_count / theoreticalMax) * 100 : 0;

            // ✅ Run 3 upserts in parallel instead of sequential
            await Promise.all([
                upsertHourlyField("tb_output_actual", machineName, targetDate, \`actual_\${thColumn}\`, output_count, "Overall", null),
                upsertHourlyField("tb_cycle_time_actual", machineName, targetDate, \`cycle_\${thColumn}\`, parseFloat(avg_cycle_time.toFixed(2)), "cycle_time", null),
                upsertHourlyField("tb_efficiency_actual", machineName, targetDate, \`eff_\${thColumn}\`, parseFloat(efficiency.toFixed(2)), "eff_actual", null),
            ]);

            cacheService.updateHour(machineName, thColumn, output_count, avg_cycle_time, efficiency);
            console.log(\`   ✅ \${machineName}: output=\${output_count}, ct=\${avg_cycle_time.toFixed(2)}, eff=\${efficiency.toFixed(1)}%\`);`;

code = code.replace(oldLoopBody, newLoopBody);

fs.writeFileSync('services/cronService.js', code);
console.log("Patched cronService.js");
