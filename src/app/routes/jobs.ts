import { Router } from 'express';

import type { AppContext } from '../context';
import { createJobsController } from '../controllers/jobs-controller';
import { createSubtitleJobsController } from '../controllers/subtitle-jobs-controller';
import { createVideoJobsController } from '../controllers/video-jobs-controller';
import type { AuthMiddleware } from '../middleware/auth';

export function createJobRoutes(
  context: Pick<AppContext, 'workspaceRoot' | 'jobStore' | 'jobRunner' | 'upload'>,
  authMiddleware: Pick<AuthMiddleware, 'requireApiAuth'>
): Router {
  const router = Router();
  const subtitleController = createSubtitleJobsController(context);
  const videoController = createVideoJobsController(context);
  const jobsController = createJobsController(context);

  router.post('/api/jobs/subtitles', authMiddleware.requireApiAuth, context.upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'scriptJson', maxCount: 1 },
    { name: 'transcriptSrt', maxCount: 1 }
  ]), subtitleController.createJob);

  router.post('/api/jobs/:jobId/videos', authMiddleware.requireApiAuth, context.upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'videos', maxCount: 100 }
  ]), videoController.createForExistingSubtitleJob);

  router.post('/api/jobs/videos', authMiddleware.requireApiAuth, context.upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'scriptSrt', maxCount: 1 },
    { name: 'videos', maxCount: 100 }
  ]), videoController.createStandaloneVideoJob);

  router.get('/api/jobs/:jobId', authMiddleware.requireApiAuth, jobsController.getJob);

  return router;
}
