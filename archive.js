#!/usr/bin/env node

/**
 * Hytale Launcher Archiver
 * Simple script that downloads, runs launcher, and archives to GitHub
 */

const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const DIR = './versions';
const LOG = 'versions.log';
const ENDPOINTS = ['launcher.hytale.com/release', 'launcher.arcanitegames.ca/stage'];
const PLATFORMS = ['linux/amd64:zip,flatpak', 'darwin/arm64:zip,dmg', 'windows/amd64:zip,exe'];
const GIT_REPO = process.env.GIT_REPO_PATH || __dirname;
const RUN_LAUNCHER = process.env.RUN_LAUNCHER !== 'false';
const LAUNCHER_WAIT = parseInt(process.env.LAUNCHER_WAIT) || 300000; // 5 min
// const ARCHIVE_WAYBACK = process.env.ARCHIVE_WAYBACK !== 'false';
const ARCHIVE_WAYBACK = false; // Disabled for now
const IS_WINDOWS = process.platform === 'win32';
const USE_WINE = process.env.USE_WINE === 'true' || (!IS_WINDOWS && process.env.USE_WINE !== 'false');
const WINE_PREFIX = process.env.WINE_PREFIX || path.join(process.env.HOME || '/tmp', '.wine');

async function download(url, dest) {
    try {
        // Check if file exists and get timestamp
        let oldTime = 0;
        try {
            const stat = await fs.stat(dest);
            oldTime = stat.mtimeMs;
        } catch {}
        
        // Check if URL exists
        const exists = await new Promise((resolve) => {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;
            const req = protocol.request(url, { method: 'HEAD' }, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(5000, () => { req.destroy(); resolve(false); });
            req.end();
        });
        
        if (!exists) return false;
        
        await fs.mkdir(path.dirname(dest), { recursive: true });
        
        // Download file
        await new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            const file = require('fs').createWriteStream(dest);
            protocol.get(url, (res) => {
                if (res.statusCode !== 200) {
                    file.close();
                    require('fs').unlinkSync(dest);
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }).on('error', reject);
        });
        
        // Check if changed
        const stat = await fs.stat(dest);
        const newTime = stat.mtimeMs;
        
        if (oldTime === newTime) {
            console.log(`unchanged: ${dest}`);
            return false;
        }
        
        console.log(`downloaded: ${dest}`);
        
        // Save URL and SHA256
        await fs.writeFile(`${dest}.url`, url);
        const hash = crypto.createHash('sha256');
        const data = await fs.readFile(dest);
        hash.update(data);
        await fs.writeFile(`${dest}.sha256`, hash.digest('hex'));
        
        // Archive to Wayback Machine
        // if (ARCHIVE_WAYBACK) {
        //     await archiveToWayback(url);
        // }
        
        return true;
    } catch (error) {
        return false;
    }
}

async function fetch(endpoint, channel, version, destDir) {
    for (const platform of PLATFORMS) {
        const [platformPath, extsStr] = platform.split(':');
        const exts = extsStr.split(',');
        
        for (const ext of exts) {
            const name = ext === 'exe' 
                ? `hytale-launcher-installer-${version}.${ext}`
                : `hytale-launcher-${version}.${ext}`;
            const url = `https://${endpoint}/builds/${channel}/${platformPath}/${name}`;
            const dest = path.join(destDir, platformPath, name);
            await download(url, dest);
        }
    }
    
    // Save launcher.json
    try {
        const jsonUrl = `https://${endpoint}/version/${channel}/launcher.json`;
        const json = await new Promise((resolve, reject) => {
            const protocol = jsonUrl.startsWith('https') ? https : http;
            protocol.get(jsonUrl, (res) => {
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
            }).on('error', reject);
        });
        await fs.writeFile(path.join(destDir, 'launcher.json'), JSON.stringify(json, null, 2));
        
        // Archive launcher.json URL to Wayback Machine
        // if (ARCHIVE_WAYBACK) {
        //     await archiveToWayback(jsonUrl);
        // }
    } catch {}
}

