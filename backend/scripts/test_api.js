async function test() {
    try {
        const d = '2026-04-23';
        const m = 'ABR-003';
        const res = await fetch(`http://localhost:4000/api/oee/getLastOEE?machine_name=${m}&date=${d}`);
        console.log('LastOEE:', await res.json());
        const resT = await fetch(`http://localhost:4000/api/oee/getDataTable?machine_name=${m}&date=${d}`);
        console.log('DataTable:', await resT.json());
    } catch(e) { console.error(e.message); }
}
test();
