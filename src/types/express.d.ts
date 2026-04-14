import type { AuthSession } from '../app/types';

declare global {
  namespace Express {
    interface Request {
      auth: AuthSession | null;
    }
  }
}

export {};
