#!/bin/bash
# Keep-alive script for archive.js on shared hosting (no systemd)
# Run this via cron every minute: * * * * * /home/u298655980/hytale-launcher-archives/keep-alive.sh

SCRIPT_DIR="/home/u298655980/hytale-launcher-archives"
ARCHIVE_SCRIPT="$SCRIPT_DIR/archive.js"
LOCK_FILE="$SCRIPT_DIR/.archive.lock"
LOG_FILE="$SCRIPT_DIR/keep-alive.log"

cd "$SCRIPT_DIR"

# Check if process is running
if pgrep -f "archive.js" > /dev/null; then
    echo "$(date): Process is running" >> "$LOG_FILE"
    exit 0
fi

# Check if lock file exists (another instance might be starting)
if [ -f "$LOCK_FILE" ]; then
    LOCK_AGE=$(($(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0)))
    if [ $LOCK_AGE -lt 300 ]; then
        echo "$(date): Lock file exists, waiting..." >> "$LOG_FILE"
        exit 0
    else
        echo "$(date): Stale lock file, removing..." >> "$LOG_FILE"
        rm -f "$LOCK_FILE"
    fi
fi

# Create lock file
touch "$LOCK_FILE"

# Start the process
echo "$(date): Starting archive.js..." >> "$LOG_FILE"
cd "$SCRIPT_DIR"
NODE_PATH="/home/u298655980/.nvm/versions/node/v24.12.0/bin/node"
nohup "$NODE_PATH" "$ARCHIVE_SCRIPT" >> "$SCRIPT_DIR/archive.log" 2>> "$SCRIPT_DIR/archive-error.log" &

# Wait a moment and verify it started
sleep 2
if pgrep -f "archive.js" > /dev/null; then
    echo "$(date): Successfully started (PID: $(pgrep -f 'archive.js'))" >> "$LOG_FILE"
else
    echo "$(date): FAILED to start archive.js!" >> "$LOG_FILE"
fi

# Remove lock file
rm -f "$LOCK_FILE"
