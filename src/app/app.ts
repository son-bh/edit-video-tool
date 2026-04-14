import path from 'node:path';

import express, { type Express } from 'express';

import type { AppContext, CreateAppOptions } from './context';
import { createUpload } from './config/uploads';
import { createErrorHandler } from './middleware/error-handler';
import { createAuthMiddleware } from './middleware/auth';
import { createAuthConfig, createAuthManager } from './services/auth';
import { createJobRunner } from './services/jobs/job-runner';
import { createJobStore } from './services/jobs/job-store';
import { ensureWorkspaceRoot, getStagingDir } from './services/workspace';
import { createAuthRoutes } from './routes/auth';
import { createDownloadRoutes } from './routes/downloads';
import { createHealthRoutes } from './routes/health';
import { createJobRoutes } from './routes/jobs';
import { createPageRoutes } from './routes/pages';

function createAppContext(options: CreateAppOptions = {}): AppContext {
  const workspaceRoot = ensureWorkspaceRoot(options.workspaceRoot);
  const jobStore = options.jobStore || createJobStore();
  const jobRunner = options.jobRunner || createJobRunner(jobStore);
  const authManager = options.authManager || createAuthManager(createAuthConfig(options.auth));
  const stagingDir = getStagingDir(workspaceRoot);
  const repoRoot = path.resolve(__dirname, '..', '..');
  const upload = createUpload(stagingDir);

  return {
    workspaceRoot,
    repoRoot,
    jobStore,
    jobRunner,
    authManager,
    upload
  };
}

export function createApp(options: CreateAppOptions = {}): Express {
  const context = createAppContext(options);
  const authMiddleware = createAuthMiddleware(context.authManager);
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(context.repoRoot, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(authMiddleware.attachSession);
  app.use('/static', express.static(path.join(context.repoRoot, 'public')));

  app.use(createAuthRoutes(context, authMiddleware));
  app.use(createPageRoutes(context, authMiddleware));
  app.use(createHealthRoutes());
  app.use(createJobRoutes(context, authMiddleware));
  app.use(createDownloadRoutes(context, authMiddleware));
  app.use(createErrorHandler());

  return app;
}
