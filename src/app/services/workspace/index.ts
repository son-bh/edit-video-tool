import fs from 'node:fs';
import path from 'node:path';

import { slugifyUsername } from '../auth';
import type { WorkspacePaths } from '../../types';

export function formatJobFolderTimestamp(input?: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function buildJobFolderName(jobId: string, createdAt?: Date | string | number): string {
  return `${formatJobFolderTimestamp(createdAt)}-${jobId}`;
}

export function getWorkspaceRoot(customRoot?: string): string {
  return path.resolve(customRoot || process.env.WEB_UI_WORKSPACE_ROOT || path.join(process.cwd(), '.tmp-web-ui'));
}

function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function ensureWorkspaceRoot(customRoot?: string): string {
  const root = getWorkspaceRoot(customRoot);
  ensureDir(root);
  return root;
}

function ensureScopedWorkspaceRoot(root: string): string {
  ensureDir(root);
  ensureDir(path.join(root, 'jobs'));
  ensureDir(path.join(root, 'staging'));
  return root;
}

export function getUserWorkspaceRoot(customRoot: string | undefined, username: string): string {
  const baseRoot = ensureWorkspaceRoot(customRoot);
  const userKey = slugifyUsername(username);

  if (!userKey) {
    throw new Error('username is required to resolve a user workspace root.');
  }

  return ensureScopedWorkspaceRoot(path.join(baseRoot, userKey));
}

export interface CreateWorkspaceOptions {
  username?: string;
  folderName?: string;
  createdAt?: Date | string | number;
}

export function createJobWorkspace(jobId: string, customRoot?: string, options: CreateWorkspaceOptions = {}): WorkspacePaths {
  const root = options.username
    ? getUserWorkspaceRoot(customRoot, options.username)
    : ensureScopedWorkspaceRoot(ensureWorkspaceRoot(customRoot));
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

export function getStagingDir(customRoot?: string, username?: string): string {
  const root = username
    ? getUserWorkspaceRoot(customRoot, username)
    : ensureScopedWorkspaceRoot(ensureWorkspaceRoot(customRoot));
  return ensureDir(path.join(root, 'staging'));
}
