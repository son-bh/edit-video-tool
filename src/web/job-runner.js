const path = require('node:path');
const { fork } = require('node:child_process');

function startWorker(jobType, payload, jobStore, jobId) {
  const workerPath = path.join(__dirname, 'media-worker.js');
  const child = fork(workerPath, {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });

  child.on('message', (message) => {
    if (!message) {
      return;
    }

    if (message.type === 'progress') {
      jobStore.markRunning(jobId, {
        phase: jobType,
        stage: message.stage,
        percent: message.percent,
        message: message.message
      });
      return;
    }

    if (message.type === 'log') {
      const job = jobStore.get(jobId);
      if (job) {
        jobStore.update(jobId, {
          message: message.message,
          stage: job.stage,
          percent: job.percent
        });
      }
      return;
    }

    if (message.type === 'completed') {
      jobStore.markCompleted(jobId, jobType, message.outputs, {
        phase: jobType,
        message: jobType === 'subtitle' ? 'Subtitle generation complete' : 'Video generation complete'
      });
      return;
    }

    if (message.type === 'failed') {
      jobStore.markFailed(jobId, message.error, {
        phase: jobType,
        stage: 'failed',
        message: message.error
      });
    }
  });

  child.on('exit', (code) => {
    const job = jobStore.get(jobId);

    if (!job || job.status === 'completed' || job.status === 'failed') {
      return;
    }

    if (code !== 0) {
      jobStore.markFailed(jobId, `Worker exited with code ${code}`, {
        phase: jobType,
        stage: 'failed',
        message: `Worker exited with code ${code}`
      });
    }
  });

  child.send({
    type: 'start',
    jobType,
    payload
  });

  return child;
}

function createJobRunner(jobStore) {
  return {
    startSubtitleJob(job, payload) {
      return startWorker('subtitle', payload, jobStore, job.id);
    },
    startVideoJob(job, payload) {
      return startWorker('video', payload, jobStore, job.id);
    }
  };
}

module.exports = {
  createJobRunner
};
