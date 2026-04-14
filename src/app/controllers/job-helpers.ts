import path from 'node:path';
import type { Request } from 'express';

import type { JobRecord } from '../types';
import type { JobStore } from '../services/jobs/job-store';
import { createJobWorkspace } from '../services/workspace';
import { moveFile } from '../http/files';

export function getOwnedJob(jobStore: JobStore, request: Request): JobRecord | null {
  return jobStore.getOwned(String(request.params.jobId), request.auth?.workspaceKey) || null;
}

export function createOwnedJob(jobStore: JobStore, workspaceRoot: string, request: Request): JobRecord {
  const job = jobStore.create({
    ownerUsername: request.auth?.username || null,
    ownerKey: request.auth?.workspaceKey || null
  });
  const workspace = createJobWorkspace(job.id, workspaceRoot, {
    createdAt: job.createdAt,
    username: request.auth?.workspaceKey || undefined
  });

  jobStore.update(job.id, {
    folderName: workspace.folderName,
    workspace
  });

  return jobStore.get(job.id) as JobRecord;
}

export function moveVideoFiles(files: Express.Multer.File[], videosDir: string): void {
  files.forEach((file, index) => {
    const extension = path.extname(file.originalname).toLowerCase();
    moveFile(file.path, path.join(videosDir, `video-${String(index + 1).padStart(3, '0')}${extension}`));
  });
}
