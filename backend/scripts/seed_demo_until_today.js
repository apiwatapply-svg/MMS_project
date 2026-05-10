const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const HOURS = [
  "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18",
  "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05", "06",
];

const DEFAULT_START = "2026-05-01";
const MODEL_BY_TYPE = new Map([
  ["ACR", "Orion 7D"],
  ["AHV", "Dorado 10D"],
  ["ABR", "V4G"],
  ["ACP", "Sierra 8D"],
  ["GE2", "Helios 9D"],
  ["HEL", "Nova 6D"],
  ["LSW", "Luna 5D"],
  ["VNS", "Vega 11D"],
  ["DLC", "Delta 4D"],
]);

function argValue(name, fallback = null) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function thaiTodayDate() {
  const now = new Date();
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(thai.getUTCFullYear(), thai.getUTCMonth(), thai.getUTCDate()));
}

function dateOnly(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function daysBetween(start, end) {
  const days = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    days.push(new Date(d));
  }
  return days;
}

function average(values) {
  const valid = values.map(Number).filter((value) => value > 0);
  return valid.length ? Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2)) : 0;
}

function sumHourFields(row, prefix) {
  return HOURS.reduce((sum, hour) => sum + (Number(row[`${prefix}_${hour}`]) || 0), 0);
}

function modelFor(machine) {
  return MODEL_BY_TYPE.get(machine.machine_type) || `${machine.machine_type}-STD`;
}

function baseCt(machine, machineIndex) {
  const known = {
    AHV: 4.2,
    ABR: 3.5,
    ACP: 4.1,
    ACR: 5.0,
    GE2: 3.4,
    HEL: 4.0,
    LSW: 4.7,
    VNS: 5.8,
    DLC: 6.4,
  };
  return known[machine.machine_type] || Number((3.8 + (machineIndex % 8) * 0.35).toFixed(2));
}

function hourlyProfile(machine, dayIndex, machineIndex) {
  const idealCt = baseCt(machine, machineIndex);
  const effTarget = 90 + (machineIndex % 5);
  const availabilityBase = 86 + (machineIndex % 9);
  const performanceBase = 88 + (machineIndex % 8);
  const qualityBase = 97.5 - (machineIndex % 4) * 0.35;

  const targetFields = {};
  const actualFields = {};
  const cycleFields = {};
  const effFields = {};
  const availFields = {};
  const runtimeFields = {};
  const excludedFields = {};
  const ngFields = {};

  HOURS.forEach((hour, hourIndex) => {
    const active = hourIndex < 16;
    const wave = ((dayIndex + hourIndex + machineIndex) % 7) - 3;
    const plannedStopMin = active && (hourIndex === 4 || hourIndex === 12) ? 10 : 0;
    const excludedMin = plannedStopMin + (active && (hourIndex + machineIndex + dayIndex) % 11 === 0 ? 5 : 0);
    const operatingSec = active ? Math.max(0, 3600 - excludedMin * 60) : 0;
    const target = active ? Math.floor((operatingSec / idealCt) * (effTarget / 100)) : 0;
    const availability = active ? Math.max(62, Math.min(99, availabilityBase + wave * 1.3)) : 0;
    const performance = active ? Math.max(60, Math.min(115, performanceBase + wave * 1.1)) : 0;
    const runtimeSec = operatingSec * (availability / 100);
    const output = active ? Math.floor((runtimeSec / idealCt) * (performance / 100)) : 0;
    const quality = active ? Math.max(85, Math.min(99.8, qualityBase - Math.max(0, wave) * 0.2)) : 0;
    const ng = output > 0 ? Math.min(output, Math.round(output * (1 - quality / 100))) : 0;
    const actualCt = output > 0 && runtimeSec > 0 ? runtimeSec / output : idealCt;

    targetFields[`target_${hour}`] = target;
    actualFields[`actual_${hour}`] = output;
    cycleFields[`cycle_${hour}`] = Number(actualCt.toFixed(2));
    effFields[`eff_${hour}`] = Number(performance.toFixed(2));
    availFields[`avail_${hour}`] = Number(availability.toFixed(2));
    runtimeFields[`runtime_${hour}`] = Number((runtimeSec / 60).toFixed(2));
    excludedFields[`excluded_${hour}`] = Number(excludedMin.toFixed(2));
    ngFields[`ng_${hour}`] = ng;
  });

  const targetTotal = sumHourFields(targetFields, "target");
  const actualTotal = sumHourFields(actualFields, "actual");
  const ngQty = sumHourFields(ngFields, "ng");
  const okQty = Math.max(0, actualTotal - ngQty);
  const avgCt = average(Object.values(cycleFields));
  const avgEff = average(Object.values(effFields));
  const avgAvail = average(Object.values(availFields));
  const quality = actualTotal > 0 ? Number(((okQty / actualTotal) * 100).toFixed(2)) : 0;
  const performance = avgEff;
  const oee = Number(((avgAvail * performance * quality) / 10000).toFixed(2));

  return {
    targetFields,
    actualFields,
    cycleFields,
    effFields,
    availFields,
    runtimeFields,
    excludedFields,
    ngFields,
    targetTotal,
    actualTotal,
    ngQty,
    okQty,
    avgCt,
    avgEff,
    avgAvail,
    quality,
    performance,
    oee,
    effTarget,
  };
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
    cycle_time_target: profile.avgCt,
    eff_target: profile.effTarget,
    accum_target: profile.targetTotal,
    model_type: machine.machine_type,
    process_name: machine.full_machine_type || machine.machine_type,
    Work_hour: HOURS.filter((hour) => profile.targetFields[`target_${hour}`] > 0).length,
    ...profile.targetFields,
  };
  if (existing) return prisma.tb_output_target.update({ where: { id: existing.id }, data });
  return prisma.tb_output_target.create({ data });
}

