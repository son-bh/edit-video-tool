import type { Multer } from 'multer';

import type { AuthConfigOptions, AuthManager } from './services/auth';
import type { JobRunner } from './services/jobs/job-runner';
import type { JobStore } from './services/jobs/job-store';

export interface CreateAppOptions {
  workspaceRoot?: string;
  jobStore?: JobStore;
  jobRunner?: JobRunner;
  authManager?: AuthManager;
  auth?: AuthConfigOptions;
}

export interface AppContext {
  workspaceRoot: string;
  repoRoot: string;
  jobStore: JobStore;
  jobRunner: JobRunner;
  authManager: AuthManager;
  upload: Multer;
}
