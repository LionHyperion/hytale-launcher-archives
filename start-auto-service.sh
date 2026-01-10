#!/bin/bash
# Start the fully automated Hytale launcher archiving service

# Kill any existing service
pkill -f auto-download-service || true

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Set environment variables
export GIT_REPO_PATH="$HOME/hytale-launcher-archives"
export WAYBACK_ENABLED=true
export GIT_ENABLED=true
export API_ENABLED=false
# Extraction and runtime archiving are now ENABLED BY DEFAULT in the code
# Set to 'false' to disable if needed
export EXTRACT_ENABLED=true
export RUN_LAUNCHER=true
export LAUNCHER_WAIT_TIME=300000

# Change to service directory
cd ~/domains/navajo.playhyp.com

# Start the service in background
nohup node auto-download-service.js > service.log 2>&1 &

# Wait a moment
sleep 2

# Check if it's running
if ps aux | grep -v grep | grep -q auto-download-service; then
    echo "Service started successfully!"
    ps aux | grep -v grep | grep auto-download-service | head -1
else
    echo "Service failed to start. Check service.log for errors."
    exit 1
fi
