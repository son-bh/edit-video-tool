import { Router } from 'express';

import type { AppContext } from '../context';
import { createPageController } from '../controllers/page-controller';
import type { AuthMiddleware } from '../middleware/auth';

export function createPageRoutes(
  context: Pick<AppContext, 'repoRoot'>,
  authMiddleware: Pick<AuthMiddleware, 'requirePageAuth'>
): Router {
  const router = Router();
  const controller = createPageController(context);

  router.get('/', authMiddleware.requirePageAuth, controller.renderHome);
  router.get('/download/script-json-example', authMiddleware.requirePageAuth, controller.downloadScriptJsonExample);

  return router;
}