// async function archiveToWayback(url) {
//     if (!ARCHIVE_WAYBACK) {
//         console.log(`Wayback Machine archiving disabled (set ARCHIVE_WAYBACK=true to enable)`);
//         return;
//     }
//     
//     try {
//         const waybackUrl = `https://web.archive.org/save/${url}`;
//         console.log(`Archiving to Wayback Machine: ${url}`);
//         await new Promise((resolve, reject) => {
//             const protocol = https;
//             const req = protocol.get(waybackUrl, (res) => {
//                 console.log(`Wayback Machine response: ${res.statusCode} for ${url}`);
//                 // Wayback Machine returns various status codes, all are fine
//                 resolve();
//             });
//             req.on('error', (error) => {
//                 console.log(`Wayback Machine error for ${url}: ${error.message}`);
//                 resolve(); // Don't fail on errors
//             });
//             req.setTimeout(10000, () => {
//                 console.log(`Wayback Machine timeout for ${url}`);
//                 req.destroy();
//                 resolve();
//             });
//             req.end();
//         });
//     } catch (error) {
//         console.log(`Wayback Machine exception for ${url}: ${error.message}`);
//     }
// }

async function logVersion(version) {
    try {
        const content = await fs.readFile(LOG, 'utf8').catch(() => '');
        if (!content.includes(version)) {
            await fs.appendFile(LOG, version + '\n');
        }
    } catch {}
}

async function checkWineAvailable() {
    if (IS_WINDOWS || !USE_WINE) return false;
    try {
        await execAsync('which wine');
        return true;
    } catch {
        return false;
    }
}

