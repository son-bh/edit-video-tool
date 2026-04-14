import type { Request, Response } from 'express';

import type { AppContext } from '../context';
import { serializeJob } from '../http/serializers';
import { getOwnedJob } from './job-helpers';

export function createJobsController(context: Pick<AppContext, 'jobStore'>) {
  return {
    getJob(request: Request, response: Response): void {
      const job = getOwnedJob(context.jobStore, request);

      if (!job) {
        response.status(403).json({ error: 'Access denied for this job.' });
        return;
      }

      response.json({
        job: serializeJob(job)
      });
    }
  };
}
