#!/bin/bash
# Simple script to restart the Hytale archiving service on your server

echo "=== Restarting Hytale Archiving Service ==="

# SSH to your server and run the restart commands
# Replace with your actual SSH details
ssh -p 65002 u298655980@playhyp.com << 'ENDSSH'
cd ~/hytale-launcher-archives
git pull origin main

cd ~/domains/navajo.playhyp.com
./start-auto-service.sh

echo ""
echo "Service restarted! Check status with:"
echo "  ps aux | grep auto-download-service"
echo ""
echo "View logs with:"
echo "  tail -f ~/hytale-launcher-archives/auto-download.log"
ENDSSH

echo ""
echo "Done! The service should now be running with the latest fixes."
