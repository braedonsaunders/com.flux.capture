#!/usr/bin/env node

/**
 * Smart NetSuite Sync Script
 * Only uploads files that have changed since the last sync
 *
 * Usage:
 *   node scripts/sync.js              # Sync changed files since last sync (local dev)
 *   node scripts/sync.js --ci         # Sync only files changed in latest commit (for CI/CD)
 *   node scripts/sync.js --all        # Force sync all files + deploy Objects (custom records, scripts)
 *   node scripts/sync.js --deploy     # Full project deploy (Objects + Files) via SDF
 *   node scripts/sync.js --watch      # Watch for changes and auto-sync
 *   node scripts/sync.js --no-delete  # Skip deletion of removed files
 *
 * Environment variables:
 *   BASE_SHA  - Base commit to compare against in CI mode. When set, detects all
 *               changed/deleted files from BASE_SHA to HEAD. This properly handles
 *               merged PRs with multiple commits. Falls back to HEAD~1 if not set.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SYNC_STATE_FILE = '.sync-state.json';
const FILE_CABINET_PATH = 'src/FileCabinet/SuiteApps/com.flux.capture';
const OBJECTS_PATH = 'src/Objects';

// File extensions to sync
const SYNCABLE_EXTENSIONS = ['.js', '.css', '.html', '.json', '.xml'];


function log(message, type = 'info') {
    const prefix = {
        info: '\x1b[36m[SYNC]\x1b[0m',
        success: '\x1b[32m[SYNC]\x1b[0m',
        error: '\x1b[31m[SYNC]\x1b[0m',
        warn: '\x1b[33m[SYNC]\x1b[0m'
    };
    console.log(`${prefix[type]} ${message}`);
}

function loadSyncState() {
    try {
        if (fs.existsSync(SYNC_STATE_FILE)) {
            return JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
        }
    } catch (e) {
        log('Could not load sync state, starting fresh', 'warn');
    }
    return { lastSync: null, fileHashes: {} };
}

function saveSyncState(state) {
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

function getFileHash(filePath) {
    try {
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath);
        return `${stats.mtimeMs}-${stats.size}-${content.slice(0, 100).toString('hex')}`;
    } catch (e) {
        return null;
    }
}

function getAllFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            getAllFiles(fullPath, files);
        } else if (SYNCABLE_EXTENSIONS.includes(path.extname(item).toLowerCase())) {
            files.push(fullPath);
        }
    }
    return files;
}

function getChangedFiles(state) {
    const allFiles = getAllFiles(FILE_CABINET_PATH);
    const changedFiles = [];
    const newHashes = {};

    for (const file of allFiles) {
        const hash = getFileHash(file);
        newHashes[file] = hash;

        if (!state.fileHashes[file] || state.fileHashes[file] !== hash) {
            changedFiles.push(file);
        }
    }

    return { changedFiles, newHashes };
}

function getGitChangedFiles() {
    try {
        const output = execSync('git diff --name-only HEAD 2>/dev/null || git diff --name-only', {
            encoding: 'utf8'
        }).trim();

        if (!output) return [];

        return output.split('\n')
            .filter(f => f.startsWith(FILE_CABINET_PATH))
            .filter(f => SYNCABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    } catch (e) {
        return [];
    }
}

function getBaseRef() {
    const baseSha = process.env.BASE_SHA;
    if (baseSha && baseSha !== '0000000000000000000000000000000000000000') {
        return baseSha;
    }
    return 'HEAD~1';
}

function getGitCommitChangedFiles() {
    try {
        const baseRef = getBaseRef();
        log(`Comparing changes from ${baseRef} to HEAD...`);
        const output = execSync(`git diff --name-only ${baseRef} HEAD 2>/dev/null`, {
            encoding: 'utf8'
        }).trim();

        if (!output) return [];

        return output.split('\n')
            .filter(f => f.startsWith(FILE_CABINET_PATH))
            .filter(f => SYNCABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
            .filter(f => fs.existsSync(f));
    } catch (e) {
        log('Could not detect changed files, syncing all files', 'warn');
        return getAllFiles(FILE_CABINET_PATH);
    }
}

function getGitCommitDeletedFiles() {
    try {
        const baseRef = getBaseRef();
        log(`Detecting deleted files from ${baseRef} to HEAD...`);
        const output = execSync(`git diff --name-only --diff-filter=D ${baseRef} HEAD 2>/dev/null`, {
            encoding: 'utf8'
        }).trim();

        if (!output) return [];

        return output.split('\n')
            .filter(f => f.startsWith(FILE_CABINET_PATH))
            .filter(f => SYNCABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    } catch (e) {
        log('Could not detect deleted files', 'warn');
        return [];
    }
}

function deleteFile(filePath) {
    try {
        // Path with leading slash as per Oracle docs
        const fileCabinetPath = '/' + filePath.replace(/^src\/FileCabinet\//, '');

        log(`Deleting: ${filePath}`);
        log(`  File Cabinet path: ${fileCabinetPath}`);

        const output = execSync(`suitecloud file:delete --paths "${fileCabinetPath}"`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        if (output) {
            log(`  Output: ${output.trim()}`, 'success');
        }
        return true;
    } catch (e) {
        const errorMsg = e.stderr || e.stdout || e.message;
        log(`Failed to delete ${filePath}: ${errorMsg}`, 'error');
        return false;
    }
}

function deleteFiles(files) {
    if (files.length === 0) {
        return { success: 0, failed: 0 };
    }

    log(`Deleting ${files.length} file(s)...`);

    let success = 0;
    let failed = 0;

    for (const file of files) {
        if (deleteFile(file)) {
            success++;
        } else {
            failed++;
        }
    }

    return { success, failed };
}

/**
 * Run full SDF project deployment
 * This deploys Objects (custom records, scripts) and Files according to deploy.xml
 */
