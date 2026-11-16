// tests/test_package_integrity.mjs - Verify webOS IPK structure and assets
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Package Integrity & webOS Conformance', () => {
    const rootDir = path.resolve('.');
    const srcDir = path.join(rootDir, 'src');
    const appinfoPath = path.join(srcDir, 'appinfo.json');

    test('1. appinfo.json contains mandatory webOS fields and valid format', () => {
        assert.ok(fs.existsSync(appinfoPath), 'appinfo.json must exist');
        const content = fs.readFileSync(appinfoPath, 'utf8');
        const manifest = JSON.parse(content);

        assert.equal(manifest.id, 'org.webosbrew.vkvideo.adfree', 'Manifest id mismatch');
        assert.equal(manifest.version, '1.0.0', 'Manifest version mismatch');
        assert.equal(manifest.type, 'web', 'Manifest type must be web');
        assert.equal(manifest.main, 'index.html', 'Manifest main entry mismatch');
        assert.equal(manifest.resolution, '1920x1080', 'UI resolution must be 1920x1080 for 60fps leanback');
        assert.equal(manifest.privilegedJail, true, 'privilegedJail required for webOS homebrew');
        assert.equal(manifest.allowCrossDomain, true, 'allowCrossDomain required for CORS HLS streams');
        assert.equal(manifest.disableBackHistoryAPI, true, 'disableBackHistoryAPI required for webOS back key');
    });

    test('2. All required runtime JS libraries and source files are present', () => {
        const requiredFiles = [
            'src/index.html',
            'src/css/style.css',
            'src/js/api.js',
            'src/js/player.js',
            'src/js/navigation.js',
            'src/js/hls.min.js',
            'src/js/qrcode.min.js',
            'src/assets/icon.png',
            'src/assets/largeIcon.png',
            'src/assets/extraLargeIcon.png',
            'src/assets/splashBackground.png'
        ];

        for (const file of requiredFiles) {
            const fullPath = path.join(rootDir, file);
            assert.ok(fs.existsSync(fullPath), `Required runtime file missing: ${file}`);
            const stat = fs.statSync(fullPath);
            assert.ok(stat.size > 0, `File is empty: ${file}`);
        }
    });

    test('3. Built .ipk archive exists and has valid ar header', () => {
        const ipkPath = path.join(rootDir, 'build', 'org.webosbrew.vkvideo.adfree_1.0.0_all.ipk');
        assert.ok(fs.existsSync(ipkPath), 'Built .ipk must exist');

        const fd = fs.openSync(ipkPath, 'r');
        const buffer = Buffer.alloc(8);
        fs.readSync(fd, buffer, 0, 8, 0);
        fs.closeSync(fd);

        // Debian/IPK archive magic signature is "!<arch>\n"
        const magic = buffer.toString('binary');
        assert.equal(magic, '!<arch>\n', 'IPK package must have valid AR header (!<arch>\\n)');
    });
});