async function runLauncherForPlatform(version, channel, platform) {
    const fullVersion = `${version}-${channel}`;
    const versionDir = path.join(DIR, fullVersion);
    const runtimeDir = path.join(GIT_REPO, 'runtime-archives');
    
    console.log(`\n=== Processing ${platform} launcher for ${fullVersion} ===`);
    console.log(`Runtime archive directory: ${runtimeDir}`);
    
    await fs.mkdir(runtimeDir, { recursive: true });
    
    // Check if this platform's runtime is already archived
    const runtimes = await fs.readdir(runtimeDir).catch(() => []);
    console.log(`Existing runtime archives: ${runtimes.length} found`);
    const runtimePrefix = `${fullVersion}-${platform}-runtime-`;
    if (runtimes.some(d => d.startsWith(runtimePrefix))) {
        console.log(`✓ Runtime already archived for ${fullVersion} (${platform})`);
        return false;
    }
    
    let platformZip, extractedDir, launcherName;
    if (platform === 'windows') {
        platformZip = path.join(versionDir, 'windows/amd64', `hytale-launcher-${version}.zip`);
        extractedDir = path.join(GIT_REPO, 'extracted', fullVersion, 'windows-launcher');
        launcherName = 'Hytale Launcher.exe';
    } else {
        platformZip = path.join(versionDir, 'linux/amd64', `hytale-launcher-${version}.zip`);
        try {
            await fs.access(platformZip);
        } catch {
            platformZip = path.join(versionDir, 'linux-amd64', `hytale-launcher-${version}.zip`);
        }
        extractedDir = path.join(GIT_REPO, 'extracted', fullVersion, 'linux-launcher');
        launcherName = 'hytale-launcher';
    }
    
    // Check if ZIP exists
    try {
        await fs.access(platformZip);
    } catch {
        console.log(`No ${platform} ZIP found for ${fullVersion}`);
        return false;
    }
    
    // Extract if needed
    try {
        const files = await fs.readdir(extractedDir);
        if (files.length > 0 && files.some(f => !f.endsWith('.json'))) {
            // Already extracted
        }
    } catch {
        await fs.mkdir(extractedDir, { recursive: true });
        if (IS_WINDOWS && platform === 'windows') {
            // Use PowerShell to extract on Windows
            await execAsync(`powershell -Command "Expand-Archive -Path '${platformZip}' -DestinationPath '${extractedDir}' -Force"`);
        } else {
            await execAsync(`unzip -q "${platformZip}" -d "${extractedDir}"`);
        }
    }
    
    // Find launcher
    const launcher = await findLauncher(extractedDir, launcherName);
    if (!launcher) {
        console.log(`Launcher not found in ${extractedDir}`);
        return false;
    }
    
    if (!RUN_LAUNCHER) {
        return false;
    }
    
    console.log(`Running ${platform} launcher: ${fullVersion}${platform === 'windows' && !IS_WINDOWS ? ' (via Wine)' : ''}`);
    let proc;
    
    if (platform === 'windows') {
        if (IS_WINDOWS) {
            // On Windows, just run the executable
            proc = exec(`"${launcher}"`, { cwd: path.dirname(launcher) });
        } else {
            // On Linux with Wine, run Windows executable through Wine
            const wineAvailable = await checkWineAvailable();
            if (!wineAvailable) {
                console.log(`Wine not available, skipping Windows launcher`);
                return false;
            }
            const wineEnv = {
                ...process.env,
                WINEPREFIX: WINE_PREFIX,
                DISPLAY: process.env.DISPLAY || ':0',
                WINEDLLOVERRIDES: 'winemenubuilder.exe=d',
            };
            proc = exec(`wine "${launcher}"`, { 
                cwd: path.dirname(launcher),
                env: wineEnv
            });
            console.log(`Using Wine prefix: ${WINE_PREFIX}`);
        }
    } else {
        // Linux launcher
        if (IS_WINDOWS) {
            console.log(`Cannot run Linux launcher on Windows`);
            return false;
        }
        await execAsync(`chmod +x "${launcher}"`);
        proc = exec(`"${launcher}"`, { cwd: path.dirname(launcher) });
    }
    
    console.log(`Waiting ${LAUNCHER_WAIT / 1000}s for launcher to generate files...`);
    await new Promise(resolve => setTimeout(resolve, LAUNCHER_WAIT));
    
    // Archive runtime - platform-specific paths
    let dataDirs = [];
    if (platform === 'windows') {
        if (IS_WINDOWS) {
            const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
            const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
            dataDirs = [
                path.join(localAppData, 'Hytale'),
                path.join(appData, 'Hytale'),
                path.join(process.env.USERPROFILE || '', 'Hytale'),
                path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Hytale')
            ];
        } else {
            // Wine paths
            const homeDir = process.env.HOME || '/tmp';
            const wineAppData = path.join(WINE_PREFIX, 'drive_c', 'users', process.env.USER || 'user', 'AppData');
            dataDirs = [
                path.join(wineAppData, 'Local', 'Hytale'),
                path.join(wineAppData, 'Roaming', 'Hytale'),
                path.join(WINE_PREFIX, 'drive_c', 'Program Files', 'Hytale'),
                path.join(WINE_PREFIX, 'drive_c', 'Program Files (x86)', 'Hytale')
            ];
        }
    } else {
        // Linux paths
        const homeDir = process.env.HOME || '/tmp';
        dataDirs = [
            path.join(homeDir, '.local', 'share', 'Hytale'),
            path.join(homeDir, '.hytale'),
            path.join(homeDir, 'Hytale')
        ];
    }
    
    let archived = false;
    console.log(`Checking ${dataDirs.length} possible data directories for ${platform} launcher...`);
    for (const dataDir of dataDirs) {
        try {
            await fs.access(dataDir);
            console.log(`✓ Found data directory: ${dataDir}`);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const runtimeArchive = path.join(runtimeDir, `${fullVersion}-${platform}-runtime-${timestamp}`);
            console.log(`Creating runtime archive: ${runtimeArchive}`);
            await fs.mkdir(runtimeArchive, { recursive: true });
            
            if (IS_WINDOWS) {
                // Use robocopy on Windows
                console.log(`Copying files with robocopy...`);
                try {
                    await execAsync(`robocopy "${dataDir}" "${runtimeArchive}\\appdata" /E /XD "*account*" "*token*" "*cookie*" "*auth*" "*session*" "*login*" "Cookies" "Login Data" "Web Data" /NFL /NDL /NJH /NJS`, { cwd: GIT_REPO });
                } catch (error) {
                    const exitCode = error.code || 0;
                    if (exitCode > 7) {
                        console.log(`robocopy error (exit code ${exitCode}): ${error.message}`);
                        throw error;
                    }
                    // Exit codes 0-7 are success for robocopy
                }
            } else {
                // Use rsync on Linux
                console.log(`Copying files with rsync...`);
                await execAsync(`rsync -a --exclude='*account*' --exclude='*token*' --exclude='*cookie*' --exclude='*auth*' --exclude='*session*' --exclude='*login*' --exclude='Cookies' --exclude='Login Data' --exclude='Web Data' "${dataDir}/" "${runtimeArchive}/appdata/"`);
            }
            
            // Verify archive was created
            const archiveFiles = await fs.readdir(runtimeArchive).catch(() => []);
            console.log(`✓ Archived ${platform} runtime: ${fullVersion}`);
            console.log(`  Location: ${runtimeArchive}`);
            console.log(`  Files/directories in archive: ${archiveFiles.length}`);
            archived = true;
            break;
        } catch (error) {
            console.log(`  ✗ Directory ${dataDir} not accessible or error: ${error.message}`);
            // Continue to next directory
        }
    }
    
    if (!archived) {
        console.log(`⚠ No ${platform} runtime data found to archive for ${fullVersion}`);
        console.log(`  Checked directories:`);
        dataDirs.forEach(dir => console.log(`    - ${dir}`));
    }
    
    // Kill launcher
    try {
        if (IS_WINDOWS) {
            proc.kill();
        } else {
            proc.kill('SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!proc.killed) proc.kill('SIGKILL');
        }
    } catch (error) {
        console.log(`Note: Could not kill launcher process: ${error.message}`);
    }
    
    return archived;
}

async function extractAndRun(version, channel) {
    const fullVersion = `${version}-${channel}`;
    let anyArchived = false;
    
    // Run Windows launcher (if on Windows or Wine is available)
    if (IS_WINDOWS || (USE_WINE && await checkWineAvailable())) {
        const archived = await runLauncherForPlatform(version, channel, 'windows');
        if (archived) anyArchived = true;
    }
    
    // Run Linux launcher (if on Linux)
    if (!IS_WINDOWS) {
        const archived = await runLauncherForPlatform(version, channel, 'linux');
        if (archived) anyArchived = true;
    }
    
    return anyArchived;
}

async function findLauncher(dir, preferredName) {
    try {
        const files = await fs.readdir(dir, { withFileTypes: true });
        
        // First, look for preferred name
        if (preferredName) {
            for (const file of files) {
                const fullPath = path.join(dir, file.name);
                if (file.isFile() && file.name === preferredName) {
                    return fullPath;
                }
            }
        }
        
        // Then look for any launcher executable
        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isFile()) {
                const name = file.name.toLowerCase();
                if (IS_WINDOWS) {
                    if (name.includes('launcher') && name.endsWith('.exe')) {
                        return fullPath;
                    }
                } else {
                    if (name.includes('launcher') || name === 'hytale-launcher') {
                        return fullPath;
                    }
                }
            }
            if (file.isDirectory()) {
                const found = await findLauncher(fullPath, preferredName);
                if (found) return found;
            }
        }
    } catch {}
    return null;
}