function runProjectDeploy() {
    try {
        log(`Running SDF project:deploy...`, 'info');
        log(`  This will deploy Objects (custom records, scripts) and Files`, 'info');

        execSync('suitecloud project:deploy', {
            encoding: 'utf8',
            stdio: 'inherit',
            cwd: path.join(process.cwd(), 'src')
        });

        log(`Project deployed successfully`, 'success');
        return true;
    } catch (e) {
        log(`Project deploy failed: ${e.message}`, 'error');
        return false;
    }
}

/**
 * Get list of Object files that have changed
 */
function getChangedObjectFiles() {
    try {
        const baseRef = getBaseRef();
        const output = execSync(`git diff --name-only ${baseRef} HEAD 2>/dev/null`, {
            encoding: 'utf8'
        }).trim();

        if (!output) return [];

        return output.split('\n')
            .filter(f => f.startsWith(OBJECTS_PATH))
            .filter(f => f.endsWith('.xml'));
    } catch (e) {
        return [];
    }
}

/**
 * Check if any Object files exist (for first-time setup detection)
 */
function hasObjectFiles() {
    if (!fs.existsSync(OBJECTS_PATH)) return false;
    const files = fs.readdirSync(OBJECTS_PATH);
    return files.some(f => f.endsWith('.xml'));
}

