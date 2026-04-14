import type { Request, Response } from 'express';

import type { AppContext } from '../context';
import { getAssetVersion } from '../http/files';

export function createAuthController(context: Pick<AppContext, 'authManager' | 'repoRoot'>) {
  return {
    renderLogin(request: Request, response: Response): void {
      if (request.auth) {
        response.redirect('/');
        return;
      }

      response.render('login', {
        title: 'Media Workflow Login',
        assetVersion: getAssetVersion(context.repoRoot),
        allowedUsernames: context.authManager.config.allowedUsernames,
        error: null,
        selectedUsername: ''
      });
    },
    login(request: Request, response: Response): void {
      const selectedUsername = String(request.body?.username || '').trim();
      const password = String(request.body?.password || '');
      const allowedUser = context.authManager.authenticate(selectedUsername, password);

      if (!allowedUser) {
        response.status(401).render('login', {
          title: 'Media Workflow Login',
          assetVersion: getAssetVersion(context.repoRoot),
          allowedUsernames: context.authManager.config.allowedUsernames,
          error: 'Invalid username or password.',
          selectedUsername
        });
        return;
      }

      const session = context.authManager.createSession(allowedUser);
      context.authManager.setSessionCookie(response, session);
      response.redirect('/');
    },
    logout(request: Request, response: Response): void {
      context.authManager.destroySession(request, response);
      response.redirect('/login');
    }
  };
}
