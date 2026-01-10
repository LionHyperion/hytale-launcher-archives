#!/usr/bin/env node

/**
 * Hytale Launcher Auto-Download Service
 * 
 * Automatically monitors Hytale's official endpoints and downloads new launcher versions.
 * Can integrate with your API at navajo.playhyp.com
 * 
 * Usage:
 *   node auto-download-service.js
 *   node auto-download-service.js --once  (run once and exit)
 *   node auto-download-service.js --interval 3600000  (check every hour)
 */

const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Helper function to get git repo path (used by multiple config values)
function getGitRepoPath() {
    // Support both Windows (USERPROFILE) and Linux/Mac (HOME)
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const repoPath = process.env.GIT_REPO_PATH || (homeDir ? path.join(homeDir, 'hytale-launcher-archives') : null);
    if (!repoPath) {
        console.error('ERROR: GIT_REPO_PATH or HOME/USERPROFILE environment variable must be set for server deployment');
        console.error('Set GIT_REPO_PATH environment variable or ensure HOME/USERPROFILE is set');
        process.exit(1);
    }
    return path.resolve(repoPath);
}

// Configuration
const CONFIG = {
    // Hytale launcher endpoints
    endpoints: [
        {
            url: 'https://launcher.hytale.com/version/release/launcher.json',
            channel: 'release'
        },
        {
            url: 'https://launcher.arcanitegames.ca/version/stage/launcher.json',
            channel: 'stage'
        }
    ],
    
    // Git repo path - defaults to ~/hytale-launcher-archives on server
    // Resolve to absolute path to avoid relative path issues
    gitRepoPath: getGitRepoPath(),
    
    // Archive directory - store in git repo so files get committed
    // On server, this should be inside the git repo (e.g., ~/hytale-launcher-archives/versions)
    archiveDir: (() => {
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        const gitRepoPath = process.env.GIT_REPO_PATH || (homeDir ? path.join(homeDir, 'hytale-launcher-archives') : null);
        if (gitRepoPath) {
            // Server: store in git repo
            return path.join(path.resolve(gitRepoPath), 'versions');
        }
        // Local dev fallback: store relative to script
        return path.join(__dirname, 'versions');
    })(),
    
    // Runtime archiving (archive files generated when launcher runs)
    runtimeArchivingEnabled: process.env.RUNTIME_ARCHIVING === 'true',
    runtimeArchiveDir: process.env.RUNTIME_ARCHIVE_DIR || path.join(__dirname, 'runtime-archives'),
    
    // Check interval (default: 5 minutes for active development periods)
    // 300000 = 5 minutes, 600000 = 10 minutes, 3600000 = 1 hour
    checkInterval: process.env.CHECK_INTERVAL ? parseInt(process.env.CHECK_INTERVAL) : 300000,
    
    // Run once and exit
    runOnce: process.argv.includes('--once'),
    
    // Custom interval from command line
    customInterval: (() => {
        const idx = process.argv.indexOf('--interval');
        return idx !== -1 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1]) : null;
    })(),
    
    // API integration (optional)
    apiUrl: process.env.API_URL || 'https://navajo.playhyp.com',
    apiEnabled: process.env.API_ENABLED !== 'false',
    
    // Wayback Machine archiving (optional)
    waybackEnabled: process.env.WAYBACK_ENABLED !== 'false',
    
    // Git automation (optional)
    gitEnabled: process.env.GIT_ENABLED !== 'false',
    
    // Extract and run launcher (server-side only)
    // Default to enabled for live archiving - can be disabled with EXTRACT_ENABLED=false
    extractEnabled: process.env.EXTRACT_ENABLED !== 'false',
    // Default to enabled for live archiving - can be disabled with RUN_LAUNCHER=false
    runLauncherEnabled: process.env.RUN_LAUNCHER !== 'false',
    launcherWaitTime: process.env.LAUNCHER_WAIT_TIME ? parseInt(process.env.LAUNCHER_WAIT_TIME) : 300000, // 5 minutes default
    
    // Log file - store in git repo for server, or script dir for local dev
    logFile: (() => {
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        const gitRepoPath = process.env.GIT_REPO_PATH || (homeDir ? path.join(homeDir, 'hytale-launcher-archives') : null);
        if (gitRepoPath) {
            return path.join(path.resolve(gitRepoPath), 'auto-download.log');
        }
        return path.join(__dirname, 'auto-download.log');
    })()
};

// Ensure archive directory exists
async function ensureArchiveDir() {
    try {
        await fs.mkdir(CONFIG.archiveDir, { recursive: true });
    } catch (error) {
        console.error(`Failed to create archive directory: ${error.message}`);
        process.exit(1);
    }
}

