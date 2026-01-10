#!/bin/bash
# Continuous Service - Runs forever, auto-updates and processes
# Alternative to cron for environments without cron access

set -e

GIT_REPO_PATH="$HOME/hytale-launcher-archives"
SERVICE_DIR="$HOME/domains/navajo.playhyp.com"
LOG_FILE="$GIT_REPO_PATH/continuous-service.log"
INTERVAL=600  # 10 minutes

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Continuous Service Starting ==="
log "Will run every $INTERVAL seconds (10 minutes)"
log "Press Ctrl+C to stop"

# Main loop
while true; do
    log "=== Cycle Start ==="
    
    # Run the auto-update script
    if [ -f "$GIT_REPO_PATH/auto-update-and-process.sh" ]; then
        bash "$GIT_REPO_PATH/auto-update-and-process.sh" >> "$LOG_FILE" 2>&1
    else
        log "ERROR: auto-update-and-process.sh not found"
    fi
    
    log "=== Cycle Complete, sleeping $INTERVAL seconds ==="
    sleep $INTERVAL
done
