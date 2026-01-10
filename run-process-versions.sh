#!/bin/bash
# Wrapper script to run process-current-versions.js on the server

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

export GIT_REPO_PATH="$HOME/hytale-launcher-archives"
export EXTRACT_ENABLED=true
export RUN_LAUNCHER=true
export GIT_ENABLED=true

cd ~/hytale-launcher-archives
node process-current-versions.js