async function ensureStations(machineName) {
  const stations = await prisma.tbm_machine_station.findMany({
    where: { machine_name: machineName, status: "active" },
    orderBy: { station_number: "asc" },
  });
  if (stations.length) return stations;

  await prisma.tbm_machine_station.createMany({
    data: Array.from({ length: 5 }, (_, idx) => ({
      machine_name: machineName,
      ng_id: idx + 1,
      station_number: idx + 1,
      station_name: `Station ${idx + 1}`,
      status: "active",
    })),
  });
  return prisma.tbm_machine_station.findMany({
    where: { machine_name: machineName, status: "active" },
    orderBy: { station_number: "asc" },
  });
}

async function upsertNg(date, machineName, profile) {
  const stations = await ensureStations(machineName);
  if (!stations.length) return;
  const first = stations[0];
  const data = {
    date,
    machine_name: machineName,
    station_id: first.id,
    ...profile.ngFields,
    Overall_ng: profile.ngQty,
  };
  await prisma.tb_machine_ng.upsert({
    where: { machine_name_date_station_id: { machine_name: machineName, date, station_id: first.id } },
    update: data,
    create: data,
  });
}

async function seedStatusRows(date, machine, dayIndex, machineIndex) {
  const day = date.toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = addDays(start, 1);
  await prisma.tb_MCStatus.deleteMany({
    where: {
      MC: machine.machine_name,
      Datetime: { gte: start, lt: end },
      Remark: "demo_simulation",
    },
  });
  await prisma.tb_MCAlarm.deleteMany({
    where: {
      MC: machine.machine_name,
      Datetime: { gte: start, lt: end },
    },
  });

  const hasAlarm = (machineIndex + dayIndex) % 9 === 0;
  const statuses = [
    { time: "00:00:00", status: "Run_Time" },
    { time: "04:00:00", status: "Plan_Stop" },
    { time: "04:10:00", status: "Run_Time" },
    { time: "08:30:00", status: hasAlarm ? "MC_Alarm" : "Run_Time" },
    { time: "08:45:00", status: "Run_Time" },
    { time: "12:00:00", status: "Break_Time" },
    { time: "12:10:00", status: "Run_Time" },
    { time: "16:00:00", status: "Plan_Stop" },
  ];

  await prisma.tb_MCStatus.createMany({
    data: statuses.map((item) => ({
      Datetime: new Date(`${day}T${item.time}.000Z`),
      MC: machine.machine_name,
      MCStatus: item.status,
      UTC_Time: new Date(`${day}T${item.time}.000Z`),
      Remark: "demo_simulation",
    })),
  });

  if (hasAlarm) {
    await prisma.tb_MCAlarm.create({
      data: {
        Datetime: new Date(`${day}T08:30:00.000Z`),
        MC: machine.machine_name,
        MCAlarm: "Simulated vacuum pressure low",
        UTC_Time: new Date(`${day}T08:30:00.000Z`),
      },
    });
  }
}

