#!/bin/bash
# Setup Fully Autonomous Cron Job
# This sets up automatic processing that runs every 10 minutes - ZERO manual intervention

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTO_SCRIPT="$SCRIPT_DIR/auto-update-and-process.sh"
CRON_JOB="*/10 * * * * $AUTO_SCRIPT >> $HOME/auto-process-cron.log 2>&1"

echo "=== Setting Up Fully Autonomous Automation ==="
echo ""

# Make script executable
chmod +x "$AUTO_SCRIPT"
echo "✓ Made auto-update script executable"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "auto-update-and-process.sh"; then
    echo "⚠ Cron job already exists, updating..."
    # Remove old entry
    crontab -l 2>/dev/null | grep -v "auto-update-and-process.sh" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
echo "✓ Added cron job (runs every 10 minutes)"

# Show current crontab
echo ""
echo "Current crontab:"
crontab -l | grep "auto-update-and-process"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The system will now:"
echo "  ✓ Auto-update from git every 10 minutes"
echo "  ✓ Auto-process any unprocessed builds"
echo "  ✓ Auto-start service if it's down"
echo "  ✓ Auto-commit and push changes"
echo "  ✓ Work 24/7 with ZERO manual intervention"
echo ""
echo "Logs:"
echo "  - Process log: ~/hytale-launcher-archives/auto-process.log"
echo "  - Cron log: ~/auto-process-cron.log"
echo "  - Service log: ~/hytale-launcher-archives/auto-download.log"
echo ""
echo "To check status:"
echo "  tail -f ~/hytale-launcher-archives/auto-process.log"
echo ""
