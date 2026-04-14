import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AuthManager } from '../services/auth';

export interface AuthMiddleware {
  attachSession: RequestHandler;
  requireApiAuth: RequestHandler;
  requirePageAuth: RequestHandler;
}

export function createAuthMiddleware(authManager: AuthManager): AuthMiddleware {
  return {
    attachSession(request: Request, response: Response, next: NextFunction): void {
      authManager.attachSession(request, response, next);
    },
    requireApiAuth(request: Request, response: Response, next: NextFunction): void {
      authManager.requireApiAuth(request, response, next);
    },
    requirePageAuth(request: Request, response: Response, next: NextFunction): void {
      authManager.requirePageAuth(request, response, next);
    }
  };
}
