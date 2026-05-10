require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const today = new Date('2026-04-22');
    const machine = 'ABR-003';

    // 1. tb_availability_actual hour 13
    const avail = await p.tb_availability_actual.findFirst({ where: { machine_name: machine, date: today } });
    console.log('=== tb_availability_actual ===');
    console.log('avail_13:', avail?.avail_13, '| avail_actual:', avail?.avail_actual);

    // 2. tb_mc_runtime_hourly hour 13
    const rt = await p.tb_mc_runtime_hourly.findFirst({ where: { machine_name: machine, date: today } });
    console.log('\n=== tb_mc_runtime_hourly ===');
    console.log('runtime_13:', rt?.runtime_13, '| excluded_13:', rt?.excluded_13);

    // 3. MCStatus records ใน 13:00-14:00 TH (06:00-07:00 UTC)
    const startTH = new Date('2026-04-22T06:00:00.000Z'); // UTC
    const endTH   = new Date('2026-04-22T07:00:00.000Z'); // UTC
    // MSSQL เก็บเป็น Thai local time (+7)
    const startTH_local = new Date('2026-04-22T13:00:00.000');
    const endTH_local   = new Date('2026-04-22T14:00:00.000');
    const mc = await p.tb_MCStatus.findMany({
        where: { MC: machine, Datetime: { gte: startTH_local, lt: endTH_local } },
        orderBy: { Datetime: 'asc' },
        select: { Datetime: true, MCStatus: true }
    });
    console.log('\n=== MCStatus records 13:00-14:00 TH ===');
    console.log('Count:', mc.length);
    mc.forEach(r => console.log(' ', r.Datetime.toISOString(), r.MCStatus));

    // 4. carry-over ก่อน 13:00 TH (last status before)
    const carry = await p.tb_MCStatus.findFirst({
        where: { MC: machine, Datetime: { lt: startTH_local } },
        orderBy: { Datetime: 'desc' },
        select: { Datetime: true, MCStatus: true }
    });
    console.log('\n=== Carry-over (last status before 13:00 TH) ===');
    console.log(carry ? `${carry.Datetime.toISOString()} → ${carry.MCStatus}` : 'NONE');

    // 5. tb_output_actual hour 13
    const out = await p.tb_output_actual.findMany({ where: { machine_name: machine, date: today } });
    console.log('\n=== tb_output_actual actual_13 ===');
    out.forEach(r => console.log(' ', r.model_name, '| actual_13:', r.actual_13));
}

main().catch(console.error).finally(() => p.$disconnect());