async function commitToGit() {
    try {
        // Ensure runtime-archives directory exists
        const runtimeDir = path.join(GIT_REPO, 'runtime-archives');
        await fs.mkdir(runtimeDir, { recursive: true });
        
        // Add all archive directories
        const addCommand = IS_WINDOWS 
            ? `git add versions/ extracted/ runtime-archives/ README.md`
            : `git add versions/ extracted/ runtime-archives/ README.md`;
        await execAsync(addCommand, { cwd: GIT_REPO });
        
        // Reset any code/log files that shouldn't be committed
        const resetCommand = IS_WINDOWS
            ? `git reset HEAD -- "*.js" "*.sh" "*.ps1" "*.log" "*.md"`
            : `git reset HEAD -- '*.js' '*.sh' '*.ps1' '*.log' '*.md'`;
        await execAsync(resetCommand, { cwd: GIT_REPO });
        
        // Re-add README.md (it should be committed)
        await execAsync(`git add README.md`, { cwd: GIT_REPO });
        
        // Check if there are staged changes
        try {
            await execAsync(`git diff --staged --quiet`, { cwd: GIT_REPO });
            console.log(`No changes to commit`);
            return false;
        } catch {
            // Has changes, commit
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            await execAsync(`git commit -m "Auto-archive: ${timestamp}"`, { cwd: GIT_REPO });
            console.log(`✓ Committed to git`);
            
            // Try to push
            try {
                await execAsync(`git push origin main`, { cwd: GIT_REPO });
                console.log(`✓ Pushed to GitHub (main branch)`);
                return true;
            } catch {
                try {
                    await execAsync(`git push origin master`, { cwd: GIT_REPO });
                    console.log(`✓ Pushed to GitHub (master branch)`);
                    return true;
                } catch (error) {
                    console.error(`✗ Git push failed: ${error.message}`);
                    return false;
                }
            }
        }
    } catch (error) {
        console.error(`✗ Git commit failed: ${error.message}`);
        return false;
    }
}

