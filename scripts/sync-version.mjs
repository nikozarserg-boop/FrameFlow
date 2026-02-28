#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

function getExeVersion(exePath) {
  try {
    if (!fs.existsSync(exePath)) {
      return null;
    }

    const escapedPath = exePath.replace(/\\/g, '\\\\');
    const psCommand = `(Get-Item "${escapedPath}").VersionInfo.FileVersion`;
    const result = execSync(`powershell -Command "${psCommand}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    return result || null;
  } catch (error) {
    return null;
  }
}

function removeDistContent(distPath) {
  try {
    if (!fs.existsSync(distPath)) {
      return;
    }

    const files = fs.readdirSync(distPath);
    for (const file of files) {
      const filePath = path.join(distPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }

    console.log('[INFO] Cleared dist folder due to version change');
  } catch (error) {
    console.error('[WARNING] Could not clear dist folder:', error.message);
  }
}

try {
  const versionFile = path.join(rootDir, 'version');
  const version = fs.readFileSync(versionFile, 'utf-8').trim();

  console.log('[INFO] Syncing version: ' + version);

  const distPath = path.join(rootDir, 'dist');
  const exePath = path.join(distPath, 'neuroscreencaster.exe');
  const oldExeVersion = getExeVersion(exePath);

  if (oldExeVersion && oldExeVersion !== version) {
    console.log('[INFO] Version changed from ' + oldExeVersion + ' to ' + version);
    removeDistContent(distPath);
  } else if (oldExeVersion === version) {
    console.log('[INFO] Version unchanged: ' + version);
  }

  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  packageJson.version = version;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

  const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf-8');
  cargoToml = cargoToml.replace(/^version = ".*?"$/m, `version = "${version}"`);
  fs.writeFileSync(cargoTomlPath, cargoToml);

  const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
  tauriConf.version = version;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

  console.log('[OK] Version synced to all files');
  process.exit(0);
} catch (error) {
  console.error('[ERROR] Version sync failed:', error.message);
  process.exit(1);
}
