#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist-electron');
const version = require(path.join(rootDir, 'package.json')).version;
const forceMetadataRefresh = process.argv.includes('--refresh-metadata');
const appName = 'Selene.app';
const volumeName = 'Selene';
const backgroundName = '.background.tiff';
const iconName = '.VolumeIcon.icns';

function exists(targetPath) {
  return fs.existsSync(targetPath);
}

function canonicalPath(targetPath) {
  if (!targetPath) return targetPath;

  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitFor(check, { attempts = 20, delayMs = 200 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (check()) return true;
    if (attempt < attempts) sleep(delayMs);
  }
  return check();
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });
}

function removeDirWithRetry(targetPath, maxAttempts = 10) {
  const retryable = new Set(['EBUSY', 'ENOTEMPTY']);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error && retryable.has(error.code) && attempt < maxAttempts) {
        sleep(200);
        continue;
      }
      if (error && retryable.has(error.code)) {
        console.warn(`Skipping cleanup for temporary directory (${error.code}): ${targetPath}`);
        return;
      }
      throw error;
    }
  }
}

function isMountedPath(targetPath) {
  const canonicalTargetPath = canonicalPath(targetPath);
  const output = run('hdiutil', ['info'], { capture: true });
  return output
    .split('\n')
    .some((line) => {
      if (!line.trimStart().startsWith('mount-point')) return false;
      const mountedPath = line.split(':').slice(1).join(':').trim();
      return canonicalPath(mountedPath) === canonicalTargetPath;
    });
}

function detachIfMounted(volumePath) {
  if (!exists(volumePath) || !isMountedPath(volumePath)) return;
  try {
    run('hdiutil', ['detach', volumePath]);
  } catch (error) {
    if (!isMountedPath(volumePath)) {
      return;
    }

    const message = String(error && error.message ? error.message : error);
    if (message.includes('No such file or directory')) {
      return;
    }

    try {
      run('hdiutil', ['detach', '-force', volumePath]);
    } catch (forceError) {
      if (!isMountedPath(volumePath)) {
        return;
      }

      const forceMessage = String(forceError && forceError.message ? forceError.message : forceError);
      if (forceMessage.includes('No such file or directory')) {
        return;
      }
      throw forceError;
    }
  }

  waitFor(() => !isMountedPath(volumePath));
}

function attachedDevicesForImage(targetDmgPath) {
  const output = run('hdiutil', ['info'], { capture: true });
  const lines = output.split('\n');
  const devices = [];
  let inMatchingImage = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('image-path')) {
      const imagePath = line.split(':').slice(1).join(':').trim();
      inMatchingImage = imagePath === targetDmgPath;
      continue;
    }

    if (!inMatchingImage) continue;

    const match = line.match(/^\/dev\/disk\d+/);
    if (match) {
      devices.push(match[0]);
      continue;
    }

    if (line.startsWith('================================================')) {
      inMatchingImage = false;
    }
  }

  return [...new Set(devices)];
}

