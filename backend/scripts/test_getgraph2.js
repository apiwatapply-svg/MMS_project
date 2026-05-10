const axios = require('http'); // node internal
const req = axios.get('http://localhost:5005/api/oee/getGraph2?machine_name=ABR-003&date=2026-04-21', (res) => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => console.log(JSON.parse(raw)));
});
