const http = require('http');
http.get('http://localhost:3000/api/oeedashboard/actual_graph2?machine_name=ABR-003&date=2026-04-22', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(JSON.parse(data)));
}).on('error', err => console.error(err.message));
