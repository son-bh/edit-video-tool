const fs = require('node:fs');
const path = require('node:path');

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

function createJobWorkspace(jobId, customRoot) {
  const root = ensureWorkspaceRoot(customRoot);
  const jobRoot = ensureDir(path.join(root, 'jobs', jobId));
  const inputs = ensureDir(path.join(jobRoot, 'inputs'));
  const videos = ensureDir(path.join(jobRoot, 'videos'));
  const outputs = ensureDir(path.join(jobRoot, 'outputs'));
  const segments = ensureDir(path.join(outputs, 'segments'));

  return {
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
  createJobWorkspace,
  ensureWorkspaceRoot,
  getStagingDir,
  getWorkspaceRoot
};
