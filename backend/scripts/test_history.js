const OeeDashboardController = require("../controllers/OeeDashboardController");

async function testHistory() {
    const req = { query: { machine_name: "AHV-006", date: "2026-04-20" } };
    const res = { json: (data) => console.log(JSON.stringify(data, null, 2)) };
    await OeeDashboardController.getDataTable(req, res);
}
testHistory();