async function fetchVersion(version) {
    console.log(`fetching: ${version}`);
    for (const endpoint of ENDPOINTS) {
        const [endpointHost, channel] = endpoint.split('/');
        const destDir = path.join(DIR, `${version}-${channel}`);
        await fetch(endpointHost, channel, version, destDir);
        await logVersion(version);
        await extractAndRun(version, channel);
    }
    // Commit and push after all operations complete (commitToGit checks for changes)
    await commitToGit();
}

async function checkForNewVersions() {
    // Auto-detect new versions
    for (const endpoint of ENDPOINTS) {
        const [endpointHost, channel] = endpoint.split('/');
        try {
            const jsonUrl = `https://${endpointHost}/version/${channel}/launcher.json`;
            const json = await new Promise((resolve, reject) => {
                const protocol = https;
                protocol.get(jsonUrl, (res) => {
                    if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                    });
                }).on('error', reject);
            });
            
            const version = json.version;
            const versionDir = path.join(DIR, `${version}-${channel}`);
            
            try {
                await fs.access(versionDir);
                console.log(`already have: ${version}-${channel}`);
                continue;
            } catch {}
            
            console.log(`found: ${version}-${channel}`);
            await fetch(endpointHost, channel, version, versionDir);
            await fetch(endpointHost, channel, 'latest', path.join(DIR, `latest-${channel}`));
            await logVersion(version);
            await extractAndRun(version, channel);
        } catch (error) {
            console.error(`Error checking ${channel}: ${error.message}`);
        }
    }
    
    // Commit and push after checking all endpoints (commitToGit checks for changes)
    await commitToGit();
}

async function main() {
    console.log('=== Hytale Launcher Archiver ===');
    console.log(`Platform: ${process.platform}`);
    console.log(`Git Repo: ${GIT_REPO}`);
    console.log(`Versions Directory: ${path.resolve(DIR)}`);
    console.log(`Runtime Archives Directory: ${path.resolve(path.join(GIT_REPO, 'runtime-archives'))}`);
    console.log(`Run Launcher: ${RUN_LAUNCHER}`);
    // console.log(`Archive to Wayback: ${ARCHIVE_WAYBACK}`);
    if (!IS_WINDOWS) {
        const wineAvailable = await checkWineAvailable();
        console.log(`Wine Available: ${wineAvailable}`);
        if (wineAvailable) {
            console.log(`Wine Prefix: ${WINE_PREFIX}`);
        }
    }
    console.log('');
    
    await fs.mkdir(DIR, { recursive: true });
    await fs.mkdir(path.join(GIT_REPO, 'runtime-archives'), { recursive: true });
    
    const versionArg = process.argv[2];
    const runOnce = process.argv.includes('--once');
    
    if (versionArg) {
        // Check if it's a file
        try {
            const content = await fs.readFile(versionArg, 'utf8');
            for (const line of content.split('\n')) {
                const v = line.trim();
                if (v) await fetchVersion(v);
            }
        } catch {
            // Not a file, treat as version string
            await fetchVersion(versionArg);
        }
        process.exit(0);
    } else {
        // Run once immediately
        await checkForNewVersions();
        
        // If not --once, run continuously
        if (!runOnce) {
            const interval = 5 * 60 * 1000; // 5 minutes
            console.log(`Running continuously, checking every ${interval / 1000}s`);
            setInterval(checkForNewVersions, interval);
        }
    }
}

// Enhanced error handling for 24/7 operation
// Wrap in try-catch to prevent crashes from killing the service
(async () => {
    try {
        await main();
    } catch (error) {
        console.error('FATAL ERROR:', error);
        console.error('Stack:', error.stack);
        // For continuous mode, setInterval will keep running
        // Only exit if we're in single-run mode
        if (process.argv.includes('--once') || process.argv[2]) {
            process.exit(1);
        }
        // Otherwise, log and continue - setInterval will retry
        console.error('Error logged, continuing operation...');
    }
})();
