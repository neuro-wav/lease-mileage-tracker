#!/usr/bin/env bash
# run.sh — Amazon return window tracker pipeline
# Called by launchd every Wednesday at 9am, or manually via: bash run.sh

# ---- Environment setup ----
# launchd runs with a minimal PATH — nvm is not sourced. Point directly to the binary.
export NVM_DIR="$HOME/.nvm"
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:/usr/local/bin:/usr/bin:/bin"
NODE="$HOME/.nvm/versions/node/v20.20.0/bin/node"

# Script's own directory (works even if launchd sets a different cwd)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

LOG="$DIR/run.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

{
  echo ""
  echo "======================================"
  echo "[$(ts)] Amazon return tracker started"
  echo "======================================"

  # ---- Step 1: Scrape orders ----
  echo "[$(ts)] Running scrape.js..."
  "$NODE" "$DIR/scrape.js"
  SCRAPE_EXIT=$?

  if [ $SCRAPE_EXIT -ne 0 ]; then
    echo "[$(ts)] WARNING: scrape.js exited with code $SCRAPE_EXIT"
    echo "           If orders.json exists from a prior run, report will use that data."
  else
    echo "[$(ts)] scrape.js completed successfully."
  fi

  # ---- Step 2: Generate report ----
  echo "[$(ts)] Running report.js..."
  "$NODE" "$DIR/report.js"
  REPORT_EXIT=$?

  if [ $REPORT_EXIT -ne 0 ]; then
    echo "[$(ts)] ERROR: report.js failed with code $REPORT_EXIT. Aborting."
    exit 1
  fi
  echo "[$(ts)] report.js completed successfully."

  # ---- Step 3: Send notification ----
  echo "[$(ts)] Running notify.js..."
  "$NODE" "$DIR/notify.js"
  NOTIFY_EXIT=$?

  if [ $NOTIFY_EXIT -ne 0 ]; then
    echo "[$(ts)] WARNING: notify.js exited with code $NOTIFY_EXIT"
  else
    echo "[$(ts)] notify.js completed successfully."
  fi

  echo "[$(ts)] Pipeline complete."

} >> "$LOG" 2>&1
