#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export GIT_REPO_PATH="$HOME/hytale-launcher-archives"
cd ~/hytale-launcher-archives
node force-process-current.js
