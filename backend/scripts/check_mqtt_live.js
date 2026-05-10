const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://192.168.100.99:1883');

console.log("Connecting to MQTT to check messages...");

client.on('connect', () => {
    console.log("Connected to MQTT broker. Listening to factory/AHV/# and factory/ABR/#...");
    client.subscribe('factory/AHV/#');
    client.subscribe('factory/ABR/#');

    setTimeout(() => {
        console.log("Closing connection after 8 seconds.");
        client.end();
        process.exit(0);
    }, 8000);
});

client.on('message', (topic, message) => {
    const msg = message.toString();
    console.log(`\n[${topic}]`);
    try {
        const json = JSON.parse(msg);
        console.log(JSON.stringify(json, null, 2));
    } catch (e) {
        console.log(msg);
    }
});
