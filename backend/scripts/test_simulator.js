const { existsSync } = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const scriptPath = path.join(__dirname, "test_simulator_core.py");
const repoRoot = path.resolve(__dirname, "..", "..");
const localPython = path.join(repoRoot, ".tools", "python-3.12.8-embed-amd64", "python.exe");
const fallbackLocalPython = path.join(repoRoot, "python-3.12.8-embed-amd64", "python.exe");

function runPython(command, args) {
    return spawnSync(command, args, {
        cwd: __dirname,
        stdio: "inherit",
        shell: false,
    });
}

const candidates = process.platform === "win32"
    ? [
        existsSync(localPython) ? [localPython, [scriptPath, ...process.argv.slice(2)]] : null,
        existsSync(fallbackLocalPython) ? [fallbackLocalPython, [scriptPath, ...process.argv.slice(2)]] : null,
        ["py", [scriptPath, ...process.argv.slice(2)]],
        ["python", [scriptPath, ...process.argv.slice(2)]],
    ].filter(Boolean)
    : [
        ["python3", [scriptPath, ...process.argv.slice(2)]],
        ["python", [scriptPath, ...process.argv.slice(2)]],
    ];

for (const [command, args] of candidates) {
    const result = runPython(command, args);
    if (result.error && result.error.code === "ENOENT") {
        continue;
    }
    process.exit(result.status ?? 1);
}

console.error("Python 3.11+ is required to test the MMS simulator.");
process.exit(1);