function detachImageIfMounted(targetDmgPath) {
  const devices = attachedDevicesForImage(targetDmgPath);
  for (const device of devices.reverse()) {
    try {
      run('hdiutil', ['detach', device]);
    } catch {
      try {
        run('hdiutil', ['detach', '-force', device]);
      } catch (error) {
        const message = String(error && error.message ? error.message : error);
        if (
          message.includes('No such file or directory') ||
          message.includes('Resource busy')
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  waitFor(() => attachedDevicesForImage(targetDmgPath).length === 0);
}

function attachDmgAtMountPath(targetDmgPath, mountPath) {
  return run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPath, targetDmgPath], {
    capture: true,
  });
}

function attachDmg(targetDmgPath, mountPath) {
  let output;

  try {
    output = attachDmgAtMountPath(targetDmgPath, mountPath);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    const stderr = String(error && error.stderr ? error.stderr : '');
    if (!message.includes('Resource busy') && !stderr.includes('Resource busy')) {
      throw error;
    }

    detachImageIfMounted(targetDmgPath);
    output = attachDmgAtMountPath(targetDmgPath, mountPath);
  }

  if (!output.includes(mountPath)) {
    throw new Error(`Unable to mount ${path.basename(targetDmgPath)} at ${mountPath}`);
  }
  return mountPath;
}

function dmgContainsApp(targetDmgPath) {
  if (!exists(targetDmgPath)) return false;
  const tempDir = makeTempDir('selene-dmg-check-');
  const mountPath = path.join(tempDir, 'mnt');
  fs.mkdirSync(mountPath, { recursive: true });

  attachDmg(targetDmgPath, mountPath);
  try {
    return exists(path.join(mountPath, appName));
  } finally {
    detachIfMounted(mountPath);
    if (isMountedPath(mountPath)) {
      detachImageIfMounted(targetDmgPath);
    }
    removeDirWithRetry(tempDir);
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

function listMacDmgs() {
  if (!exists(distDir)) return [];
  return fs
    .readdirSync(distDir)
    .filter((name) => name.endsWith('.dmg') && name.includes(version))
    .map((name) => path.join(distDir, name))
    .sort();
}

function resolveAppPathForDmg(dmgPath) {
  const dmgName = path.basename(dmgPath).toLowerCase();
  const preferredDirs = [];

  if (dmgName.includes('arm64')) preferredDirs.push('mac-arm64');
  if (dmgName.includes('x64')) preferredDirs.push('mac');
  if (dmgName.includes('intel')) preferredDirs.push('mac');

  preferredDirs.push('mac-arm64', 'mac');

  for (const dirName of preferredDirs) {
    const candidate = path.join(distDir, dirName, appName);
    if (exists(candidate)) return candidate;
  }

  return null;
}

function createRecoveryDmg(dmgPath, appPath) {
  if (!exists(appPath)) {
    throw new Error(`Missing app bundle at ${appPath}`);
  }

  const dmgName = path.basename(dmgPath);
  const tempDir = makeTempDir('selene-dmg-recovery-');
  const stagingDmg = path.join(tempDir, 'Selene-staging.dmg');
  const finalDmg = path.join(tempDir, dmgName);
  const mountPath = path.join(tempDir, 'mnt');

  detachImageIfMounted(dmgPath);
  const appSizeKb = Number(run('du', ['-sk', appPath], { capture: true }).trim().split(/\s+/)[0]);
  const imageSizeMb = Math.ceil((appSizeKb * 1.2) / 1024) + 256;

  try {
    run('hdiutil', [
      'create',
      '-type',
      'UDIF',
      '-volname',
      volumeName,
      '-fs',
      'HFS+',
      '-size',
      `${imageSizeMb}m`,
      stagingDmg,
    ]);

    fs.mkdirSync(mountPath, { recursive: true });
    ensureMountedStaging(stagingDmg, mountPath);

    const mountedAppPath = path.join(mountPath, appName);
    run('ditto', [appPath, mountedAppPath]);

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

    detachIfMounted(mountPath);
    detachImageIfMounted(stagingDmg);

    run('hdiutil', ['convert', stagingDmg, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', finalDmg]);
    fs.copyFileSync(finalDmg, dmgPath);
  } finally {
    detachIfMounted(mountPath);
    detachImageIfMounted(stagingDmg);
    removeDirWithRetry(tempDir);
  }
}

function updateLatestMacYaml(dmgPath) {
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

function recoverDmg(dmgPath) {
  if (dmgContainsApp(dmgPath)) {
    if (forceMetadataRefresh) {
      const staleBlockmapPath = `${dmgPath}.blockmap`;
      if (exists(staleBlockmapPath)) {
        fs.rmSync(staleBlockmapPath, { force: true });
      }
      updateLatestMacYaml(dmgPath);
      console.log(`DMG looks healthy; metadata refreshed for ${path.basename(dmgPath)}.`);
      return;
    }

    console.log(`DMG looks healthy; no recovery needed for ${path.basename(dmgPath)}.`);
    return;
  }

  const appPath = resolveAppPathForDmg(dmgPath);
  if (!appPath) {
    throw new Error(`Could not find packaged ${appName} for ${path.basename(dmgPath)}`);
  }

  console.warn(`Generated DMG is missing ${appName}. Rebuilding ${path.basename(dmgPath)} from ${path.relative(rootDir, appPath)}...`);
  createRecoveryDmg(dmgPath, appPath);

  const staleBlockmapPath = `${dmgPath}.blockmap`;
  if (exists(staleBlockmapPath)) {
    fs.rmSync(staleBlockmapPath, { force: true });
  }

  if (!dmgContainsApp(dmgPath)) {
    throw new Error('Recovered DMG is still missing Selene.app');
  }

  updateLatestMacYaml(dmgPath);
  console.log(`Recovered DMG at ${dmgPath}`);
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('Skipping DMG recovery: macOS only.');
    return;
  }

  const dmgPaths = listMacDmgs();
  if (dmgPaths.length === 0) {
    console.log(`Skipping DMG recovery: no macOS DMGs found for version ${version}.`);
    return;
  }

  for (const dmgPath of dmgPaths) {
    recoverDmg(dmgPath);
  }
}

main();
