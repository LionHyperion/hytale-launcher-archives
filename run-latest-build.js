#!/usr/bin/env node

/**
 * Run Latest Build - Extract and run the latest Hytale launcher build
 * 
 * This script:
 * 1. Finds the latest downloaded version
 * 2. Extracts the Linux launcher if not already extracted
 * 3. Runs the launcher to generate runtime files
 * 4. Archives the runtime state
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    gitRepoPath: process.env.GIT_REPO_PATH || (process.env.HOME ? path.join(process.env.HOME, 'hytale-launcher-archives') : path.join(__dirname)),
    versionsDir: null, // Will be set
    extractedDir: null, // Will be set
    runtimeArchiveDir: null, // Will be set
    runLauncherEnabled: process.env.RUN_LAUNCHER !== 'false',
    launcherWaitTime: process.env.LAUNCHER_WAIT_TIME ? parseInt(process.env.LAUNCHER_WAIT_TIME) : 300000, // 5 minutes
};

// Initialize paths
CONFIG.versionsDir = path.join(CONFIG.gitRepoPath, 'versions');
CONFIG.extractedDir = path.join(CONFIG.gitRepoPath, 'extracted');
CONFIG.runtimeArchiveDir = path.join(CONFIG.gitRepoPath, 'runtime-archives');

async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const colors = {
        INFO: '\x1b[36m',
        SUCCESS: '\x1b[32m',
        WARNING: '\x1b[33m',
        ERROR: '\x1b[31m',
    };
    const reset = '\x1b[0m';
    console.log(`${colors[level] || ''}[${timestamp}] [${level}] ${message}${reset}`);
}

// Find launcher executable
async function findLauncherExecutable(extractDir) {
    const possibleNames = ['hytale-launcher', 'launcher'];
    
    async function searchDir(dir) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isFile()) {
                    const nameLower = entry.name.toLowerCase();
                    if (possibleNames.some(n => nameLower.includes(n.toLowerCase()))) {
                        try {
                            await execAsync(`test -x "${fullPath}" || chmod +x "${fullPath}"`);
                            return fullPath;
                        } catch {
                            return fullPath;
                        }
                    }
                }
                if (entry.isDirectory()) {
                    const found = await searchDir(fullPath);
                    if (found) return found;
                }
            }
        } catch (error) {}
        return null;
    }
    return await searchDir(extractDir);
}

// Copy directory with safety filters (from auto-download-service.js)
async function copyDirectoryWithFilters(src, dest, relativePath = '') {
    await fs.mkdir(dest, { recursive: true });
    
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    let copiedCount = 0;
    let excludedCount = 0;
    
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
            excludedCount++;
        }
    }
    
    return { copied: copiedCount, excluded: excludedCount };
}

// Archive Linux runtime state
async function archiveLinuxRuntimeState(launcherDir, fullVersion) {
    try {
        await log(`Archiving Linux runtime state for ${fullVersion}...`, 'INFO');
        await log(`  🔒 Using safety filters to exclude sensitive data`, 'INFO');
        
        const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
        const possibleDataDirs = [
            path.join(homeDir, '.local', 'share', 'Hytale'),
            path.join(homeDir, '.hytale'),
            path.join(homeDir, 'Hytale'),
            path.join('/tmp', 'hytale-runtime'),
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
            await log(`  ⚠ Runtime data directory not found in common locations`, 'WARNING');
            await log(`  (Launcher may not have generated files yet, or uses different location)`, 'INFO');
            return null;
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const runtimeArchiveDir = path.join(CONFIG.runtimeArchiveDir, `${fullVersion}-runtime-${timestamp}`);
        await fs.mkdir(runtimeArchiveDir, { recursive: true });
        
        await log(`  Archiving to: ${runtimeArchiveDir}`, 'INFO');
        
        const destPath = path.join(runtimeArchiveDir, 'appdata');
        const result = await copyDirectoryWithFilters(foundDataDir, destPath);
        
        await log(`  ✓ Runtime state archived: ${result.copied} files/dirs copied, ${result.excluded} excluded (sensitive)`, 'SUCCESS');
        await log(`  🔒 Sensitive files automatically excluded (account, tokens, cookies, etc.)`, 'SUCCESS');
        
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
        
        return runtimeArchiveDir;
    } catch (error) {
        await log(`  ⚠ Failed to archive runtime state: ${error.message}`, 'WARNING');
        return null;
    }
}

// Extract and run launcher
async function extractAndRunLauncher(versionDir, fullVersion) {
    await log(`\n=== Processing ${fullVersion} ===`, 'INFO');
    
    // Check if already extracted
    const extractedVersionDir = path.join(CONFIG.extractedDir, fullVersion, 'linux-launcher');
    let needsExtraction = true;
    
    try {
        const files = await fs.readdir(extractedVersionDir);
        if (files.length > 0 && files.some(f => !f.endsWith('.json'))) {
            await log(`  Already extracted, checking if launcher needs to run...`, 'INFO');
            needsExtraction = false;
        }
    } catch {
        // Directory doesn't exist or is empty
    }
    
    // Find Linux ZIP
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
        await log(`  ⚠ Linux version not found: ${error.message}`, 'ERROR');
        return false;
    }
    
    if (!linuxZipPath) {
        await log(`  ⚠ Linux ZIP not found in ${linuxDir}`, 'ERROR');
        return false;
    }
    
    // Extract if needed
    if (needsExtraction) {
        await log(`  Extracting Linux launcher...`, 'INFO');
        await fs.mkdir(extractedVersionDir, { recursive: true });
        
        try {
            await execAsync(`unzip -q "${linuxZipPath}" -d "${extractedVersionDir}"`);
            await log(`  ✓ Extracted Linux launcher to ${extractedVersionDir}`, 'SUCCESS');
        } catch (error) {
            await log(`  ✗ Extraction failed: ${error.message}`, 'ERROR');
            return false;
        }
    }
    
    // Find launcher executable
    const launcherExec = await findLauncherExecutable(extractedVersionDir);
    
    if (!launcherExec) {
        await log(`  ⚠ Could not find launcher executable in extracted files`, 'ERROR');
        return false;
    }
    
    await log(`  Found launcher: ${launcherExec}`, 'INFO');
    
    // Run launcher if enabled
    if (CONFIG.runLauncherEnabled) {
        await log(`  Running launcher to generate runtime state...`, 'INFO');
        
        // Verify executable
        try {
            await execAsync(`test -x "${launcherExec}"`);
        } catch (error) {
            await log(`  ⚠ Launcher file is not executable, making it executable...`, 'WARNING');
            await execAsync(`chmod +x "${launcherExec}"`);
        }
        
        // Capture stderr to a file
        const errorLogPath = path.join(extractedVersionDir, 'launcher-error.log');
        
        // Run launcher
        const launcherProcess = exec(`"${launcherExec}" 2>"${errorLogPath}"`, {
            cwd: path.dirname(launcherExec),
            stdio: ['ignore', 'ignore', 'pipe']
        });
        
        // Wait a moment to see if process starts successfully
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if process is still running
        try {
            process.kill(launcherProcess.pid, 0);
            await log(`  ✓ Launcher started (PID: ${launcherProcess.pid})`, 'SUCCESS');
        } catch (error) {
            await log(`  ⚠ Launcher process may have crashed immediately (PID: ${launcherProcess.pid})`, 'WARNING');
            try {
                const errorLog = await fs.readFile(errorLogPath, 'utf8');
                if (errorLog.trim()) {
                    await log(`  Error log: ${errorLog.substring(0, 500)}`, 'WARNING');
                }
            } catch {
                // Error log doesn't exist or is empty
            }
            return false;
        }
        
        await log(`  Waiting ${CONFIG.launcherWaitTime / 1000 / 60} minutes for downloads...`, 'INFO');
        
        // Wait for launcher to download files
        await new Promise(resolve => setTimeout(resolve, CONFIG.launcherWaitTime));
        
        // Archive runtime state
        const runtimeArchivePath = await archiveLinuxRuntimeState(extractedVersionDir, fullVersion);
        
        // Kill launcher process
        try {
            launcherProcess.kill('SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (!launcherProcess.killed) {
                launcherProcess.kill('SIGKILL');
                await log(`  ✓ Launcher process terminated (force kill)`, 'INFO');
            } else {
                await log(`  ✓ Launcher process terminated (graceful)`, 'INFO');
            }
        } catch (error) {
            try {
                await execAsync(`kill -TERM ${launcherProcess.pid} 2>/dev/null || kill -9 ${launcherProcess.pid} 2>/dev/null || true`);
                await log(`  ✓ Launcher process terminated via kill command`, 'INFO');
            } catch {
                await log(`  ⚠ Could not terminate launcher process (may have already exited)`, 'WARNING');
            }
        }
        
        if (runtimeArchivePath) {
            await log(`  ✓ Runtime state archived: ${runtimeArchivePath}`, 'SUCCESS');
            return true;
        }
    } else {
        await log(`  Launcher found but RUN_LAUNCHER not enabled. Set RUN_LAUNCHER=true to run it.`, 'INFO');
    }
    
    return true;
}

// Find latest version
async function findLatestVersion() {
    try {
        const entries = await fs.readdir(CONFIG.versionsDir, { withFileTypes: true });
        const versions = entries
            .filter(e => e.isDirectory())
            .map(e => ({
                name: e.name,
                path: path.join(CONFIG.versionsDir, e.name),
                timestamp: e.name // Use name as timestamp for sorting
            }))
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // Sort descending (newest first)
        
        if (versions.length === 0) {
            return null;
        }
        
        return versions[0]; // Return latest
    } catch (error) {
        await log(`Error reading versions directory: ${error.message}`, 'ERROR');
        return null;
    }
}

// Main
async function main() {
    await log('=== Run Latest Build ===', 'INFO');
    await log(`Git repo: ${CONFIG.gitRepoPath}`, 'INFO');
    await log(`Versions dir: ${CONFIG.versionsDir}`, 'INFO');
    await log(`Extracted dir: ${CONFIG.extractedDir}`, 'INFO');
    await log(`Runtime archive dir: ${CONFIG.runtimeArchiveDir}`, 'INFO');
    
    // Ensure directories exist
    await fs.mkdir(CONFIG.versionsDir, { recursive: true });
    await fs.mkdir(CONFIG.extractedDir, { recursive: true });
    await fs.mkdir(CONFIG.runtimeArchiveDir, { recursive: true });
    
    // Find latest version
    const latestVersion = await findLatestVersion();
    
    if (!latestVersion) {
        await log('No versions found. Run the auto-download service first to download versions.', 'ERROR');
        process.exit(1);
    }
    
    await log(`\nLatest version: ${latestVersion.name}`, 'INFO');
    
    // Process it
    const success = await extractAndRunLauncher(latestVersion.path, latestVersion.name);
    
    if (success) {
        await log(`\n=== Complete ===`, 'SUCCESS');
        await log(`Processed: ${latestVersion.name}`, 'SUCCESS');
    } else {
        await log(`\n=== Failed ===`, 'ERROR');
        process.exit(1);
    }
}

main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
});
