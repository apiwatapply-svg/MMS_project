const OeeDashboardController = require("../controllers/OeeDashboardController");

const req = { query: { machine_name: "ABR-003", date: "2026-04-20" } };
const res = { json: (data) => console.log(JSON.stringify(data, null, 2)) };

async function test() {
    await OeeDashboardController.getDataTable(req, res);
}

test();
