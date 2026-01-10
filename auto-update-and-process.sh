#!/bin/bash
# Fully Autonomous Self-Updating Service
# Runs automatically, updates itself, processes builds - ZERO manual intervention

set -e

# Configuration
GIT_REPO_PATH="$HOME/hytale-launcher-archives"
SERVICE_DIR="$HOME/domains/navajo.playhyp.com"
LOG_FILE="$GIT_REPO_PATH/auto-process.log"

# Ensure directories exist
mkdir -p "$GIT_REPO_PATH"
mkdir -p "$SERVICE_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Auto-Update and Process Started ==="

# Step 1: Self-Update from Git
log "Step 1: Self-updating from git..."
cd "$GIT_REPO_PATH" 2>/dev/null || {
    # If repo doesn't exist, clone it
    log "Git repo not found, cloning..."
    git clone https://github.com/LionHyperion/hytale-launcher-archives.git "$GIT_REPO_PATH" || {
        log "ERROR: Could not clone repo. Check git access."
        exit 1
    }
}

cd "$GIT_REPO_PATH"
git fetch --quiet origin 2>&1 | tee -a "$LOG_FILE" || log "WARNING: Git fetch failed"
git pull --quiet origin main 2>&1 | tee -a "$LOG_FILE" || git pull --quiet origin master 2>&1 | tee -a "$LOG_FILE" || log "WARNING: Git pull failed"

# Step 2: Update service files if they exist in repo
log "Step 2: Updating service files..."
if [ -f "$GIT_REPO_PATH/auto-download-service.js" ]; then
    cp "$GIT_REPO_PATH/auto-download-service.js" "$SERVICE_DIR/" 2>/dev/null || true
fi
if [ -f "$GIT_REPO_PATH/start-auto-service.sh" ]; then
    cp "$GIT_REPO_PATH/start-auto-service.sh" "$SERVICE_DIR/" 2>/dev/null || true
    chmod +x "$SERVICE_DIR/start-auto-service.sh" 2>/dev/null || true
fi
if [ -f "$GIT_REPO_PATH/run-latest-build.js" ]; then
    cp "$GIT_REPO_PATH/run-latest-build.js" "$GIT_REPO_PATH/" 2>/dev/null || true
fi

# Step 3: Ensure service is running
log "Step 3: Ensuring service is running..."
cd "$SERVICE_DIR"

# Check if service is running
if ! pgrep -f "auto-download-service.js" > /dev/null; then
    log "Service not running, starting it..."
    
    # Load NVM
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    # Set environment variables
    export GIT_REPO_PATH="$GIT_REPO_PATH"
    export WAYBACK_ENABLED=true
    export GIT_ENABLED=true
    export API_ENABLED=false
    export EXTRACT_ENABLED=true
    export RUN_LAUNCHER=true
    export LAUNCHER_WAIT_TIME=300000
    
    # Start service in background
    nohup node auto-download-service.js >> "$LOG_FILE" 2>&1 &
    sleep 2
    
    if pgrep -f "auto-download-service.js" > /dev/null; then
        log "Service started successfully"
    else
        log "ERROR: Service failed to start"
    fi
else
    log "Service is already running"
fi

# Step 4: Process any unprocessed versions
log "Step 4: Processing unprocessed versions..."
cd "$GIT_REPO_PATH"

# Find latest version
LATEST_VERSION=$(ls -t versions/ 2>/dev/null | head -1)

if [ -n "$LATEST_VERSION" ]; then
    log "Latest version: $LATEST_VERSION"
    
    # Check if extracted
    EXTRACTED_DIR="extracted/$LATEST_VERSION/linux-launcher"
    IS_EXTRACTED=false
    if [ -d "$EXTRACTED_DIR" ] && [ "$(ls -A "$EXTRACTED_DIR" 2>/dev/null | grep -v '\.json$' | grep -v '\.log$' | wc -l)" -gt 0 ]; then
        IS_EXTRACTED=true
    fi
    
    # Check runtime archives
    RUNTIME_COUNT=$(ls -d "runtime-archives/${LATEST_VERSION}-runtime-"* 2>/dev/null | wc -l)
    
    if [ "$IS_EXTRACTED" = false ] || [ "$RUNTIME_COUNT" -eq 0 ]; then
        log "Version needs processing, running build processor..."
        
        export GIT_REPO_PATH="$GIT_REPO_PATH"
        export RUN_LAUNCHER=true
        export LAUNCHER_WAIT_TIME=300000
        
        if [ -f "run-latest-build.js" ]; then
            node run-latest-build.js >> "$LOG_FILE" 2>&1 || log "WARNING: Build processing had issues"
        else
            log "WARNING: run-latest-build.js not found, service will process it automatically"
        fi
    else
        log "Version already fully processed"
    fi
else
    log "No versions found yet"
fi

# Step 5: Auto-commit and push any changes
log "Step 5: Auto-committing changes..."
cd "$GIT_REPO_PATH"

# Check if there are changes
if [ -d ".git" ]; then
    git add -A 2>/dev/null || true
    
    # Check if there are changes to commit
    if ! git diff --staged --quiet 2>/dev/null; then
        COMMIT_MSG="Auto-process: $(date '+%Y-%m-%d %H:%M:%S') - Processed builds and runtime archives"
        git commit -m "$COMMIT_MSG" >> "$LOG_FILE" 2>&1 || log "WARNING: Git commit failed"
        
        # Push to GitHub
        git push origin main >> "$LOG_FILE" 2>&1 || git push origin master >> "$LOG_FILE" 2>&1 || log "WARNING: Git push failed"
        log "Changes committed and pushed"
    else
        log "No changes to commit"
    fi
fi

log "=== Auto-Update and Process Complete ==="