function uploadFile(filePath) {
    try {
        // Path with leading slash as per Oracle docs
        const fileCabinetPath = '/' + filePath.replace(/^src\/FileCabinet\//, '');

        log(`Uploading: ${filePath}`);
        log(`  File Cabinet path: ${fileCabinetPath}`);

        let output;
        let stderr;
        try {
            output = execSync(`suitecloud file:upload --paths "${fileCabinetPath}"`, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch (cmdError) {
            output = cmdError.stdout || '';
            stderr = cmdError.stderr || '';
            log(`  Command output: ${output.trim()}`, 'warn');
            if (stderr) {
                log(`  Command stderr: ${stderr.trim()}`, 'warn');
            }
        }

        // Check for failure
        if (output && (output.includes('were not uploaded') || output.includes('problem when uploading') || output.includes('does not exist'))) {
            log(`  Upload result: ${output.trim()}`, 'warn');

            // Retry once without project:deploy (which is broken for SuiteApps)
            log(`  Retrying upload...`);
            try {
                output = execSync(`suitecloud file:upload --paths "${fileCabinetPath}"`, {
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                if (output && (output.includes('were not uploaded') || output.includes('problem when uploading') || output.includes('does not exist'))) {
                    log(`  FAILED: ${output.trim()}`, 'error');
                    return false;
                }
            } catch (retryError) {
                log(`  FAILED: ${retryError.stdout || retryError.stderr || retryError.message}`, 'error');
                return false;
            }
        }

        if (output && !output.includes('FAILED') && !output.includes('were not uploaded')) {
            log(`  Success`, 'success');
        }
        return true;
    } catch (e) {
        const errorMsg = e.stderr || e.stdout || e.message;
        log(`Failed to upload ${filePath}: ${errorMsg}`, 'error');
        return false;
    }
}

function uploadFiles(files) {
    if (files.length === 0) {
        log('No files to sync', 'success');
        return { success: 0, failed: 0 };
    }

    log(`Syncing ${files.length} file(s)...`);

    let success = 0;
    let failed = 0;

    for (const file of files) {
        if (uploadFile(file)) {
            success++;
        } else {
            failed++;
        }
    }

    return { success, failed };
}

function watchMode() {
    log('Starting watch mode... (Ctrl+C to stop)', 'info');

    const state = loadSyncState();
    let debounceTimer = null;
    let pendingFiles = new Set();

    const watcher = fs.watch(FILE_CABINET_PATH, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = path.join(FILE_CABINET_PATH, filename);
        const ext = path.extname(filename).toLowerCase();

        if (!SYNCABLE_EXTENSIONS.includes(ext)) return;
        if (!fs.existsSync(fullPath)) return;

        pendingFiles.add(fullPath);

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const filesToSync = Array.from(pendingFiles);
            pendingFiles.clear();

            const { success, failed } = uploadFiles(filesToSync);

            if (success > 0) {
                for (const file of filesToSync) {
                    state.fileHashes[file] = getFileHash(file);
                }
                state.lastSync = new Date().toISOString();
                saveSyncState(state);
                log(`Synced ${success} file(s)${failed > 0 ? `, ${failed} failed` : ''}`, 'success');
            }
        }, 500);
    });

    process.on('SIGINT', () => {
        watcher.close();
        log('Watch mode stopped', 'info');
        process.exit(0);
    });
}

function main() {
    const args = process.argv.slice(2);
    const forceAll = args.includes('--all');
    const deployMode = args.includes('--deploy');
    const ciMode = args.includes('--ci');
    const watchModeEnabled = args.includes('--watch');
    const noDelete = args.includes('--no-delete');

    if (watchModeEnabled) {
        watchMode();
        return;
    }

    // Full deploy mode - uses SDF project:deploy for Objects and Files
    if (deployMode) {
        log('Deploy mode: running full SDF project deployment...');
        if (!hasObjectFiles()) {
            log('No Object files found in src/Objects/', 'warn');
        }
        const success = runProjectDeploy();
        if (!success) {
            process.exit(1);
        }
        return;
    }

    const state = loadSyncState();
    let filesToSync;
    let filesToDelete = [];
    let needsObjectDeploy = false;

    if (forceAll) {
        log('Force syncing all files...');
        filesToSync = getAllFiles(FILE_CABINET_PATH);
        // Also deploy Objects when using --all
        needsObjectDeploy = hasObjectFiles();
    } else if (ciMode) {
        log('CI mode: detecting files changed in latest commit...');
        filesToSync = getGitCommitChangedFiles();

        // Check if any Objects changed - if so, need full deploy
        const changedObjects = getChangedObjectFiles();
        if (changedObjects.length > 0) {
            log(`Detected ${changedObjects.length} changed Object file(s):`, 'info');
            changedObjects.forEach(f => log(`  - ${f}`));
            needsObjectDeploy = true;
        }

        if (!noDelete) {
            filesToDelete = getGitCommitDeletedFiles();
        }

        if (filesToSync.length === 0 && filesToDelete.length === 0 && !needsObjectDeploy) {
            log('No SuiteApp files changed in this commit', 'success');
            return;
        }
    } else {
        const gitChanges = getGitChangedFiles();
        const { changedFiles, newHashes } = getChangedFiles(state);

        filesToSync = [...new Set([...gitChanges, ...changedFiles])];
        state.fileHashes = { ...state.fileHashes, ...newHashes };
    }

    // If Objects need deployment, use full SDF deploy
    if (needsObjectDeploy) {
        log('Objects need deployment - running full SDF project:deploy...', 'info');
        const deploySuccess = runProjectDeploy();
        if (!deploySuccess) {
            log('Full project deploy failed', 'error');
            process.exit(1);
        }
        log('Full project deployment completed', 'success');
        return;
    }

    // Upload new/changed files
    const { success: uploadSuccess, failed: uploadFailed } = uploadFiles(filesToSync);

    // Delete removed files
    const { success: deleteSuccess, failed: deleteFailed } = deleteFiles(filesToDelete);

    // Remove deleted files from sync state
    for (const file of filesToDelete) {
        delete state.fileHashes[file];
    }

    if ((uploadSuccess > 0 || forceAll) && !ciMode) {
        state.lastSync = new Date().toISOString();
        for (const file of filesToSync) {
            state.fileHashes[file] = getFileHash(file);
        }
        saveSyncState(state);
    }

    const totalSuccess = uploadSuccess + deleteSuccess;
    const totalFailed = uploadFailed + deleteFailed;

    if (totalFailed > 0) {
        log(`Completed with errors: ${uploadSuccess} uploaded, ${deleteSuccess} deleted, ${totalFailed} failed`, 'warn');
        process.exit(1);
    } else if (totalSuccess > 0) {
        const parts = [];
        if (uploadSuccess > 0) parts.push(`${uploadSuccess} uploaded`);
        if (deleteSuccess > 0) parts.push(`${deleteSuccess} deleted`);
        log(`Successfully synced: ${parts.join(', ')}`, 'success');
    }
}

main();
