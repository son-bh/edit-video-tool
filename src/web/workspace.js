const fs = require('node:fs');
const path = require('node:path');

function formatJobFolderTimestamp(input) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function buildJobFolderName(jobId, createdAt) {
  return `${formatJobFolderTimestamp(createdAt)}-${jobId}`;
}

function getWorkspaceRoot(customRoot) {
  return path.resolve(customRoot || process.env.WEB_UI_WORKSPACE_ROOT || path.join(process.cwd(), '.tmp-web-ui'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function ensureWorkspaceRoot(customRoot) {
  const root = getWorkspaceRoot(customRoot);
  ensureDir(root);
  ensureDir(path.join(root, 'jobs'));
  ensureDir(path.join(root, 'staging'));
  return root;
}

function createJobWorkspace(jobId, customRoot, options = {}) {
  const root = ensureWorkspaceRoot(customRoot);
  const folderName = options.folderName || buildJobFolderName(jobId, options.createdAt);
  const jobRoot = ensureDir(path.join(root, 'jobs', folderName));
  const inputs = ensureDir(path.join(jobRoot, 'inputs'));
  const videos = ensureDir(path.join(jobRoot, 'videos'));
  const outputs = ensureDir(path.join(jobRoot, 'outputs'));
  const segments = ensureDir(path.join(outputs, 'segments'));

  return {
    folderName,
    root: jobRoot,
    inputs,
    videos,
    outputs,
    segments
  };
}

function getStagingDir(customRoot) {
  return ensureDir(path.join(ensureWorkspaceRoot(customRoot), 'staging'));
}

module.exports = {
  buildJobFolderName,
  createJobWorkspace,
  ensureWorkspaceRoot,
  formatJobFolderTimestamp,
  getStagingDir,
  getWorkspaceRoot
};
