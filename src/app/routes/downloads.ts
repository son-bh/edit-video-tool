import { Router } from 'express';

import type { AppContext } from '../context';
import { createDownloadsController } from '../controllers/downloads-controller';
import type { AuthMiddleware } from '../middleware/auth';

export function createDownloadRoutes(
  context: Pick<AppContext, 'jobStore'>,
  authMiddleware: Pick<AuthMiddleware, 'requirePageAuth'>
): Router {
  const router = Router();
  const controller = createDownloadsController(context);

  router.get('/download/:jobId/script', authMiddleware.requirePageAuth, controller.downloadScript);
  router.get('/download/:jobId/transcript', authMiddleware.requirePageAuth, controller.downloadTranscript);
  router.get('/download/:jobId/segments', authMiddleware.requirePageAuth, controller.downloadSegments);
  router.get('/download/:jobId/final-video', authMiddleware.requirePageAuth, controller.downloadFinalVideo);
  router.get('/download/:jobId/final-video-with-audio', authMiddleware.requirePageAuth, controller.downloadFinalVideoWithAudio);
  router.get(
    '/download/:jobId/final-video-with-audio-subtitles',
    authMiddleware.requirePageAuth,
    controller.downloadFinalVideoWithAudioSubtitles
  );

  return router;
}
