#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist-electron');
const version = require(path.join(rootDir, 'package.json')).version;
const forceMetadataRefresh = process.argv.includes('--refresh-metadata');
const appName = 'Selene.app';
const dmgName = `Selene-${version}-arm64.dmg`;
const dmgPath = path.join(distDir, dmgName);
const appPath = path.join(distDir, 'mac-arm64', appName);
const volumeName = 'Selene';
const backgroundName = '.background.tiff';
const iconName = '.VolumeIcon.icns';
const mountRoot = '/Volumes';

function exists(targetPath) {
  return fs.existsSync(targetPath);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });
}

function detachIfMounted(volumePath) {
  if (!exists(volumePath)) return;
  try {
    run('hdiutil', ['detach', volumePath]);
  } catch {
    run('hdiutil', ['detach', '-force', volumePath]);
  }
}

function nextFreeVolumePath(baseName) {
  let candidate = path.join(mountRoot, baseName);
  let index = 1;
  while (exists(candidate)) {
    index += 1;
    candidate = path.join(mountRoot, `${baseName} ${index}`);
  }
  return candidate;
}

function attachDmg(targetDmgPath) {
  const expectedMountPath = nextFreeVolumePath(volumeName);
  run('hdiutil', ['attach', '-nobrowse', '-readonly', targetDmgPath]);
  return expectedMountPath;
}

function dmgContainsApp(targetDmgPath) {
  if (!exists(targetDmgPath)) return false;
  const mountPath = attachDmg(targetDmgPath);
  try {
    return exists(path.join(mountPath, appName));
  } finally {
    detachIfMounted(mountPath);
  }
}

function ensureMountedStaging(targetPath, mountPath) {
  run('hdiutil', [
    'attach',
    '-nobrowse',
    '-readwrite',
    '-noverify',
    '-mountpoint',
    mountPath,
    targetPath,
  ]);
}

function createRecoveryDmg() {
  if (!exists(appPath)) {
    throw new Error(`Missing app bundle at ${appPath}`);
  }

  const tempDir = path.join(distDir, '__dmg-recovery__');
  const stagingDmg = path.join(tempDir, 'Selene-staging.dmg');
  const finalDmg = path.join(tempDir, dmgName);
  const mountPath = path.join(tempDir, 'mnt');

  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const appSizeKb = Number(run('du', ['-sk', appPath], { capture: true }).trim().split(/\s+/)[0]);
  const imageSizeMb = Math.ceil((appSizeKb * 1.2) / 1024) + 256;

  run('hdiutil', [
    'create',
    '-srcfolder',
    path.join(distDir, 'mac-arm64'),
    '-volname',
    volumeName,
    '-fs',
    'HFS+',
    '-format',
    'UDRW',
    '-size',
    `${imageSizeMb}m`,
    stagingDmg,
  ]);

  fs.mkdirSync(mountPath, { recursive: true });
  ensureMountedStaging(stagingDmg, mountPath);

  try {
    const mountedAppPath = path.join(mountPath, appName);
    if (!exists(mountedAppPath)) {
      throw new Error(`Mounted staging DMG is missing ${appName}`);
    }

    const applicationsLink = path.join(mountPath, 'Applications');
    if (!exists(applicationsLink)) {
      fs.symlinkSync('/Applications', applicationsLink);
    }

    const backgroundSource = path.join(distDir, backgroundName);
    if (exists(backgroundSource)) {
      fs.copyFileSync(backgroundSource, path.join(mountPath, backgroundName));
    }

    const iconSource = path.join(distDir, iconName);
    if (exists(iconSource)) {
      fs.copyFileSync(iconSource, path.join(mountPath, iconName));
    }
  } finally {
    detachIfMounted(mountPath);
  }

  run('hdiutil', ['convert', stagingDmg, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', finalDmg]);

  fs.copyFileSync(finalDmg, dmgPath);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function updateLatestMacYaml() {
  const latestMacPath = path.join(distDir, 'latest-mac.yml');
  if (!exists(dmgPath)) return;

  const buffer = fs.readFileSync(dmgPath);
  const size = fs.statSync(dmgPath).size;
  const sha512 = crypto.createHash('sha512').update(buffer).digest('base64');
  const releaseDate = new Date().toISOString();
  const content = [
    `version: ${version}`,
    'files:',
    `  - url: ${path.basename(dmgPath)}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${path.basename(dmgPath)}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
  ].filter(Boolean).join('\n');

  fs.writeFileSync(latestMacPath, `${content}\n`);
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('Skipping DMG recovery: macOS only.');
    return;
  }

  if (!exists(dmgPath)) {
    console.log(`Skipping DMG recovery: missing ${dmgName}.`);
    return;
  }

  if (dmgContainsApp(dmgPath)) {
    if (forceMetadataRefresh) {
      const staleBlockmapPath = `${dmgPath}.blockmap`;
      if (exists(staleBlockmapPath)) {
        fs.rmSync(staleBlockmapPath, { force: true });
      }
      updateLatestMacYaml();
      console.log('DMG looks healthy; metadata refreshed.');
      return;
    }

    console.log('DMG looks healthy; no recovery needed.');
    return;
  }

  console.warn('Generated DMG is missing Selene.app. Rebuilding DMG from dist-electron/mac-arm64/Selene.app...');
  createRecoveryDmg();

  const staleBlockmapPath = `${dmgPath}.blockmap`;
  if (exists(staleBlockmapPath)) {
    fs.rmSync(staleBlockmapPath, { force: true });
  }

  if (!dmgContainsApp(dmgPath)) {
    throw new Error('Recovered DMG is still missing Selene.app');
  }

  updateLatestMacYaml();
  console.log(`Recovered DMG at ${dmgPath}`);
}

main();
