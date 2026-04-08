const fs = require('node:fs');
const path = require('node:path');

const express = require('express');
const multer = require('multer');

const { SUPPORTED_VIDEO_EXTENSIONS } = require('../video-segment-generation');
const { createJobRunner } = require('./job-runner');
const { createJobStore } = require('./job-store');
const { createJobWorkspace, ensureWorkspaceRoot, getStagingDir } = require('./workspace');

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.mp4',
  '.mov',
  '.mkv'
]);

function moveFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.renameSync(sourcePath, targetPath);
  return targetPath;
}

function unlinkIfPresent(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

function serializeJob(job) {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    folderName: job.folderName,
    phase: job.phase,
    status: job.status,
    stage: job.stage,
    percent: job.percent,
    message: job.message,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedPhases: job.completedPhases,
    outputs: {
      hasTranscriptSrt: Boolean(job.outputs.transcriptSrt),
      hasScriptSrt: Boolean(job.outputs.scriptSrt),
      hasSegmentZip: Boolean(job.outputs.segmentZip),
      hasFinalVideo: Boolean(job.outputs.finalVideo)
    }
  };
}

function createApp(options = {}) {
  const workspaceRoot = ensureWorkspaceRoot(options.workspaceRoot);
  const jobStore = options.jobStore || createJobStore();
  const jobRunner = options.jobRunner || createJobRunner(jobStore);
  const stagingDir = getStagingDir(workspaceRoot);
  const repoRoot = path.resolve(__dirname, '..', '..');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(repoRoot, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use('/static', express.static(path.join(repoRoot, 'public')));

  const upload = multer({
    dest: stagingDir
  });

  app.get('/', (request, response) => {
    response.render('index', {
      title: 'Media Workflow UI'
    });
  });

  app.get('/health', (request, response) => {
    response.json({ ok: true });
  });

  app.post('/api/jobs/subtitles', upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'scriptJson', maxCount: 1 },
    { name: 'transcriptSrt', maxCount: 1 }
  ]), (request, response) => {
    const audioFile = request.files?.audio?.[0];
    const scriptFile = request.files?.scriptJson?.[0];
    const transcriptFile = request.files?.transcriptSrt?.[0];

    if (!scriptFile || (!audioFile && !transcriptFile)) {
      unlinkIfPresent(audioFile?.path);
      unlinkIfPresent(scriptFile?.path);
      unlinkIfPresent(transcriptFile?.path);
      response.status(400).json({ error: 'scriptJson and either audio or transcriptSrt are required.' });
      return;
    }

    if (audioFile && !SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(audioFile.originalname).toLowerCase())) {
      unlinkIfPresent(audioFile.path);
      unlinkIfPresent(scriptFile.path);
      unlinkIfPresent(transcriptFile?.path);
      response.status(400).json({ error: 'Unsupported audio or video file type.' });
      return;
    }

    if (path.extname(scriptFile.originalname).toLowerCase() !== '.json') {
      unlinkIfPresent(audioFile.path);
      unlinkIfPresent(scriptFile.path);
      unlinkIfPresent(transcriptFile?.path);
      response.status(400).json({ error: 'scriptJson must be a .json file.' });
      return;
    }

    if (transcriptFile && path.extname(transcriptFile.originalname).toLowerCase() !== '.srt') {
      unlinkIfPresent(audioFile?.path);
      unlinkIfPresent(scriptFile.path);
      unlinkIfPresent(transcriptFile.path);
      response.status(400).json({ error: 'transcriptSrt must be an .srt file.' });
      return;
    }

    const job = jobStore.create();
    const workspace = createJobWorkspace(job.id, workspaceRoot, {
      createdAt: job.createdAt
    });
    jobStore.update(job.id, {
      folderName: workspace.folderName
    });
    const audioPath = audioFile
      ? moveFile(audioFile.path, path.join(workspace.inputs, `audio${path.extname(audioFile.originalname).toLowerCase()}`))
      : null;
    const jsonPath = moveFile(scriptFile.path, path.join(workspace.inputs, 'script.json'));
    const transcriptPath = transcriptFile
      ? moveFile(transcriptFile.path, path.join(workspace.inputs, 'script.whisper.srt'))
      : null;

    jobStore.markRunning(job.id, {
      phase: 'subtitle',
      stage: 'queued',
      percent: 1,
      message: transcriptPath ? 'Subtitle mapping queued' : 'Subtitle generation queued',
      workspace,
      files: {
        audioPath,
        jsonPath,
        transcriptPath
      }
    });

    jobRunner.startSubtitleJob(job, {
      workspace,
      audioPath,
      jsonPath,
      transcriptPath,
      ffmpegPath: process.env.FFMPEG_PATH,
      whisperCommandPath: process.env.WHISPER_COMMAND_PATH,
      whisperModel: process.env.WHISPER_MODEL || undefined,
      whisperModelPath: process.env.WHISPER_MODEL_PATH,
      language: process.env.WHISPER_LANGUAGE || 'auto'
    });

    response.status(202).json({
      job: serializeJob(jobStore.get(job.id))
    });
  });

  app.post('/api/jobs/:jobId/videos', upload.array('videos', 100), (request, response) => {
    const job = jobStore.get(request.params.jobId);

    if (!job) {
      request.files?.forEach((file) => unlinkIfPresent(file.path));
      response.status(404).json({ error: 'Job not found.' });
      return;
    }

    if (!job.completedPhases.subtitle || !job.outputs.scriptSrt) {
      request.files?.forEach((file) => unlinkIfPresent(file.path));
      response.status(400).json({ error: 'Subtitle generation must complete successfully before video generation.' });
      return;
    }

    const files = request.files || [];
    if (files.length === 0) {
      response.status(400).json({ error: 'At least one video file is required.' });
      return;
    }

    const invalidFile = files.find((file) => !SUPPORTED_VIDEO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase()));
    if (invalidFile) {
      files.forEach((file) => unlinkIfPresent(file.path));
      response.status(400).json({ error: 'All uploaded files must be supported video types.' });
      return;
    }

    files.forEach((file, index) => {
      const extension = path.extname(file.originalname).toLowerCase();
      moveFile(file.path, path.join(job.workspace.videos, `video-${String(index + 1).padStart(3, '0')}${extension}`));
    });

    jobStore.markRunning(job.id, {
      phase: 'video',
      stage: 'queued',
      percent: 45,
      message: 'Video generation queued'
    });

    jobRunner.startVideoJob(job, {
      workspace: job.workspace,
      videosDir: job.workspace.videos,
      scriptSrtPath: job.outputs.scriptSrt,
      ffmpegPath: process.env.FFMPEG_PATH,
      ffprobePath: process.env.FFPROBE_PATH,
      loopVideos: true,
      durationToleranceSeconds: 0.25
    });

    response.status(202).json({
      job: serializeJob(jobStore.get(job.id))
    });
  });

  app.get('/api/jobs/:jobId', (request, response) => {
    const job = jobStore.get(request.params.jobId);

    if (!job) {
      response.status(404).json({ error: 'Job not found.' });
      return;
    }

    response.json({
      job: serializeJob(job)
    });
  });

  app.get('/download/:jobId/script', (request, response) => {
    const job = jobStore.get(request.params.jobId);

    if (!job || !job.outputs.scriptSrt || !fs.existsSync(job.outputs.scriptSrt)) {
      response.status(404).json({ error: 'script.srt is not available.' });
      return;
    }

    response.download(job.outputs.scriptSrt, 'script.srt');
  });

  app.get('/download/:jobId/transcript', (request, response) => {
    const job = jobStore.get(request.params.jobId);

    if (!job || !job.outputs.transcriptSrt || !fs.existsSync(job.outputs.transcriptSrt)) {
      response.status(404).json({ error: 'script.whisper.srt is not available.' });
      return;
    }

    response.download(job.outputs.transcriptSrt, 'script.whisper.srt');
  });

  app.get('/download/:jobId/segments', (request, response) => {
    const job = jobStore.get(request.params.jobId);

    if (!job || !job.outputs.segmentZip || !fs.existsSync(job.outputs.segmentZip)) {
      response.status(404).json({ error: 'Segment archive is not available.' });
      return;
    }

    response.download(job.outputs.segmentZip, 'segments.zip');
  });

  app.get('/download/:jobId/final-video', (request, response) => {
    const job = jobStore.get(request.params.jobId);

    if (!job || !job.outputs.finalVideo || !fs.existsSync(job.outputs.finalVideo)) {
      response.status(404).json({ error: 'Final video is not available.' });
      return;
    }

    response.download(job.outputs.finalVideo, 'final-video.mp4');
  });

  app.locals.jobStore = jobStore;
  app.locals.workspaceRoot = workspaceRoot;
  return app;
}

module.exports = {
  SUPPORTED_MEDIA_EXTENSIONS,
  createApp,
  serializeJob
};
