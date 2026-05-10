const { readdirSync, statSync } = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const includeDirs = ["controllers", "middleware", "routes", "services", "tests", "utils"];
const entryFiles = ["server.js", "worker.js", "worker_cron.js"];

function collectJsFiles(dir, files = []) {
    for (const name of readdirSync(dir)) {
        const fullPath = path.join(dir, name);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            collectJsFiles(fullPath, files);
        } else if (name.endsWith(".js")) {
            files.push(fullPath);
        }
    }
    return files;
}

const files = [
    ...entryFiles.map(file => path.join(root, file)),
    ...includeDirs.flatMap(dir => collectJsFiles(path.join(root, dir))),
];

let failed = false;
for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
        failed = true;
        console.error(result.stderr || result.stdout);
    }
}

if (failed) {
    process.exit(1);
}

console.log(`Syntax check passed for ${files.length} backend files`);
