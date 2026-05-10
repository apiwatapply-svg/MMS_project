#!/usr/bin/env bash
set -u

export PATH="/usr/bin:/bin:$PATH"
if [ -d "/c/Program Files/Git/usr/bin" ]; then
  export PATH="/c/Program Files/Git/usr/bin:$PATH"
fi

SCRIPT_PATH="${BASH_SOURCE[0]}"
SCRIPT_DIR="${SCRIPT_PATH%/*}"
if [ "$SCRIPT_DIR" = "$SCRIPT_PATH" ]; then
  SCRIPT_DIR="."
fi

ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$ROOT_DIR/reports"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
REPORT_FILE="$REPORT_DIR/ci-report-$TIMESTAMP.md"
LOG_FILE="$REPORT_DIR/ci-log-$TIMESTAMP.txt"

if [ ! -d "$REPORT_DIR" ]; then
  echo "Reports directory not found: $REPORT_DIR"
  echo "Create the reports directory or run this script from the repository root."
  exit 1
fi

TOTAL=0
PASSED=0
FAILED=0
FAILED_STEPS=()
SKIP_INSTALL=false

if [ "${1:-}" = "--skip-install" ]; then
  SKIP_INSTALL=true
fi

write_report_header() {
  {
    echo "# MMS Dashboard Local CI Report"
    echo
    echo "- Date: $(date +"%Y-%m-%d %H:%M:%S")"
    echo "- Project: $ROOT_DIR"
    echo "- Log file: $LOG_FILE"
    echo
    echo "## Results"
    echo
    echo "| Step | Status | Duration |"
    echo "| --- | --- | ---: |"
  } > "$REPORT_FILE"
}

run_step() {
  local name="$1"
  local cwd="$2"
  shift 2
  local command=("$@")
  local start
  local end
  local duration

  TOTAL=$((TOTAL + 1))
  echo
  echo "==> $name"
  echo "    cwd: $cwd"
  echo "    cmd: ${command[*]}"

  {
    echo
    echo "================================================================================"
    echo "STEP: $name"
    echo "CWD : $cwd"
    echo "CMD : ${command[*]}"
    echo "TIME: $(date +"%Y-%m-%d %H:%M:%S")"
    echo "================================================================================"
  } >> "$LOG_FILE"

  start=$(date +%s)
  (
    cd "$cwd" &&
    "${command[@]}"
  ) >> "$LOG_FILE" 2>&1
  local status=$?
  end=$(date +%s)
  duration="$((end - start))s"

  if [ "$status" -eq 0 ]; then
    PASSED=$((PASSED + 1))
    echo "PASS: $name ($duration)"
    echo "| $name | PASS | $duration |" >> "$REPORT_FILE"
  else
    FAILED=$((FAILED + 1))
    FAILED_STEPS+=("$name")
    echo "FAIL: $name ($duration)"
    echo "| $name | FAIL | $duration |" >> "$REPORT_FILE"
  fi

  return "$status"
}

write_summary() {
  {
    echo
    echo "## Summary"
    echo
    echo "- Total: $TOTAL"
    echo "- Passed: $PASSED"
    echo "- Failed: $FAILED"
    echo
    if [ "$FAILED" -gt 0 ]; then
      echo "## Failed Steps"
      echo
      for step in "${FAILED_STEPS[@]}"; do
        echo "- $step"
      done
      echo
      echo "Open the log file for details:"
      echo
      echo "\`\`\`text"
      echo "$LOG_FILE"
      echo "\`\`\`"
    else
      echo "All CI steps passed. This branch is ready to push or deploy."
    fi
  } >> "$REPORT_FILE"
}

write_report_header

if [ "$SKIP_INSTALL" = false ]; then
  run_step "Backend install" "$ROOT_DIR/backend" npm ci
else
  echo "| Backend install | SKIPPED | 0s |" >> "$REPORT_FILE"
fi
if [ "$SKIP_INSTALL" = true ] && [ -f "$ROOT_DIR/backend/node_modules/.prisma/client/index.js" ]; then
  echo "| Backend Prisma generate | SKIPPED \(client exists\) | 0s |" >> "$REPORT_FILE"
else
  run_step "Backend Prisma generate" "$ROOT_DIR/backend" npm run prisma:generate
fi
run_step "Backend syntax lint" "$ROOT_DIR/backend" npm run lint
run_step "Backend unit tests" "$ROOT_DIR/backend" npm test
run_step "Machine simulator tests" "$ROOT_DIR/backend" npm run test:sim
run_step "Backend smoke test" "$ROOT_DIR/backend" npm run smoke
if [ "$SKIP_INSTALL" = false ]; then
  run_step "Frontend install" "$ROOT_DIR/fontend" npm ci
else
  echo "| Frontend install | SKIPPED | 0s |" >> "$REPORT_FILE"
fi
run_step "Frontend lint" "$ROOT_DIR/fontend" npm run lint
run_step "Frontend production build" "$ROOT_DIR/fontend" npm run build

write_summary

echo
echo "Report: $REPORT_FILE"
echo "Log   : $LOG_FILE"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi

exit 0
