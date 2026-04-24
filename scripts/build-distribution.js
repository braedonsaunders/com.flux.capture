#!/usr/bin/env node
/**
 * Flux Capture - Distribution Build Script
 *
 * Builds a plain SDF archive from the open source project. The output keeps
 * source files readable and does not mark files for source hiding.
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');
const BUNDLE_DIR = path.join(DIST_DIR, 'bundle');
const ARCHIVE_PATH = path.join(DIST_DIR, `flux-capture-${pkg.version}-sdf.zip`);

function log(message) {
    console.log(`[build] ${message}`);
}

function rmrf(target) {
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
    }
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
    ensureDir(dest);

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function writeInstallNotes() {
    const notes = `Flux Capture ${pkg.version}

This archive contains the SuiteCloud project files for Flux Capture.

Install:
1. Install SuiteCloud CLI: npm install -g @oracle/suitecloud-cli
2. Authenticate: suitecloud account:setup
3. Deploy from the extracted archive root: suitecloud project:deploy

No activation is required. Configure OCR/AI providers from the SuiteApp
settings page after deployment.

License: MIT
Repository: ${pkg.homepage}
`;

    fs.writeFileSync(path.join(DIST_DIR, 'INSTALL.txt'), notes);
}

function createArchive() {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(ARCHIVE_PATH);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(BUNDLE_DIR, false);
        archive.finalize();
    });
}

async function main() {
    log('Cleaning dist directory');
    rmrf(DIST_DIR);
    ensureDir(BUNDLE_DIR);

    log('Copying SDF project');
    copyDir(SRC_DIR, BUNDLE_DIR);

    log('Writing install notes');
    writeInstallNotes();

    log('Creating SDF archive');
    await createArchive();

    log(`Archive: ${ARCHIVE_PATH}`);
    log('Done');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
