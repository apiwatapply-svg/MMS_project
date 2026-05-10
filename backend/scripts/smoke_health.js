const { spawn } = require("child_process");

const port = Number(process.env.SMOKE_PORT || 5099);
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const healthUrl = `http://127.0.0.1:${port}/api/health`;

const server = spawn(process.execPath, ["server.js"], {
    cwd: __dirname + "/..",
    env: {
        ...process.env,
        PORT: String(port),
        ENABLE_MACHINE_IO: "false",
        ENABLE_CRON_WORKER: "false",
        DEMO_AUTO_SEED_MSSQL: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
});

let output = "";
server.stdout.on("data", (chunk) => {
    output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
    output += chunk.toString();
});

function stopServer() {
    if (!server.killed) {
        server.kill("SIGTERM");
    }
}

async function waitForHealth() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(healthUrl);
            const body = await response.json();
            if (response.ok && body.status === "ok" && body.service === "mms-backend") {
                return body;
            }
        } catch {
            // Server is still starting.
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Health check timed out after ${timeoutMs}ms\n${output}`);
}

(async () => {
    try {
        const body = await waitForHealth();
        console.log(`Health check passed: ${body.service} ${body.status}`);
        stopServer();
    } catch (error) {
        stopServer();
        console.error(error.message);
        process.exitCode = 1;
    }
})();
