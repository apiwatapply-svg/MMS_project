const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const START = new Date("2026-05-01T00:00:00.000Z");
const END = new Date("2026-06-30T00:00:00.000Z");

async function count(model, where) {
  return prisma[model].count({ where });
}

async function main() {
  const machines = await prisma.tbm_machine.findMany({
    where: { status: "active" },
    select: { machine_area: true, machine_type: true, machine_name: true },
  });
  const machineNames = machines.map((machine) => machine.machine_name);
  const range = { date: { gte: START, lte: END }, machine_name: { in: machineNames } };

  const [targets, actuals, cycles, effs, avails, oees, runtimes] = await Promise.all([
    count("tb_output_target", range),
    count("tb_output_actual", range),
    count("tb_cycle_time_actual", range),
    count("tb_efficiency_actual", range),
    count("tb_availability_actual", range),
    count("tb_oee", range),
    count("tb_mc_runtime_hourly", range),
  ]);

  const types = new Set(machines.map((machine) => machine.machine_type));
  const expectedMachineDays = machineNames.length * 61;

  console.log(JSON.stringify({
    machines: machineNames.length,
    types: types.size,
    expectedMachineDays,
    range: "2026-05-01..2026-06-30",
    tables: { targets, actuals, cycles, effs, avails, oees, runtimes },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
