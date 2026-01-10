#!/usr/bin/env node

/**
 * Force Process Current Versions
 * Downloads and processes the current versions even if they "already exist"
 */

const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Configuration
const GIT_REPO_PATH = process.env.GIT_REPO_PATH || (process.env.HOME ? path.join(process.env.HOME, 'hytale-launcher-archives') : null);
if (!GIT_REPO_PATH) {
    console.error('ERROR: GIT_REPO_PATH or HOME must be set');
    process.exit(1);
}

const VERSIONS_DIR = path.join(GIT_REPO_PATH, 'versions');
const EXTRACTED_DIR = path.join(GIT_REPO_PATH, 'extracted');

// Fetch JSON
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        protocol.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error(`Failed to parse JSON: ${error.message}`));
                }
            });
        }).on('error', reject);
    });
}

// Download file
async function downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        const file = require('fs').createWriteStream(filePath);
        protocol.get(url, (res) => {
            if (res.statusCode !== 200) {
                file.close();
                fs.unlink(filePath).catch(() => {});
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
            file.on('error', (err) => {
                file.close();
                fs.unlink(filePath).catch(() => {});
                reject(err);
            });
        }).on('error', (err) => {
            file.close();
            fs.unlink(filePath).catch(() => {});
            reject(err);
        });
    });
}

async function processVersion(version, channel, json) {
    console.log(`\n=== Processing ${version} [${channel}] ===`);
    
    const fullVersion = `${version}-${channel}`;
    const versionDir = path.join(VERSIONS_DIR, fullVersion);
    await fs.mkdir(versionDir, { recursive: true });
    
    // Check if Linux ZIP already exists
    const linuxDir = path.join(versionDir, 'linux-amd64');
    await fs.mkdir(linuxDir, { recursive: true });
    
    let linuxZipPath = null;
    try {
        const files = await fs.readdir(linuxDir, { withFileTypes: true });
        for (const file of files) {
            if (file.isFile() && file.name.endsWith('.zip')) {
                linuxZipPath = path.join(linuxDir, file.name);
                console.log(`  Linux ZIP already exists: ${file.name}`);
                break;
            }
        }
    } catch {}
    
    // Download if needed
    if (!linuxZipPath && json.download_url && json.download_url.linux && json.download_url.linux.amd64) {
        const build = json.download_url.linux.amd64;
        const fileName = path.basename(build.url);
        linuxZipPath = path.join(linuxDir, fileName);
        
        console.log(`  Downloading Linux launcher...`);
        try {
            await downloadFile(build.url, linuxZipPath);
            console.log(`  ✓ Downloaded: ${fileName}`);
            
            // Save metadata
            await fs.writeFile(path.join(linuxDir, 'url.txt'), build.url);
            await fs.writeFile(path.join(linuxDir, 'sha256.txt'), build.sha256);
        } catch (error) {
            console.error(`  ✗ Download failed: ${error.message}`);
            return;
        }
    }
    
    if (!linuxZipPath) {
        console.log(`  ⚠ No Linux ZIP found`);
        return;
    }
    
    // Extract
    const extractedDir = path.join(EXTRACTED_DIR, fullVersion, 'linux-launcher');
    await fs.mkdir(extractedDir, { recursive: true });
    
    try {
        await fs.access(extractedDir);
        const files = await fs.readdir(extractedDir);
        if (files.length > 0) {
            console.log(`  Already extracted, skipping...`);
        } else {
            throw new Error('Empty directory');
        }
    } catch {
        console.log(`  Extracting Linux launcher...`);
        try {
            await execAsync(`unzip -q "${linuxZipPath}" -d "${extractedDir}"`);
            console.log(`  ✓ Extracted to: ${extractedDir}`);
            
            // Create manifest
            const manifest = {
                source: linuxZipPath,
                extractedTo: extractedDir,
                extractedAt: new Date().toISOString(),
                platform: 'linux-amd64',
                version: version,
                channel: channel
            };
            await fs.writeFile(
                path.join(extractedDir, 'extraction-manifest.json'),
                JSON.stringify(manifest, null, 2)
            );
        } catch (error) {
            console.error(`  ✗ Extraction failed: ${error.message}`);
            return;
        }
    }
    
    // Save launcher.json
    await fs.writeFile(
        path.join(versionDir, 'launcher.json'),
        JSON.stringify(json, null, 2)
    );
    
    console.log(`  ✓ Processing complete`);
}

async function main() {
    console.log('=== Force Processing Current Versions ===\n');
    console.log(`Git repo: ${GIT_REPO_PATH}\n`);
    
    const endpoints = [
        { url: 'https://launcher.hytale.com/version/release/launcher.json', channel: 'release' },
        { url: 'https://launcher.arcanitegames.ca/version/stage/launcher.json', channel: 'stage' }
    ];
    
    for (const endpoint of endpoints) {
        try {
            console.log(`Fetching ${endpoint.channel} channel...`);
            const json = await fetchJSON(endpoint.url);
            const version = json.version;
            
            await processVersion(version, endpoint.channel, json);
        } catch (error) {
            console.error(`Error processing ${endpoint.channel}: ${error.message}`);
        }
    }
    
    // Commit and push
    console.log(`\n=== Committing to Git ===`);
    try {
        await execAsync(`cd "${GIT_REPO_PATH}" && git add versions/ extracted/ 2>/dev/null || true`);
        const status = await execAsync(`cd "${GIT_REPO_PATH}" && git status --short`);
        if (status.stdout.trim()) {
            await execAsync(`cd "${GIT_REPO_PATH}" && git commit -m "Force process current versions: extract Linux launchers"`);
            console.log(`  ✓ Committed`);
            await execAsync(`cd "${GIT_REPO_PATH}" && git push`);
            console.log(`  ✓ Pushed to GitHub`);
        } else {
            console.log(`  No changes to commit`);
        }
    } catch (error) {
        console.error(`  ⚠ Git error: ${error.message}`);
    }
    
    console.log(`\n=== Done ===`);
}

main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
});
