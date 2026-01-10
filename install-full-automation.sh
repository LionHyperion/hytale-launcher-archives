#!/bin/bash
# One-Time Installation Script
# Run this ONCE on your server to set up full automation
# After this, everything runs automatically forever

set -e

echo "=== Installing Fully Autonomous Hytale Archiver ==="
echo "This will set up 24/7 automation with ZERO manual intervention"
echo ""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Step 1: Ensure git repo exists
echo "Step 1: Setting up git repository..."
GIT_REPO_PATH="$HOME/hytale-launcher-archives"

if [ ! -d "$GIT_REPO_PATH" ]; then
    echo "Cloning repository..."
    git clone https://github.com/LionHyperion/hytale-launcher-archives.git "$GIT_REPO_PATH" || {
        echo "ERROR: Could not clone repository"
        echo "Make sure you have git access configured"
        exit 1
    }
else
    echo "Repository already exists, updating..."
    cd "$GIT_REPO_PATH"
    git pull origin main || git pull origin master || echo "WARNING: Could not pull updates"
fi

# Step 2: Copy scripts to repo
echo ""
echo "Step 2: Installing scripts..."
cp "$SCRIPT_DIR/auto-update-and-process.sh" "$GIT_REPO_PATH/" 2>/dev/null || true
cp "$SCRIPT_DIR/setup-cron-automation.sh" "$GIT_REPO_PATH/" 2>/dev/null || true
chmod +x "$GIT_REPO_PATH/auto-update-and-process.sh"
chmod +x "$GIT_REPO_PATH/setup-cron-automation.sh"

# Step 3: Setup service directory
echo ""
echo "Step 3: Setting up service directory..."
SERVICE_DIR="$HOME/domains/navajo.playhyp.com"
mkdir -p "$SERVICE_DIR"

# Copy service files
if [ -f "$GIT_REPO_PATH/auto-download-service.js" ]; then
    cp "$GIT_REPO_PATH/auto-download-service.js" "$SERVICE_DIR/"
fi
if [ -f "$GIT_REPO_PATH/start-auto-service.sh" ]; then
    cp "$GIT_REPO_PATH/start-auto-service.sh" "$SERVICE_DIR/"
    chmod +x "$SERVICE_DIR/start-auto-service.sh"
fi

# Step 4: Setup cron automation
echo ""
echo "Step 4: Setting up cron automation..."
cd "$GIT_REPO_PATH"
bash setup-cron-automation.sh

# Step 5: Run initial setup
echo ""
echo "Step 5: Running initial setup..."
bash auto-update-and-process.sh

echo ""
echo "=== Installation Complete ==="
echo ""
echo "✅ Fully autonomous system is now running!"
echo ""
echo "The system will:"
echo "  • Auto-update every 10 minutes"
echo "  • Auto-process builds"
echo "  • Auto-start service if down"
echo "  • Auto-commit to git"
echo "  • Work 24/7 with ZERO intervention"
echo ""
echo "You can now:"
echo "  • Turn off your PC"
echo "  • Go to sleep"
echo "  • Do nothing - it just works!"
echo ""
echo "To check status:"
echo "  tail -f ~/hytale-launcher-archives/auto-process.log"
echo ""
