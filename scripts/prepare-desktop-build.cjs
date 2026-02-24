const fs = require("node:fs");
const path = require("node:path");

const rootDir = process.cwd();
const electronCacheDir = path.join(rootDir, ".cache", "electron");
const electronBuilderCacheDir = path.join(rootDir, ".cache", "electron-builder");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.warn(`[prepare:desktop-cache] skip ${filePath}: ${error.message}`);
    return false;
  }
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

ensureDir(electronCacheDir);
ensureDir(electronBuilderCacheDir);

const files = listFiles(electronCacheDir);
const multipartChunks = files.filter((name) => /\.part\d+$/i.test(name));
const transientZipFiles = files.filter((name) => /^\d+\.zip$/i.test(name));

let removed = 0;
for (const fileName of [...multipartChunks, ...transientZipFiles]) {
  const removedNow = safeUnlink(path.join(electronCacheDir, fileName));
  if (removedNow) {
    removed += 1;
  }
}

if (multipartChunks.length > 0) {
  const canonicalElectronZips = listFiles(electronCacheDir).filter((name) =>
    /^electron-v.+-win32-x64\.zip$/i.test(name)
  );

  for (const fileName of canonicalElectronZips) {
    const removedNow = safeUnlink(path.join(electronCacheDir, fileName));
    if (removedNow) {
      removed += 1;
    }
  }
}

console.log(
  `[prepare:desktop-cache] cleaned ${removed} stale file(s) in ${path.relative(
    rootDir,
    electronCacheDir
  )}`
);
