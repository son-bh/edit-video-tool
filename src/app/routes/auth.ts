import { Router } from 'express';

import type { AppContext } from '../context';
import { createAuthController } from '../controllers/auth-controller';
import type { AuthMiddleware } from '../middleware/auth';

export function createAuthRoutes(
  context: Pick<AppContext, 'authManager' | 'repoRoot'>,
  authMiddleware: Pick<AuthMiddleware, 'requirePageAuth'>
): Router {
  const router = Router();
  const controller = createAuthController(context);

  router.get('/login', controller.renderLogin);
  router.post('/login', controller.login);
  router.post('/logout', authMiddleware.requirePageAuth, controller.logout);

  return router;
}