// Logging function
async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    
    try {
        await fs.appendFile(CONFIG.logFile, logMessage + '\n');
    } catch (error) {
        // Ignore log file errors
    }
}

// Fetch JSON from URL
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        
        protocol.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
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

// Download file with progress
async function downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        const fsSync = require('fs'); // Use sync fs for cleanup operations
        const file = fsSync.createWriteStream(filePath);
        
        protocol.get(url, (res) => {
            if (res.statusCode !== 200) {
                file.close();
                fsSync.unlink(filePath, () => {}); // Ignore errors on cleanup
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }
            
            res.pipe(file);
            
            file.on('finish', () => {
                file.close();
                resolve();
            });
            
            file.on('error', (err) => {
                file.close();
                fsSync.unlink(filePath, () => {}); // Ignore errors on cleanup
                reject(err);
            });
        }).on('error', (err) => {
            file.close();
            fsSync.unlink(filePath, () => {}); // Ignore errors on cleanup
            reject(err);
        });
    });
}

// Calculate SHA256 hash of file
async function calculateSHA256(filePath) {
    const hash = crypto.createHash('sha256');
    const data = await fs.readFile(filePath);
    hash.update(data);
    return hash.digest('hex').toLowerCase();
}

// Archive URL to Wayback Machine
async function archiveToWayback(url) {
    if (!CONFIG.waybackEnabled) return null;
    
    try {
        // Wayback Machine Save API: https://web.archive.org/save/{url}
        const waybackUrl = `https://web.archive.org/save/${encodeURIComponent(url)}`;
        
        return new Promise((resolve, reject) => {
            https.get(waybackUrl, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200 || res.statusCode === 302) {
                        // Extract archive URL from response if available
                        const archiveMatch = data.match(/https?:\/\/web\.archive\.org\/web\/\d+\//);
                        if (archiveMatch) {
                            resolve(archiveMatch[0] + url);
                        } else {
                            // Wayback Machine sometimes redirects or returns different formats
                            resolve(`https://web.archive.org/web/*/${url}`);
                        }
                    } else {
                        reject(new Error(`Wayback returned ${res.statusCode}`));
                    }
                });
            }).on('error', reject);
        });
    } catch (error) {
        // Return null on error, let caller handle logging
        return null;
    }
}

// Notify API about new version (optional)
async function notifyAPI(version, channel, platform, filePath) {
    if (!CONFIG.apiEnabled) return;
    
    try {
        const fileStats = await fs.stat(filePath);
        const fileHash = await calculateSHA256(filePath);
        
        const payload = {
            version: version,
            channel: channel,
            platform: platform,
            filePath: filePath,
            fileSize: fileStats.size,
            sha256: fileHash,
            timestamp: new Date().toISOString()
        };
        
        // Try to POST to your API
        // Adjust endpoint as needed
        const apiEndpoint = `${CONFIG.apiUrl}/api/hytale-launcher/new-version`;
        
        const url = new URL(apiEndpoint);
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        };
        
        return new Promise((resolve, reject) => {
            const protocol = url.protocol === 'https:' ? https : http;
            const req = protocol.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`API returned ${res.statusCode}: ${data}`));
                    }
                });
            });
            
            req.on('error', reject);
            req.write(JSON.stringify(payload));
            req.end();
        });
    } catch (error) {
        await log(`API notification failed (non-critical): ${error.message}`, 'WARNING');
    }
}

