const { randomUUID } = require('node:crypto');

function createJobStore() {
  const jobs = new Map();

  function requireJob(jobId) {
    const job = jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }

    return job;
  }

  return {
    create(seed = {}) {
      const now = new Date().toISOString();
      const job = {
        id: seed.id || randomUUID(),
        folderName: seed.folderName || null,
        ownerUsername: seed.ownerUsername || null,
        ownerKey: seed.ownerKey || null,
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
          video: false
        }
      };

      jobs.set(job.id, job);
      return job;
    },
    get(jobId) {
      return jobs.get(jobId) || null;
    },
    getOwned(jobId, ownerKey) {
      const job = jobs.get(jobId) || null;

      if (!job || job.ownerKey !== ownerKey) {
        return null;
      }

      return job;
    },
    update(jobId, patch) {
      const job = requireJob(jobId);
      Object.assign(job, patch, { updatedAt: new Date().toISOString() });
      return job;
    },
    updateOutputs(jobId, outputs) {
      const job = requireJob(jobId);
      job.outputs = { ...job.outputs, ...outputs };
      job.updatedAt = new Date().toISOString();
      return job;
    },
    markRunning(jobId, patch = {}) {
      const job = requireJob(jobId);
      Object.assign(job, patch, {
        status: 'running',
        error: null,
        updatedAt: new Date().toISOString()
      });
      return job;
    },
    markCompleted(jobId, phase, outputs = {}, patch = {}) {
      const job = requireJob(jobId);
      Object.assign(job, patch, {
        status: 'completed',
        percent: 100,
        stage: 'completed',
        updatedAt: new Date().toISOString()
      });
      job.outputs = { ...job.outputs, ...outputs };
      if (phase) {
        job.completedPhases[phase] = true;
      }
      return job;
    },
    markFailed(jobId, error, patch = {}) {
      const job = requireJob(jobId);
      Object.assign(job, patch, {
        status: 'failed',
        error,
        updatedAt: new Date().toISOString()
      });
      return job;
    },
    list() {
      return Array.from(jobs.values());
    }
  };
}

module.exports = {
  createJobStore
};
