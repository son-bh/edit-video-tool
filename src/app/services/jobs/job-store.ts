import { randomUUID } from 'node:crypto';

import type { JobOutputs, JobPhase, JobRecord, JobSeed } from '../../types';

export interface JobStore {
  create(seed?: JobSeed): JobRecord;
  get(jobId: string): JobRecord | null;
  getOwned(jobId: string, ownerKey?: string | null): JobRecord | null;
  update(jobId: string, patch: Partial<JobRecord>): JobRecord;
  updateOutputs(jobId: string, outputs: JobOutputs): JobRecord;
  markRunning(jobId: string, patch?: Partial<JobRecord>): JobRecord;
  markCompleted(jobId: string, phase: Exclude<JobPhase, null>, outputs?: JobOutputs, patch?: Partial<JobRecord>): JobRecord;
  markFailed(jobId: string, error: string, patch?: Partial<JobRecord>): JobRecord;
  list(): JobRecord[];
}

export function createJobStore(): JobStore {
  const jobs = new Map<string, JobRecord>();

  function requireJob(jobId: string): JobRecord {
    const job = jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }

    return job;
  }

  return {
    create(seed: JobSeed = {}): JobRecord {
      const now = new Date().toISOString();
      const job: JobRecord = {
        id: seed.id || randomUUID(),
        folderName: seed.folderName || null,
        ownerUsername: seed.ownerUsername || null,
        ownerKey: seed.ownerKey || null,
        aspectRatio: seed.aspectRatio,
        renderLabel: seed.renderLabel,
        phase: seed.phase || null,
        status: seed.status || 'created',
        stage: seed.stage || 'idle',
        percent: seed.percent || 0,
        message: seed.message || '',
        error: null,
        createdAt: now,
        updatedAt: now,
        workspace: seed.workspace || null,
        files: seed.files || {},
        outputs: seed.outputs || {},
        completedPhases: {
          subtitle: false,
          video: false,
          ...seed.completedPhases
        }
      };

      jobs.set(job.id, job);
      return job;
    },
    get(jobId: string): JobRecord | null {
      return jobs.get(jobId) || null;
    },
    getOwned(jobId: string, ownerKey?: string | null): JobRecord | null {
      const job = jobs.get(jobId) || null;

      if (!job || job.ownerKey !== ownerKey) {
        return null;
      }

      return job;
    },
    update(jobId: string, patch: Partial<JobRecord>): JobRecord {
      const job = requireJob(jobId);
      Object.assign(job, patch, { updatedAt: new Date().toISOString() });
      return job;
    },
    updateOutputs(jobId: string, outputs: JobOutputs): JobRecord {
      const job = requireJob(jobId);
      job.outputs = { ...job.outputs, ...outputs };
      job.updatedAt = new Date().toISOString();
      return job;
    },
    markRunning(jobId: string, patch: Partial<JobRecord> = {}): JobRecord {
      const job = requireJob(jobId);
      Object.assign(job, patch, {
        status: 'running',
        error: null,
        updatedAt: new Date().toISOString()
      });
      return job;
    },
    markCompleted(jobId: string, phase: Exclude<JobPhase, null>, outputs: JobOutputs = {}, patch: Partial<JobRecord> = {}): JobRecord {
      const job = requireJob(jobId);
      Object.assign(job, patch, {
        status: 'completed',
        percent: 100,
        stage: 'completed',
        updatedAt: new Date().toISOString()
      });
      job.outputs = { ...job.outputs, ...outputs };
      job.completedPhases[phase] = true;
      return job;
    },
    markFailed(jobId: string, error: string, patch: Partial<JobRecord> = {}): JobRecord {
      const job = requireJob(jobId);
      Object.assign(job, patch, {
        status: 'failed',
        error,
        updatedAt: new Date().toISOString()
      });
      return job;
    },
    list(): JobRecord[] {
      return Array.from(jobs.values());
    }
  };
}
