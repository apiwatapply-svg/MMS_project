const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const HOURS = [
  "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18",
  "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06",
];

const START = new Date("2026-05-01T00:00:00.000Z");
const END = new Date("2026-06-30T00:00:00.000Z");
const MODEL_BY_TYPE = new Map([
  ["ACR", "ACR-MODEL-A"],
  ["AHV", "AHV-DORADO"],
  ["ABR", "ABR-PROD"],
  ["ACP", "ACP-LINE"],
  ["GE2", "GE2-HGA"],
  ["HEL", "HEL-MOTOR"],
  ["LSW", "LSW-WELD"],
  ["VNS", "VNS-ASSY"],
]);

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
    skipStatus: process.argv.includes("--skip-status"),
    fillMissingOnly: process.argv.includes("--fill-missing-only"),
  };
}

function daysBetween(start, end) {
  const days = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
    days.push(new Date(d));
  }
  return days;
}

function hourFields(prefix, base, variance, dayIndex, machineIndex) {
  return HOURS.reduce((acc, hour, hourIndex) => {
    const wave = ((dayIndex + hourIndex + machineIndex) % 7) - 3;
    const value = Math.max(0, Math.round(base + wave * variance));
    acc[`${prefix}_${hour}`] = value;
    return acc;
  }, {});
}

function floatHourFields(prefix, base, variance, dayIndex, machineIndex) {
  return HOURS.reduce((acc, hour, hourIndex) => {
    const wave = ((dayIndex + hourIndex + machineIndex) % 9) - 4;
    acc[`${prefix}_${hour}`] = Number(Math.max(0, base + wave * variance).toFixed(2));
    return acc;
  }, {});
}

function modelFor(machine) {
  return MODEL_BY_TYPE.get(machine.machine_type) || `${machine.machine_type}-STD`;
}

function dailyProfile(machine, dayIndex, machineIndex) {
  const typeWeight = Math.max(1, machine.machine_type.charCodeAt(0) % 7);
  const baseTarget = 34 + typeWeight * 3 + (machineIndex % 5);
  const targetFields = hourFields("target", baseTarget, 2, dayIndex, machineIndex);
  const actualFields = hourFields("actual", baseTarget - 3, 3, dayIndex, machineIndex);
  const cycleFields = floatHourFields("cycle", 8 + (machineIndex % 8) * 0.55, 0.08, dayIndex, machineIndex);
  const effFields = floatHourFields("eff", 86 + (machineIndex % 8), 0.45, dayIndex, machineIndex);
  const availFields = floatHourFields("avail", 88 + (machineIndex % 7), 0.35, dayIndex, machineIndex);
  const runtimeFields = floatHourFields("runtime", 50 + (machineIndex % 9), 1.1, dayIndex, machineIndex);
  const excludedFields = floatHourFields("excluded", 3 + (machineIndex % 3), 0.25, dayIndex, machineIndex);

  const targetTotal = Object.values(targetFields).reduce((sum, value) => sum + value, 0);
  const actualTotal = Object.values(actualFields).reduce((sum, value) => sum + value, 0);
  const avgCycle = average(Object.values(cycleFields));
  const avgEff = average(Object.values(effFields));
  const avgAvail = average(Object.values(availFields));
  const ngQty = Math.max(0, Math.round(actualTotal * (0.015 + (machineIndex % 5) * 0.002)));
  const quality = actualTotal ? Number((((actualTotal - ngQty) / actualTotal) * 100).toFixed(2)) : 0;
  const performance = Number(Math.min(100, (actualTotal / Math.max(1, targetTotal)) * 100).toFixed(2));
  const oee = Number(((avgAvail * performance * quality) / 10000).toFixed(2));

  return {
    targetFields,
    actualFields,
    cycleFields,
    effFields,
    availFields,
    runtimeFields,
    excludedFields,
    targetTotal,
    actualTotal,
    avgCycle,
    avgEff,
    avgAvail,
    ngQty,
    quality,
    performance,
    oee,
  };
}

function average(values) {
  const valid = values.map(Number).filter((value) => value > 0);
  if (!valid.length) return 0;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2));
}

async function upsertTarget(date, machine, modelName, profile) {
  const existing = await prisma.tb_output_target.findFirst({
    where: { date, machine_name: machine.machine_name, model_name: modelName },
  });

  const data = {
    date,
    machine_name: machine.machine_name,
    model_name: modelName,
    pc_target: profile.targetTotal,
    cycle_time_target: profile.avgCycle,
    eff_target: 90,
    accum_target: profile.targetTotal,
    model_type: machine.machine_type,
    process_name: machine.full_machine_type || machine.machine_type,
    ...profile.targetFields,
  };

  if (existing) {
    await prisma.tb_output_target.update({ where: { id: existing.id }, data });
  } else {
    await prisma.tb_output_target.create({ data });
  }
}

