# How to Restart the Service on Your Server

## Quick Method (Copy & Paste These Commands)

SSH into your server and run these commands:

```bash
# 1. SSH to your server
ssh -p 65002 u298655980@playhyp.com

# 2. Go to the git repo and pull latest changes
cd ~/hytale-launcher-archives
git pull origin main

# 3. Go to service directory and restart
cd ~/domains/navajo.playhyp.com
./start-auto-service.sh

# 4. Check if it's running
ps aux | grep auto-download-service

# 5. View the logs to see it working
tail -f ~/hytale-launcher-archives/auto-download.log
```

## What This Does

1. **Pulls latest code** - Gets the fixed `auto-download-service.js` from GitHub
2. **Restarts service** - Kills old process and starts new one with correct settings
3. **Sets environment variables** - Enables extraction, launcher running, and git commits

## Verify It's Working

After restarting, you should see in the logs:
- "Extraction enabled - proceeding to extract and run launcher..."
- "Extracting Linux launcher for..."
- "Running launcher to generate runtime state..."
- "Archiving Linux runtime state..."
- "Git add: X file(s)"
- "Git commit: ..."
- "Git push: Success"

## Check GitHub

After a few minutes, check your GitHub repo:
- `versions/` directory should have new builds
- `extracted/` directory should have extracted launchers
- `runtime-archives/` directory should have runtime state

## If Something Goes Wrong

Check the logs:
```bash
tail -f ~/hytale-launcher-archives/auto-download.log
```

Or check the service log:
```bash
tail -f ~/domains/navajo.playhyp.com/service.log
```
