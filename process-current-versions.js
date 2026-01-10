#!/usr/bin/env node

/**
 * Process Current Versions - One-time script to extract and archive existing downloaded versions
 * 
 * This script processes versions that were downloaded but not yet extracted/archived.
 * It uses the same extraction and archiving logic as the main service.
 */

const path = require('path');
const fs = require('fs').promises;

// Load the main service to reuse its functions
// We'll need to set up the config first
process.env.GIT_REPO_PATH = process.env.GIT_REPO_PATH || (process.env.HOME ? path.join(process.env.HOME, 'hytale-launcher-archives') : null);
process.env.EXTRACT_ENABLED = 'true';
process.env.RUN_LAUNCHER = process.env.RUN_LAUNCHER || 'true';
process.env.GIT_ENABLED = 'true';

if (!process.env.GIT_REPO_PATH) {
    console.error('ERROR: GIT_REPO_PATH or HOME must be set');
    process.exit(1);
}

// Import the service (this will initialize CONFIG)
const servicePath = path.join(__dirname, 'auto-download-service.js');
delete require.cache[require.resolve(servicePath)];

// We need to extract the functions we need
// Let's create a simpler approach - directly use the service's logic

async function main() {
    console.log('=== Processing Current Versions ===\n');
    
    const gitRepoPath = path.resolve(process.env.GIT_REPO_PATH);
    const versionsDir = path.join(gitRepoPath, 'versions');
    
    console.log(`Git repo path: ${gitRepoPath}`);
    console.log(`Versions directory: ${versionsDir}\n`);
    
    // Find all version directories
    let versions = [];
    try {
        const entries = await fs.readdir(versionsDir, { withFileTypes: true });
        versions = entries
            .filter(e => e.isDirectory())
            .map(e => ({
                name: e.name,
                path: path.join(versionsDir, e.name)
            }));
    } catch (error) {
        console.error(`Error reading versions directory: ${error.message}`);
        console.error(`Directory may not exist yet. Versions will be processed when they are downloaded.`);
        process.exit(0);
    }
    
    if (versions.length === 0) {
        console.log('No versions found to process.');
        console.log('Versions will be automatically processed when downloaded by the service.');
        process.exit(0);
    }
    
    console.log(`Found ${versions.length} version(s) to process:\n`);
    versions.forEach(v => console.log(`  - ${v.name}`));
    console.log('');
    
    // For each version, we need to trigger extraction
    // The easiest way is to temporarily mark them as "new" by checking if extracted/ exists
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    for (const version of versions) {
        console.log(`\n=== Processing ${version.name} ===`);
        
        const extractedDir = path.join(gitRepoPath, 'extracted', version.name);
        let needsProcessing = false;
        
        try {
            await fs.access(extractedDir);
            console.log(`  Already extracted, skipping...`);
        } catch {
            needsProcessing = true;
            console.log(`  Not yet extracted, will process...`);
        }
        
        if (needsProcessing) {
            // Check if Linux ZIP exists
            const linuxDir = path.join(version.path, 'linux-amd64');
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
                console.log(`  ⚠ Linux version not found: ${error.message}`);
                continue;
            }
            
            if (!linuxZipPath) {
                console.log(`  ⚠ Linux ZIP not found`);
                continue;
            }
            
            console.log(`  Found Linux ZIP: ${path.basename(linuxZipPath)}`);
            console.log(`  Running extraction and archiving...`);
            
            // Use the service's extraction function by calling it via node
            // We'll run the service in a way that forces it to process this version
            try {
                // Actually, let's just directly call the extraction logic
                // We need to require the service and call extractAndArchiveInstallers
                const service = require(servicePath);
                
                // The service exports functions, but we need to access them
                // Let's use a different approach - run the service with a flag to process existing
                console.log(`  Note: Full extraction with launcher execution will happen automatically`);
                console.log(`  when the service detects new versions. For now, extracting files...`);
                
                // Extract manually
                await fs.mkdir(extractedDir, { recursive: true });
                const extractDest = path.join(extractedDir, 'linux-launcher');
                await fs.mkdir(extractDest, { recursive: true });
                
                await execAsync(`unzip -q "${linuxZipPath}" -d "${extractDest}"`);
                console.log(`  ✓ Extracted to: ${extractDest}`);
                
                // Create manifest
                const manifest = {
                    source: linuxZipPath,
                    extractedTo: extractDest,
                    extractedAt: new Date().toISOString(),
                    platform: 'linux-amd64',
                    processedBy: 'process-current-versions.js',
                    note: 'Extracted manually. Launcher will be run automatically on next new version.'
                };
                await fs.writeFile(
                    path.join(extractDest, 'extraction-manifest.json'),
                    JSON.stringify(manifest, null, 2)
                );
                
                console.log(`  ✓ Created manifest`);
                
            } catch (error) {
                console.error(`  ✗ Error: ${error.message}`);
            }
        }
    }
    
    // Commit and push everything
    console.log(`\n=== Committing to Git ===`);
    try {
        await execAsync(`cd "${gitRepoPath}" && git add versions/ extracted/ 2>/dev/null || true`);
        await execAsync(`cd "${gitRepoPath}" && git add -A extracted/ 2>/dev/null || true`);
        
        const status = await execAsync(`cd "${gitRepoPath}" && git status --short`);
        if (status.stdout.trim()) {
            await execAsync(`cd "${gitRepoPath}" && git commit -m "Process existing versions: extract Linux launchers"`);
            console.log(`  ✓ Committed`);
            
            await execAsync(`cd "${gitRepoPath}" && git push`);
            console.log(`  ✓ Pushed to GitHub`);
        } else {
            console.log(`  No changes to commit`);
        }
    } catch (error) {
        console.error(`  ⚠ Git error: ${error.message}`);
    }
    
    console.log(`\n=== Done ===`);
    console.log(`\nNote: To run the launcher and archive runtime state, wait for a new version`);
    console.log(`or manually run the launcher from the extracted directory.`);
}

main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
});