async function seedMachineDay(date, machine, dayIndex, machineIndex, options) {
  const modelName = modelFor(machine);
  const profile = hourlyProfile(machine, dayIndex, machineIndex);

  if (options.fillMissingOnly) {
    const existing = await prisma.tb_oee.findUnique({
      where: { machine_name_date: { machine_name: machine.machine_name, date } },
      select: { id: true },
    });
    if (existing) return false;
  }

  await upsertTarget(date, machine, modelName, profile);
  await prisma.tb_output_actual.upsert({
    where: { machine_name_date_model_name: { machine_name: machine.machine_name, date, model_name: modelName } },
    update: { ...profile.actualFields, Overall: profile.actualTotal },
    create: { date, machine_name: machine.machine_name, model_name: modelName, ...profile.actualFields, Overall: profile.actualTotal },
  });
  await prisma.tb_cycle_time_actual.upsert({
    where: { machine_name_date: { machine_name: machine.machine_name, date } },
    update: { ...profile.cycleFields, cycle_time: profile.avgCt },
    create: { date, machine_name: machine.machine_name, ...profile.cycleFields, cycle_time: profile.avgCt },
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
      runtime_total: Number(Object.values(profile.runtimeFields).reduce((s, v) => s + Number(v || 0), 0).toFixed(2)),
      excluded_total: Number(Object.values(profile.excludedFields).reduce((s, v) => s + Number(v || 0), 0).toFixed(2)),
    },
    create: {
      date,
      machine_name: machine.machine_name,
      ...profile.runtimeFields,
      ...profile.excludedFields,
      runtime_total: Number(Object.values(profile.runtimeFields).reduce((s, v) => s + Number(v || 0), 0).toFixed(2)),
      excluded_total: Number(Object.values(profile.excludedFields).reduce((s, v) => s + Number(v || 0), 0).toFixed(2)),
    },
  });
  await prisma.tb_oee.upsert({
    where: { machine_name_date: { machine_name: machine.machine_name, date } },
    update: { availability: profile.avgAvail, performance: profile.performance, quality: profile.quality, oee_value: profile.oee, ng_qty: profile.ngQty },
    create: { date, machine_name: machine.machine_name, availability: profile.avgAvail, performance: profile.performance, quality: profile.quality, oee_value: profile.oee, ng_qty: profile.ngQty },
  });
  await upsertNg(date, machine.machine_name, profile);
  if (!options.skipStatus) await seedStatusRows(date, machine, dayIndex, machineIndex);
  return true;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const fillMissingOnly = process.argv.includes("--fill-missing-only") || process.argv.includes("--startup");
  const skipStatus = process.argv.includes("--skip-status");
  const startup = process.argv.includes("--startup");
  const today = thaiTodayDate();
  const yesterday = addDays(today, -1);
  const from = startup ? yesterday : dateOnly(argValue("--from", DEFAULT_START));
  const to = startup ? today : dateOnly(argValue("--to", today.toISOString().slice(0, 10)));

  const machines = await prisma.tbm_machine.findMany({
    where: { status: "active" },
    orderBy: [{ machine_area: "asc" }, { machine_type: "asc" }, { machine_name: "asc" }],
  });
  if (!machines.length) throw new Error("No active machines found. Run prisma/seed_machines.js first.");

  const days = daysBetween(from, to);
  console.log(`Demo MSSQL seed: ${machines.length} machines, ${days.length} day(s), ${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}`);
  console.log(`Mode: ${startup ? "startup yesterday+today" : "range"} | fillMissingOnly=${fillMissingOnly}`);
  if (dryRun) return;

  let written = 0;
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const date = days[dayIndex];
    for (let machineIndex = 0; machineIndex < machines.length; machineIndex += 1) {
      const didWrite = await seedMachineDay(date, machines[machineIndex], dayIndex, machineIndex, { fillMissingOnly, skipStatus });
      if (didWrite) written += 1;
    }
    console.log(`Seed checked ${date.toISOString().slice(0, 10)} (${dayIndex + 1}/${days.length})`);
  }
  console.log(`Done. Written/updated ${written} machine-day rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
