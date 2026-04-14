import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

export function createErrorHandler() {
  return (error: unknown, request: Request, response: Response, next: NextFunction): void => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      const message = error.message || 'Upload failed.';

      if (request.path.startsWith('/api/')) {
        response.status(400).json({ error: message });
        return;
      }

      response.status(400).send(message);
      return;
    }

    next(error);
  };
}