// Process a single endpoint
async function processEndpoint(endpoint) {
    try {
        await log(`Checking ${endpoint.channel} channel: ${endpoint.url}`);
        
        // Archive the launcher.json URL to Wayback Machine
        if (CONFIG.waybackEnabled) {
            try {
                const waybackResult = await archiveToWayback(endpoint.url);
                if (waybackResult) {
                    await log(`Archived to Wayback Machine: ${waybackResult}`, 'SUCCESS');
                }
            } catch (error) {
                await log(`Wayback archiving failed: ${error.message}`, 'WARNING');
            }
        }
        
        const json = await fetchJSON(endpoint.url);
        const version = json.version;
        const channel = endpoint.channel;
        
        // Create timestamp for when we discovered/downloaded this version
        const downloadTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: 2026-01-10T21-30-45
        const downloadDate = new Date().toISOString().split('T')[0]; // Format: 2026-01-10
        
        // Create descriptive version name with timestamp
        // Format: 2026.01.10-68756d1-release-2026-01-10T21-30-45
        const fullVersion = `${version}-${channel}`;
        const versionDirName = `${fullVersion}-${downloadTimestamp}`;
        
        await log(`Found version: ${version} (${channel}) at ${downloadTimestamp}`);
        
        // Check if version directory already exists (check both with and without timestamp)
        const versionDirWithoutTimestamp = path.join(CONFIG.archiveDir, fullVersion);
        const versionDirWithTimestamp = path.join(CONFIG.archiveDir, versionDirName);
        
        // Determine which directory to use (prefer existing one, or use timestamped for new)
        let versionDir = null;
        let versionExists = false;
        
        // Check for existing directories (old format first, then new format)
        try {
            await fs.access(versionDirWithoutTimestamp);
            versionDir = versionDirWithoutTimestamp;
            versionExists = true;
            await log(`Using existing directory: ${fullVersion}`, 'INFO');
        } catch {
            try {
                await fs.access(versionDirWithTimestamp);
                versionDir = versionDirWithTimestamp;
                versionExists = true;
                await log(`Using existing timestamped directory: ${versionDirName}`, 'INFO');
            } catch {
                // No existing directory - use timestamped format for new version
                versionDir = versionDirWithTimestamp;
                versionExists = false;
            }
        }
        
        if (versionExists) {
            await log(`Version ${fullVersion} already exists, checking if extraction/runtime archiving needed...`, 'INFO');
            
            // Check if extraction/runtime archiving is needed even though version exists
            if (CONFIG.extractEnabled) {
                const extractedDir = path.join(CONFIG.gitRepoPath, 'extracted', fullVersion);
                const runtimeArchiveDir = path.join(CONFIG.gitRepoPath, 'runtime-archives');
                
                let needsProcessing = false;
                
                // Check if extracted but launcher never ran (no runtime archives)
                try {
                    await fs.access(extractedDir);
                    // Extracted exists, check if runtime was archived
                    try {
                        const runtimeDirs = await fs.readdir(runtimeArchiveDir);
                        const hasRuntimeForThisVersion = runtimeDirs.some(dir => dir.includes(fullVersion));
                        if (!hasRuntimeForThisVersion && CONFIG.runLauncherEnabled) {
                            needsProcessing = true;
                            await log(`  Version extracted but launcher not run yet - will process...`, 'INFO');
                        }
                    } catch {
                        // runtime-archives doesn't exist or is empty - needs processing
                        if (CONFIG.runLauncherEnabled) {
                            needsProcessing = true;
                            await log(`  Version extracted but runtime not archived - will process...`, 'INFO');
                        }
                    }
                } catch {
                    // Not extracted yet - needs processing
                    needsProcessing = true;
                    await log(`  Version downloaded but not extracted - will process...`, 'INFO');
                }
                
                if (needsProcessing) {
                    // Process existing version for extraction/runtime archiving
                    await log(`Processing existing version: ${fullVersion}`, 'INFO');
                    const extractedFiles = await extractAndArchiveInstallers(versionDir, fullVersion);
                    
                    // Return as if downloaded so git commit happens
                    return {
                        downloaded: true, // Mark as downloaded so git commit happens
                        version: fullVersion,
                        count: 0, // No new downloads
                        versionString: version,
                        channel: channel,
                        extractedFiles: extractedFiles || []
                    };
                } else {
                    await log(`Version ${fullVersion} fully processed, skipping...`, 'INFO');
                    return { downloaded: false, version: fullVersion };
                }
            } else {
                await log(`Version ${fullVersion} already exists, skipping...`, 'INFO');
                return { downloaded: false, version: fullVersion };
            }
        }
        
        // Create version directory
        await fs.mkdir(versionDir, { recursive: true });
        
        let downloadedCount = 0;
        
        // Process download URLs
        if (json.download_url) {
            for (const [platform, platformData] of Object.entries(json.download_url)) {
                if (platformData && typeof platformData === 'object') {
                    // Handle nested structure (e.g., windows: { amd64: { url, sha256 } })
                    for (const [arch, build] of Object.entries(platformData)) {
                        if (build && build.url && build.sha256) {
                            const platformArch = `${platform}-${arch}`;
                            const platformDir = path.join(versionDir, platformArch);
                            await fs.mkdir(platformDir, { recursive: true });
                            
                            const fileName = path.basename(build.url);
                            const filePath = path.join(platformDir, fileName);
                            
                            await log(`Downloading ${fullVersion} ${platformArch}...`);
                            
                            try {
                                await downloadFile(build.url, filePath);
                                
                                // Verify SHA256
                                const fileHash = await calculateSHA256(filePath);
                                if (fileHash === build.sha256.toLowerCase()) {
                                    await log(`Downloaded and verified: ${fileName}`, 'SUCCESS');
                                    downloadedCount++;
                                    
                                    // Notify API (non-blocking, errors are logged but don't fail the download)
                                    notifyAPI(version, channel, platformArch, filePath).catch((apiError) => {
                                        // Error already logged in notifyAPI function, but ensure it's clear it's API-related
                                        // Don't log again here to avoid duplicate messages
                                    });
                                } else {
                                    await log(`SHA256 mismatch for ${fileName} (expected: ${build.sha256}, got: ${fileHash})`, 'ERROR');
                                    await fs.unlink(filePath);
                                }
                                
                                // Save metadata
                                await fs.writeFile(path.join(platformDir, 'url.txt'), build.url);
                                await fs.writeFile(path.join(platformDir, 'sha256.txt'), build.sha256);
                                
                                // Archive download URL to Wayback Machine
                                if (CONFIG.waybackEnabled) {
                                    try {
                                        const waybackResult = await archiveToWayback(build.url);
                                        if (waybackResult) {
                                            await fs.writeFile(path.join(platformDir, 'wayback.txt'), waybackResult);
                                            await log(`Archived download URL to Wayback Machine`, 'SUCCESS');
                                        }
                                    } catch (error) {
                                        // Non-critical, just log warning
                                        await log(`Wayback archiving failed for download URL: ${error.message}`, 'WARNING');
                                    }
                                }
                                
                            } catch (error) {
                                // Distinguish between download failures and other errors
                                if (error.message.includes('HTTP') || error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
                                    await log(`Failed to download ${build.url}: ${error.message}`, 'ERROR');
                                } else {
                                    await log(`Error processing ${build.url}: ${error.message}`, 'ERROR');
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Save full JSON metadata
        await fs.writeFile(
            path.join(versionDir, 'launcher.json'),
            JSON.stringify(json, null, 2)
        );
        
        // Save download metadata with timestamp
        const downloadMetadata = {
            version: version,
            channel: channel,
            downloadDate: downloadDate,
            downloadTimestamp: downloadTimestamp,
            discoveredAt: new Date().toISOString(),
            sourceUrl: endpoint.url
        };
        await fs.writeFile(
            path.join(versionDir, 'download-metadata.json'),
            JSON.stringify(downloadMetadata, null, 2)
        );
        await fs.writeFile(
            path.join(versionDir, 'download-timestamp.txt'),
            downloadTimestamp
        );
        await fs.writeFile(
            path.join(versionDir, 'download-date.txt'),
            downloadDate
        );
        
        if (downloadedCount > 0) {
            await log(`Successfully downloaded ${downloadedCount} files for ${fullVersion}`, 'SUCCESS');
            
            // Extract and archive installer contents (server-side, safe)
            // This creates extracted files and runtime archives
            let extractedFiles = [];
            if (CONFIG.extractEnabled) {
                await log(`Extraction enabled - proceeding to extract and run launcher...`, 'INFO');
                extractedFiles = await extractAndArchiveInstallers(versionDir, fullVersion);
            } else {
                await log(`Extraction disabled (EXTRACT_ENABLED=false) - skipping extraction and launcher execution`, 'INFO');
            }
            
            // Return version info for git commit (include extracted files)
            return { 
                downloaded: true, 
                version: fullVersion, 
                count: downloadedCount,
                versionString: version,
                channel: channel,
                extractedFiles: extractedFiles || []
            };
        } else {
            await log(`No files downloaded for ${fullVersion}`, 'WARNING');
            return { downloaded: false, version: fullVersion };
        }
        
    } catch (error) {
        await log(`Error processing endpoint ${endpoint.url}: ${error.message}`, 'ERROR');
        return { downloaded: false, error: error.message };
    }
}

// Extract and run Linux launcher, then archive runtime state (server-side, safe)
// Returns array of file paths (relative to git repo) that should be added to git
async function extractAndArchiveInstallers(versionDir, fullVersion) {
    const filesToAdd = [];
    try {
        await log(`Extracting Linux launcher for ${fullVersion}...`, 'INFO');
        
        // Extract to git repo directory so it gets committed
        const gitRepoPath = CONFIG.gitRepoPath;
        await log(`  Using git repo path: ${gitRepoPath}`, 'INFO');
        const extractArchiveDir = path.join(gitRepoPath, 'extracted', fullVersion);
        await fs.mkdir(extractArchiveDir, { recursive: true });
        filesToAdd.push(`extracted/${fullVersion}`);
        
        // Find Linux ZIP file
        const linuxDir = path.join(versionDir, 'linux-amd64');
        let linuxZipPath = null;
        
        try {
            const files = await fs.readdir(linuxDir, { withFileTypes: true });
            for (const file of files) {
                if (file.isFile() && file.name.endsWith('.zip')) {
                    linuxZipPath = path.join(linuxDir, file.name);
                    break;
                }
            }
        } catch (error) {
            await log(`  ⚠ Linux version not found: ${error.message}`, 'WARNING');
            return filesToAdd; // Return empty array, not undefined
        }
        
        if (!linuxZipPath) {
            await log(`  ⚠ Linux ZIP not found in ${linuxDir}`, 'WARNING');
            return filesToAdd; // Return empty array, not undefined
        }
        
        // Extract Linux launcher
        const extractDest = path.join(extractArchiveDir, 'linux-launcher');
        await fs.mkdir(extractDest, { recursive: true });
        
        try {
            await execAsync(`unzip -q "${linuxZipPath}" -d "${extractDest}"`);
            await log(`  ✓ Extracted Linux launcher to ${extractDest}`, 'SUCCESS');
            
            // Find launcher executable
            const launcherExec = await findLauncherExecutable(extractDest);
            
            if (launcherExec && CONFIG.runLauncherEnabled) {
                await log(`  Found launcher: ${launcherExec}`, 'INFO');
                await log(`  Running launcher to generate runtime state...`, 'INFO');
                
                // Make executable
                await execAsync(`chmod +x "${launcherExec}"`);
                
                // Verify executable exists and is actually executable
                try {
                    await execAsync(`test -x "${launcherExec}"`);
                } catch (error) {
                    await log(`  ⚠ Launcher file is not executable: ${launcherExec}`, 'WARNING');
                    throw new Error(`Launcher is not executable: ${error.message}`);
                }
                
                // Run launcher in background
                // Note: We keep the process reference (don't use detached: true) so we can kill it reliably
                // Capture stderr to a file so we can see if it fails to start
                const errorLogPath = path.join(extractDest, 'launcher-error.log');
                const launcherProcess = exec(`"${launcherExec}" 2>"${errorLogPath}"`, {
                    cwd: path.dirname(launcherExec),
                    stdio: ['ignore', 'ignore', 'pipe'] // Still capture stderr to file
                });
                
                // Wait a moment to see if process starts successfully
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Check if process is still running (if it crashed immediately, it won't be)
                try {
                    // Try to send signal 0 (doesn't kill, just checks if process exists)
                    process.kill(launcherProcess.pid, 0);
                    await log(`  ✓ Launcher started (PID: ${launcherProcess.pid})`, 'SUCCESS');
                } catch (error) {
                    // Process doesn't exist - it may have crashed
                    await log(`  ⚠ Launcher process may have crashed immediately (PID: ${launcherProcess.pid})`, 'WARNING');
                    // Check error log for details
                    try {
                        const errorLog = await fs.readFile(errorLogPath, 'utf8');
                        if (errorLog.trim()) {
                            await log(`  Error log: ${errorLog.substring(0, 200)}`, 'WARNING');
                        }
                    } catch {
                        // Error log doesn't exist or is empty
                    }
                    throw new Error('Launcher failed to start or crashed immediately');
                }
                
                await log(`  Waiting ${CONFIG.launcherWaitTime / 1000 / 60} minutes for downloads...`, 'INFO');
                
                // Wait for launcher to download files
                await new Promise(resolve => setTimeout(resolve, CONFIG.launcherWaitTime));
                
                // Archive runtime state (Linux paths) - WITH SAFETY FILTERS
                // This will automatically exclude: account files, tokens, cookies, cookies, login data, IPs, etc.
                const runtimeFiles = await archiveLinuxRuntimeState(extractDest, fullVersion);
                filesToAdd.push(...runtimeFiles);
                
                // Kill launcher process and all its children
                try {
                    // Try graceful termination first
                    launcherProcess.kill('SIGTERM');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                    
                    // Force kill if still running
                    if (!launcherProcess.killed) {
                        launcherProcess.kill('SIGKILL');
                        await log(`  ✓ Launcher process terminated (force kill)`, 'INFO');
                    } else {
                        await log(`  ✓ Launcher process terminated (graceful)`, 'INFO');
                    }
                } catch (error) {
                    // Try alternative method: kill by PID (works on Linux)
                    try {
                        await execAsync(`kill -TERM ${launcherProcess.pid} 2>/dev/null || kill -9 ${launcherProcess.pid} 2>/dev/null || true`);
                        await log(`  ✓ Launcher process terminated via kill command`, 'INFO');
                    } catch {
                        await log(`  ⚠ Could not terminate launcher process (may have already exited)`, 'WARNING');
                    }
                }
            } else if (launcherExec) {
                await log(`  Launcher found but RUN_LAUNCHER not enabled. Set RUN_LAUNCHER=true to run it.`, 'INFO');
            } else {
                await log(`  ⚠ Could not find launcher executable in extracted files`, 'WARNING');
            }
            
            // Create manifest
            const manifest = {
                source: linuxZipPath,
                extractedTo: extractDest,
                extractedAt: new Date().toISOString(),
                platform: 'linux-amd64',
                launcherExec: launcherExec || null,
                runLauncher: CONFIG.runLauncherEnabled
            };
            await fs.writeFile(
                path.join(extractDest, 'extraction-manifest.json'),
                JSON.stringify(manifest, null, 2)
            );
            
        } catch (error) {
            await log(`  ⚠ Failed to extract/run Linux launcher: ${error.message}`, 'WARNING');
        }
    } catch (error) {
        await log(`Failed to process Linux launcher: ${error.message}`, 'WARNING');
        // Don't throw - extraction failure shouldn't stop the download process
    }
    
    return filesToAdd; // Always return array, even if empty
}

// Find launcher executable in extracted directory
async function findLauncherExecutable(extractDir) {
    const possibleNames = [
        'hytale-launcher',
        'launcher',
    ];
    
    async function searchDir(dir) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                // Check if file is executable and matches possible names
                if (entry.isFile()) {
                    const nameLower = entry.name.toLowerCase();
                    if (possibleNames.some(n => nameLower.includes(n.toLowerCase()))) {
                        // Check if it's executable (or make it executable)
                        try {
                            await execAsync(`test -x "${fullPath}" || chmod +x "${fullPath}"`);
                            return fullPath;
                        } catch {
                            // Try anyway
                            return fullPath;
                        }
                    }
                }
                
                if (entry.isDirectory()) {
                    const found = await searchDir(fullPath);
                    if (found) return found;
                }
            }
        } catch (error) {
            // Ignore errors
        }
        return null;
    }
    
    return await searchDir(extractDir);
}

// Archive Linux runtime state (safe - excludes sensitive data)
// Returns array of file paths that should be added to git
async function archiveLinuxRuntimeState(launcherDir, fullVersion) {
    const filesToAdd = [];
    try {
        await log(`Archiving Linux runtime state for ${fullVersion}...`, 'INFO');
        await log(`  🔒 Using safety filters to exclude sensitive data`, 'INFO');
        
        // Linux launcher typically creates files in ~/.local/share/Hytale or similar
        // Support both Windows (USERPROFILE) and Linux/Mac (HOME)
        const homeDir = process.env.HOME || process.env.USERPROFILE || process.env.HOME_DIR || '/tmp';
        const possibleDataDirs = [
            path.join(homeDir, '.local', 'share', 'Hytale'),
            path.join(homeDir, '.hytale'),
            path.join(homeDir, 'Hytale'),
            path.join('/tmp', 'hytale-runtime'), // Fallback
        ];
        
        let foundDataDir = null;
        for (const dataDir of possibleDataDirs) {
            try {
                await fs.access(dataDir);
                foundDataDir = dataDir;
                await log(`  Found runtime data at: ${dataDir}`, 'INFO');
                break;
            } catch {
                // Continue searching
            }
        }
        
        if (!foundDataDir) {
            await log(`  ⚠ Runtime data directory not found in common locations`, 'INFO');
            await log(`  (Launcher may not have generated files yet, or uses different location)`, 'INFO');
            return filesToAdd; // Return empty array, not undefined
        }
        
        // Archive runtime state directly to git repo (not using runtime-archiver.js which is Windows-specific)
        const gitRepoPath = CONFIG.gitRepoPath;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const runtimeArchiveDir = path.join(gitRepoPath, 'runtime-archives', `${fullVersion}-runtime-${timestamp}`);
        await fs.mkdir(runtimeArchiveDir, { recursive: true });
        
        await log(`  Archiving to: ${runtimeArchiveDir}`, 'INFO');
        
        // Copy directory with safety filters (exclude sensitive data)
        const destPath = path.join(runtimeArchiveDir, 'appdata');
        const result = await copyDirectoryWithFilters(foundDataDir, destPath);
        
        await log(`  ✓ Runtime state archived: ${result.copied} files/dirs copied, ${result.excluded} excluded (sensitive)`, 'SUCCESS');
        await log(`  🔒 Sensitive files automatically excluded (account, tokens, cookies, etc.)`, 'SUCCESS');
        
        // Save metadata
        const metadata = {
            version: fullVersion,
            channel: 'linux',
            archivedAt: new Date().toISOString(),
            timestamp: timestamp,
            sourcePath: foundDataDir,
            filesCopied: result.copied,
            filesExcluded: result.excluded,
            safetyNote: 'Sensitive files excluded: account files, tokens, sessions, cookies, login data, IP addresses, personal data'
        };
        await fs.writeFile(
            path.join(runtimeArchiveDir, 'runtime-metadata.json'),
            JSON.stringify(metadata, null, 2)
        );
        
        // Add runtime archive to git (relative to git repo)
        const relativeRuntimePath = path.relative(gitRepoPath, runtimeArchiveDir);
        if (relativeRuntimePath && !relativeRuntimePath.startsWith('..')) {
            // Add directory and all contents
            filesToAdd.push(relativeRuntimePath);
        }
    } catch (error) {
        await log(`  ⚠ Failed to archive runtime state: ${error.message}`, 'WARNING');
        await log(`  (This is non-critical - installer is still archived)`, 'INFO');
    }
    
    return filesToAdd;
}

// Copy directory with safety filters (excludes sensitive data)
async function copyDirectoryWithFilters(src, dest, relativePath = '') {
    await fs.mkdir(dest, { recursive: true });
    
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    let copiedCount = 0;
    let excludedCount = 0;
    
    // Safety patterns to exclude
    const excludePatterns = [
        /account\.dat$/i, /account\./i, /.*account.*/i,
        /.*auth.*/i, /.*token.*/i, /.*session.*/i,
        /.*cookie.*/i, /.*password.*/i, /.*login.*/i,
        /.*credential.*/i, /.*profile.*/i, /.*user.*/i,
        /Cookies$/i, /Login Data$/i, /Web Data$/i, /History$/i
    ];
    const excludeDirs = ['Cookies', 'Login Data', 'Web Data', 'History', 'Preferences', 'Account', 'Auth', 'Session'];
    
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        const currentRelativePath = path.join(relativePath, entry.name);
        
        // Safety check: exclude sensitive files/directories
        const shouldExclude = excludeDirs.some(dir => entry.name.toLowerCase() === dir.toLowerCase()) ||
                              excludePatterns.some(pattern => pattern.test(entry.name) || pattern.test(currentRelativePath));
        
        if (shouldExclude) {
            excludedCount++;
            continue;
        }
        
        try {
            if (entry.isDirectory()) {
                const subResult = await copyDirectoryWithFilters(srcPath, destPath, currentRelativePath);
                copiedCount += subResult.copied;
                excludedCount += subResult.excluded;
            } else {
                await fs.copyFile(srcPath, destPath);
                copiedCount++;
            }
        } catch (error) {
            // Skip files that can't be copied
            excludedCount++;
        }
    }
    
    return { copied: copiedCount, excluded: excludedCount };
}

// Helper function to filter paths that are safe for git (within repo)
function filterSafeGitPaths(files) {
    return files.filter(file => {
        // Remove empty strings
        if (!file || file.trim() === '') return false;
        
        // Check if path is outside repo (starts with ..)
        if (file.startsWith('..')) {
            return false;
        }
        
        // Check if path is absolute and outside repo
        if (path.isAbsolute(file)) {
            const relative = path.relative(CONFIG.gitRepoPath, file);
            if (relative.startsWith('..')) {
                return false;
            }
        }
        
        return true;
    });
}

// Git operations
async function gitAdd(files) {
    if (!CONFIG.gitEnabled) return;
    
    try {
        // Filter out unsafe paths before adding
        const safeFiles = filterSafeGitPaths(files);
        if (safeFiles.length === 0) {
            await log(`No safe files to add to git (filtered ${files.length - safeFiles.length} unsafe paths)`, 'WARNING');
            return;
        }
        
        if (safeFiles.length < files.length) {
            await log(`Filtered ${files.length - safeFiles.length} unsafe path(s) from git add`, 'WARNING');
        }
        
        const filesStr = safeFiles.map(f => `"${f}"`).join(' ');
        await execAsync(`git add ${filesStr}`, { cwd: CONFIG.gitRepoPath });
        await log(`Git add: ${safeFiles.length} file(s)`, 'INFO');
    } catch (error) {
        await log(`Git add failed: ${error.message}`, 'WARNING');
        throw error;
    }
}

async function gitCommit(message) {
    if (!CONFIG.gitEnabled) return;
    
    try {
        await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: CONFIG.gitRepoPath });
        await log(`Git commit: ${message}`, 'SUCCESS');
    } catch (error) {
        // Check if there's nothing to commit
        if (error.message.includes('nothing to commit')) {
            await log('Git: Nothing to commit', 'INFO');
            return false;
        }
        await log(`Git commit failed: ${error.message}`, 'WARNING');
        throw error;
    }
    return true;
}

async function gitPush() {
    if (!CONFIG.gitEnabled) return;
    
    try {
        await execAsync('git push', { cwd: CONFIG.gitRepoPath });
        await log('Git push: Success', 'SUCCESS');
    } catch (error) {
        await log(`Git push failed: ${error.message}`, 'WARNING');
        throw error;
    }
}

async function gitAutoCommit(files, version, channel, timestamp) {
    if (!CONFIG.gitEnabled) {
        await log('Git automation disabled (GIT_ENABLED=false)', 'INFO');
        return;
    }
    
    try {
        await log(`Starting git automation for ${version} [${channel}] with ${files.length} file(s)`, 'INFO');
        await gitAdd(files);
        // Create descriptive commit message with readable format
        // Extract date and commit hash from version string (e.g., "2026.01.10-68756d1" -> "2026-01-10" and "68756d1")
        const versionMatch = version.match(/^(\d{4})\.(\d{2})\.(\d{2})-([a-f0-9]+)$/);
        let readableVersion = version;
        if (versionMatch) {
            const [, year, month, day, hash] = versionMatch;
            readableVersion = `${year}-${month}-${day} (commit: ${hash})`;
        }
        
        const dateStr = timestamp ? new Date(timestamp).toISOString().replace('T', ' ').slice(0, -5) + ' UTC' : new Date().toISOString().replace('T', ' ').slice(0, -5) + ' UTC';
        const commitMessage = `Auto-archive: ${readableVersion} [${channel}] - Downloaded ${dateStr} from official endpoint`;
        const committed = await gitCommit(commitMessage);
        if (committed) {
            await gitPush();
        }
    } catch (error) {
        await log(`Git automation failed: ${error.message}`, 'WARNING');
        // Don't throw - git failures shouldn't stop the download process
    }
}

// Main check function
async function checkForNewVersions() {
    await log('=== Starting version check ===', 'INFO');
    
    const results = [];
    const filesToCommit = [];
    
    for (const endpoint of CONFIG.endpoints) {
        const result = await processEndpoint(endpoint);
        results.push(result);
        
        // Collect files for git commit if download was successful
        // Note: This is legacy code - files are now collected in the main loop below
        // Keeping for potential future use but not actively used
    }
    
    const downloaded = results.filter(r => r.downloaded);
    if (downloaded.length > 0) {
        await log(`=== Check complete: ${downloaded.length} new version(s) downloaded ===`, 'SUCCESS');
        
        // Auto-commit and push to git for each downloaded version
        for (const result of downloaded) {
            if (result.downloaded && result.version) {
                try {
                    await log(`Preparing git commit for ${result.version}`, 'INFO');
                    const versionDir = path.join(CONFIG.archiveDir, result.version);
                    await log(`Version directory: ${versionDir}`, 'INFO');
                    const files = await getAllFiles(versionDir);
                    await log(`Found ${files.length} file(s) in version directory`, 'INFO');
                    let relativeFiles = files.map(f => path.relative(CONFIG.gitRepoPath, f));
                    
                    // Include extracted files in git commit
                    if (result.extractedFiles && result.extractedFiles.length > 0) {
                        await log(`Including ${result.extractedFiles.length} extracted file(s)`, 'INFO');
                        relativeFiles = relativeFiles.concat(result.extractedFiles);
                    }
                    
                    // Filter out unsafe paths (outside git repo)
                    relativeFiles = filterSafeGitPaths(relativeFiles);
                    
                    await log(`Total files to commit: ${relativeFiles.length}`, 'INFO');
                    if (relativeFiles.length > 0) {
                        // Get download timestamp from metadata if available
                        const metadataPath = path.join(versionDir, 'download-metadata.json');
                        let timestamp = null;
                        try {
                            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
                            timestamp = metadata.discoveredAt;
                        } catch {
                            // Use current time if metadata not available
                            timestamp = new Date().toISOString();
                        }
                        await gitAutoCommit(relativeFiles, result.versionString || result.version, result.channel || 'unknown', timestamp);
                    } else {
                        await log(`No files to commit for ${result.version}`, 'WARNING');
                    }
                } catch (error) {
                    await log(`Failed to commit ${result.version}: ${error.message}`, 'WARNING');
                    await log(`Error stack: ${error.stack}`, 'ERROR');
                }
            } else {
                await log(`Skipping git commit - result.downloaded=${result.downloaded}, result.version=${result.version}`, 'INFO');
            }
        }
    } else {
        await log('=== Check complete: No new versions ===', 'INFO');
    }
    
    return results;
}

// Helper function to get all files recursively
async function getAllFiles(dir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await getAllFiles(fullPath));
        } else {
            files.push(fullPath);
        }
    }
    
    return files;
}

// Main execution
async function main() {
    await ensureArchiveDir();
    
    const interval = CONFIG.customInterval || CONFIG.checkInterval;
    
    await log(`Auto-download service started (check interval: ${interval / 1000}s)`, 'INFO');
    
    // Run initial check
    await checkForNewVersions();
    
    if (CONFIG.runOnce) {
        await log('Run once mode: exiting', 'INFO');
        process.exit(0);
    }
    
    // Schedule periodic checks
    setInterval(async () => {
        await checkForNewVersions();
    }, interval);
    
    await log('Service running. Press Ctrl+C to stop.', 'INFO');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    await log('Shutting down...', 'INFO');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await log('Shutting down...', 'INFO');
    process.exit(0);
});

// Start the service
main().catch(async (error) => {
    await log(`Fatal error: ${error.message}`, 'ERROR');
    console.error(error);
    process.exit(1);
});