async function seedStatusRows(date, machine, dayIndex, machineIndex) {
  const day = date.toISOString().slice(0, 10);
  await prisma.tb_MCStatus.deleteMany({
    where: {
      MC: machine.machine_name,
      Datetime: {
        gte: new Date(`${day}T00:00:00.000Z`),
        lt: new Date(new Date(`${day}T00:00:00.000Z`).getTime() + 86400000),
      },
      Remark: "portfolio_mock",
    },
  });

  const statuses = [
    { hour: "07:00:00", status: "Run_Time" },
    { hour: "10:15:00", status: (machineIndex + dayIndex) % 4 === 0 ? "MC_Alarm" : "Run_Time" },
    { hour: "11:00:00", status: "Run_Time" },
    { hour: "15:30:00", status: (machineIndex + dayIndex) % 6 === 0 ? "MM_Repair" : "Run_Time" },
    { hour: "16:30:00", status: "Run_Time" },
    { hour: "23:00:00", status: "Run_Time" },
  ];

  await prisma.tb_MCStatus.createMany({
    data: statuses.map((item) => ({
      Datetime: new Date(`${day}T${item.hour}.000Z`),
      MC: machine.machine_name,
      MCStatus: item.status,
      UTC_Time: new Date(`${day}T${item.hour}.000Z`),
      Remark: "portfolio_mock",
    })),
  });
}

async function main() {
  const { dryRun, skipStatus, fillMissingOnly } = parseArgs();
  const machines = await prisma.tbm_machine.findMany({
    where: { status: "active" },
    orderBy: [{ machine_area: "asc" }, { machine_type: "asc" }, { machine_name: "asc" }],
  });

  if (!machines.length) {
    throw new Error("No active machines found. Run prisma/seed_machines.js first.");
  }

  const days = daysBetween(START, END);
  const typeCount = new Set(machines.map((machine) => machine.machine_type)).size;

  console.log(`Portfolio demo seed: ${machines.length} machines, ${typeCount} types, ${days.length} days`);
  console.log(`Range: ${START.toISOString().slice(0, 10)} to ${END.toISOString().slice(0, 10)}`);

  if (dryRun) {
    console.log("Dry run only. No database rows were changed.");
    return;
  }

  let written = 0;

  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const date = days[dayIndex];
    for (let machineIndex = 0; machineIndex < machines.length; machineIndex += 1) {
      const machine = machines[machineIndex];
      const modelName = modelFor(machine);
      const profile = dailyProfile(machine, dayIndex, machineIndex);

      if (fillMissingOnly) {
        const existingOee = await prisma.tb_oee.findUnique({
          where: { machine_name_date: { machine_name: machine.machine_name, date } },
          select: { id: true },
        });
        if (existingOee) continue;
      }

      await upsertTarget(date, machine, modelName, profile);

      await prisma.tb_output_actual.upsert({
        where: {
          machine_name_date_model_name: {
            machine_name: machine.machine_name,
            date,
            model_name: modelName,
          },
        },
        update: { ...profile.actualFields, Overall: profile.actualTotal },
        create: {
          date,
          machine_name: machine.machine_name,
          model_name: modelName,
          ...profile.actualFields,
          Overall: profile.actualTotal,
        },
      });

      await prisma.tb_cycle_time_actual.upsert({
        where: { machine_name_date: { machine_name: machine.machine_name, date } },
        update: { ...profile.cycleFields, cycle_time: profile.avgCycle },
        create: { date, machine_name: machine.machine_name, ...profile.cycleFields, cycle_time: profile.avgCycle },
      });

      await prisma.tb_efficiency_actual.upsert({
        where: { machine_name_date: { machine_name: machine.machine_name, date } },
        update: { ...profile.effFields, eff_actual: profile.avgEff },
        create: { date, machine_name: machine.machine_name, ...profile.effFields, eff_actual: profile.avgEff },
      });

      await prisma.tb_availability_actual.upsert({
        where: { machine_name_date: { machine_name: machine.machine_name, date } },
        update: { ...profile.availFields, avail_actual: profile.avgAvail },
        create: { date, machine_name: machine.machine_name, ...profile.availFields, avail_actual: profile.avgAvail },
      });

      await prisma.tb_mc_runtime_hourly.upsert({
        where: { machine_name_date: { machine_name: machine.machine_name, date } },
        update: {
          ...profile.runtimeFields,
          ...profile.excludedFields,
          runtime_total: average(Object.values(profile.runtimeFields)) * HOURS.length,
          excluded_total: average(Object.values(profile.excludedFields)) * HOURS.length,
        },
        create: {
          date,
          machine_name: machine.machine_name,
          ...profile.runtimeFields,
          ...profile.excludedFields,
          runtime_total: average(Object.values(profile.runtimeFields)) * HOURS.length,
          excluded_total: average(Object.values(profile.excludedFields)) * HOURS.length,
        },
      });

      await prisma.tb_oee.upsert({
        where: { machine_name_date: { machine_name: machine.machine_name, date } },
        update: {
          availability: profile.avgAvail,
          performance: profile.performance,
          quality: profile.quality,
          oee_value: profile.oee,
          ng_qty: profile.ngQty,
        },
        create: {
          date,
          machine_name: machine.machine_name,
          availability: profile.avgAvail,
          performance: profile.performance,
          quality: profile.quality,
          oee_value: profile.oee,
          ng_qty: profile.ngQty,
        },
      });

      if (!skipStatus) {
        await seedStatusRows(date, machine, dayIndex, machineIndex);
      }
      written += 1;
    }

    console.log(`Seeded ${date.toISOString().slice(0, 10)} (${dayIndex + 1}/${days.length})`);
  }

  console.log(`Done. Seeded ${written} machine-days across ${machines.length} machines and ${typeCount} types.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
