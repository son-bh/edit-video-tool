const fs = require('node:fs');
const path = require('node:path');

const express = require('express');
const multer = require('multer');

const { SUPPORTED_VIDEO_EXTENSIONS } = require('../video-segment-generation');
const { createAuthConfig, createAuthManager } = require('./auth');
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
const SUPPORTED_WHISPER_LANGUAGES = new Set(['auto', 'en', 'vi']);
const SCRIPT_JSON_EXAMPLE = JSON.stringify([
  { text: 'First subtitle text.' },
  { text: 'Second subtitle text.' }
], null, 2);

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

function getAssetVersion(repoRoot) {
  return String(fs.statSync(path.join(repoRoot, 'public', 'app.js')).mtimeMs);
}

function getOwnedJob(jobStore, request) {
  return jobStore.getOwned(request.params.jobId, request.auth?.workspaceKey) || null;
}

function createVideoJob(jobStore, workspaceRoot, auth) {
  const job = jobStore.create({
    ownerUsername: auth.username,
    ownerKey: auth.workspaceKey
  });
  const workspace = createJobWorkspace(job.id, workspaceRoot, {
    createdAt: job.createdAt,
    username: auth.workspaceKey
  });
  jobStore.update(job.id, {
    folderName: workspace.folderName,
    workspace
  });
  return jobStore.get(job.id);
}

function moveVideoFiles(files, videosDir) {
  files.forEach((file, index) => {
    const extension = path.extname(file.originalname).toLowerCase();
    moveFile(file.path, path.join(videosDir, `video-${String(index + 1).padStart(3, '0')}${extension}`));
  });
}

function serializeJob(job) {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    folderName: job.folderName,
    ownerUsername: job.ownerUsername,
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
      hasFinalVideo: Boolean(job.outputs.finalVideo),
      hasFinalVideoWithAudio: Boolean(job.outputs.finalVideoWithAudio),
      hasFinalVideoWithAudioSubtitles: Boolean(job.outputs.finalVideoWithAudioSubtitles)
    }
  };
}

function createApp(options = {}) {
  const workspaceRoot = ensureWorkspaceRoot(options.workspaceRoot);
  const jobStore = options.jobStore || createJobStore();
  const jobRunner = options.jobRunner || createJobRunner(jobStore);
  const authManager = options.authManager || createAuthManager(createAuthConfig(options.auth));
  const stagingDir = getStagingDir(workspaceRoot);
  const repoRoot = path.resolve(__dirname, '..', '..');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(repoRoot, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(authManager.attachSession);
  app.use('/static', express.static(path.join(repoRoot, 'public')));

  const upload = multer({
    dest: stagingDir
  });

  app.get('/login', (request, response) => {
    if (request.auth) {
      response.redirect('/');
      return;
    }

    response.render('login', {
      title: 'Media Workflow Login',
      assetVersion: getAssetVersion(repoRoot),
      allowedUsernames: authManager.config.allowedUsernames,
      error: null,
      selectedUsername: ''
    });
  });

  app.post('/login', (request, response) => {
    const selectedUsername = String(request.body?.username || '').trim();
    const password = String(request.body?.password || '');
    const allowedUser = authManager.authenticate(selectedUsername, password);

    if (!allowedUser) {
      response.status(401).render('login', {
        title: 'Media Workflow Login',
        assetVersion: getAssetVersion(repoRoot),
        allowedUsernames: authManager.config.allowedUsernames,
        error: 'Invalid username or password.',
        selectedUsername
      });
      return;
    }

    const session = authManager.createSession(allowedUser);
    authManager.setSessionCookie(response, session);
    response.redirect('/');
  });

  app.post('/logout', authManager.requirePageAuth, (request, response) => {
    authManager.destroySession(request, response);
    response.redirect('/login');
  });

  app.get('/', authManager.requirePageAuth, (request, response) => {
    const assetVersion = getAssetVersion(repoRoot);
    response.render('index', {
      title: 'Media Workflow UI',
      assetVersion,
      currentUser: request.auth.username
    });
  });

  app.get('/health', (request, response) => {
    response.json({ ok: true });
  });

  app.get('/download/script-json-example', authManager.requirePageAuth, (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="script.example.json"');
    response.send(SCRIPT_JSON_EXAMPLE + '\n');
  });

  app.post('/api/jobs/subtitles', authManager.requireApiAuth, upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'scriptJson', maxCount: 1 },
    { name: 'transcriptSrt', maxCount: 1 }
  ]), (request, response) => {
    const audioFile = request.files?.audio?.[0];
    const scriptFile = request.files?.scriptJson?.[0];
    const transcriptFile = request.files?.transcriptSrt?.[0];
    const requestedLanguage = String(request.body?.language || '').trim().toLowerCase() || process.env.WHISPER_LANGUAGE || 'auto';

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

    const scriptExtension = path.extname(scriptFile.originalname).toLowerCase();
    if (!['.json', '.txt'].includes(scriptExtension)) {
      unlinkIfPresent(audioFile?.path);
      unlinkIfPresent(scriptFile.path);
      unlinkIfPresent(transcriptFile?.path);
      response.status(400).json({ error: 'scriptJson must be a .json or .txt file.' });
      return;
    }

    if (transcriptFile && path.extname(transcriptFile.originalname).toLowerCase() !== '.srt') {
      unlinkIfPresent(audioFile?.path);
      unlinkIfPresent(scriptFile.path);
      unlinkIfPresent(transcriptFile.path);
      response.status(400).json({ error: 'transcriptSrt must be an .srt file.' });
      return;
    }

    if (!SUPPORTED_WHISPER_LANGUAGES.has(requestedLanguage)) {
      unlinkIfPresent(audioFile?.path);
      unlinkIfPresent(scriptFile?.path);
      unlinkIfPresent(transcriptFile?.path);
      response.status(400).json({ error: 'language must be one of: auto, en, vi.' });
      return;
    }

    const job = jobStore.create({
      ownerUsername: request.auth.username,
      ownerKey: request.auth.workspaceKey
    });
    const workspace = createJobWorkspace(job.id, workspaceRoot, {
      createdAt: job.createdAt,
      username: request.auth.workspaceKey
    });
    jobStore.update(job.id, {
      folderName: workspace.folderName
    });
    const audioPath = audioFile
      ? moveFile(audioFile.path, path.join(workspace.inputs, `audio${path.extname(audioFile.originalname).toLowerCase()}`))
      : null;
    const jsonPath = moveFile(scriptFile.path, path.join(workspace.inputs, `script${scriptExtension}`));
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
      language: requestedLanguage
    });

    response.status(202).json({
      job: serializeJob(jobStore.get(job.id))
    });
  });

  app.post('/api/jobs/:jobId/videos', authManager.requireApiAuth, upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'videos', maxCount: 100 }
  ]), (request, response) => {
    const job = getOwnedJob(jobStore, request);
    const audioFile = request.files?.audio?.[0];
    const files = request.files?.videos || [];

    if (!job) {
      unlinkIfPresent(audioFile?.path);
      files.forEach((file) => unlinkIfPresent(file.path));
      response.status(404).json({ error: 'Job not found.' });
      return;
    }

    if (!job.completedPhases.subtitle || !job.outputs.scriptSrt) {
      unlinkIfPresent(audioFile?.path);
      files.forEach((file) => unlinkIfPresent(file.path));
      response.status(400).json({ error: 'Subtitle generation must complete successfully before video generation.' });
      return;
    }

    if (files.length === 0) {
      unlinkIfPresent(audioFile?.path);
      response.status(400).json({ error: 'At least one video file is required.' });
      return;
    }

    if (audioFile && !SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(audioFile.originalname).toLowerCase())) {
      unlinkIfPresent(audioFile.path);
      files.forEach((file) => unlinkIfPresent(file.path));
      response.status(400).json({ error: 'Unsupported audio or video file type for audio upload.' });
      return;
    }

    const invalidFile = files.find((file) => !SUPPORTED_VIDEO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase()));
    if (invalidFile) {
      unlinkIfPresent(audioFile?.path);
      files.forEach((file) => unlinkIfPresent(file.path));
      response.status(400).json({ error: 'All uploaded files must be supported video types.' });
      return;
    }

    const audioPath = audioFile
      ? moveFile(audioFile.path, path.join(job.workspace.inputs, `audio-for-video${path.extname(audioFile.originalname).toLowerCase()}`))
      : job.files.audioPath;
    moveVideoFiles(files, job.workspace.videos);

    jobStore.markRunning(job.id, {
      phase: 'video',
      stage: 'queued',
      percent: 45,
      message: 'Video generation queued',
      files: {
        ...job.files,
        audioPath
      }
    });

    jobRunner.startVideoJob(job, {
      workspace: job.workspace,
      videosDir: job.workspace.videos,
      scriptSrtPath: job.outputs.scriptSrt,
      audioPath,
      ffmpegPath: process.env.FFMPEG_PATH,
      ffprobePath: process.env.FFPROBE_PATH,
      loopVideos: true,
      durationToleranceSeconds: 0.25
    });

    response.status(202).json({
      job: serializeJob(jobStore.get(job.id))
    });
  });

  app.post('/api/jobs/videos', authManager.requireApiAuth, upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'scriptSrt', maxCount: 1 },
    { name: 'videos', maxCount: 100 }
  ]), (request, response) => {
    const audioFile = request.files?.audio?.[0];
    const scriptSrtFile = request.files?.scriptSrt?.[0];
    const files = request.files?.videos || [];

    if (!scriptSrtFile) {
      unlinkIfPresent(audioFile?.path);
      files.forEach((file) => unlinkIfPresent(file.path));
      response.status(400).json({ error: 'scriptSrt is required when starting video generation without an existing subtitle job.' });
      return;
    }

    if (path.extname(scriptSrtFile.originalname).toLowerCase() !== '.srt') {
      unlinkIfPresent(audioFile?.path);
      unlinkIfPresent(scriptSrtFile.path);
      files.forEach((file) => unlinkIfPresent(file.path));
      response.status(400).json({ error: 'scriptSrt must be an .srt file.' });
      return;
    }

    if (files.length === 0) {
      unlinkIfPresent(audioFile?.path);
      unlinkIfPresent(scriptSrtFile.path);
      response.status(400).json({ error: 'At least one video file is required.' });
      return;
    }

    if (audioFile && !SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(audioFile.originalname).toLowerCase())) {
      unlinkIfPresent(audioFile.path);
      unlinkIfPresent(scriptSrtFile.path);
      files.forEach((file) => unlinkIfPresent(file.path));
      response.status(400).json({ error: 'Unsupported audio or video file type for audio upload.' });
      return;
    }

    const invalidFile = files.find((file) => !SUPPORTED_VIDEO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase()));
    if (invalidFile) {
      unlinkIfPresent(audioFile?.path);
      unlinkIfPresent(scriptSrtFile.path);
      files.forEach((file) => unlinkIfPresent(file.path));
      response.status(400).json({ error: 'All uploaded files must be supported video types.' });
      return;
    }

    const job = createVideoJob(jobStore, workspaceRoot, request.auth);
    const audioPath = audioFile
      ? moveFile(audioFile.path, path.join(job.workspace.inputs, `audio-for-video${path.extname(audioFile.originalname).toLowerCase()}`))
      : null;
    const scriptSrtPath = moveFile(scriptSrtFile.path, path.join(job.workspace.inputs, 'script.srt'));
    moveVideoFiles(files, job.workspace.videos);

    jobStore.markCompleted(job.id, 'subtitle', {
      scriptSrt: scriptSrtPath
    }, {
      phase: 'subtitle',
      stage: 'completed',
      percent: 100,
      message: 'Uploaded script.srt ready for video generation'
    });

    jobStore.markRunning(job.id, {
      phase: 'video',
      stage: 'queued',
      percent: 45,
      message: 'Video generation queued',
      files: {
        ...job.files,
        audioPath
      }
    });

    jobRunner.startVideoJob(jobStore.get(job.id), {
      workspace: job.workspace,
      videosDir: job.workspace.videos,
      scriptSrtPath,
      audioPath,
      ffmpegPath: process.env.FFMPEG_PATH,
      ffprobePath: process.env.FFPROBE_PATH,
      loopVideos: true,
      durationToleranceSeconds: 0.25
    });

    response.status(202).json({
      job: serializeJob(jobStore.get(job.id))
    });
  });

  app.get('/api/jobs/:jobId', authManager.requireApiAuth, (request, response) => {
    const job = getOwnedJob(jobStore, request);

    if (!job) {
      response.status(403).json({ error: 'Access denied for this job.' });
      return;
    }

    response.json({
      job: serializeJob(job)
    });
  });

  app.get('/download/:jobId/script', authManager.requirePageAuth, (request, response) => {
    const job = getOwnedJob(jobStore, request);

    if (!job || !job.outputs.scriptSrt || !fs.existsSync(job.outputs.scriptSrt)) {
      response.status(404).json({ error: 'script.srt is not available.' });
      return;
    }

    response.download(job.outputs.scriptSrt, 'script.srt');
  });

  app.get('/download/:jobId/transcript', authManager.requirePageAuth, (request, response) => {
    const job = getOwnedJob(jobStore, request);

    if (!job || !job.outputs.transcriptSrt || !fs.existsSync(job.outputs.transcriptSrt)) {
      response.status(404).json({ error: 'script.whisper.srt is not available.' });
      return;
    }

    response.download(job.outputs.transcriptSrt, 'script.whisper.srt');
  });

  app.get('/download/:jobId/segments', authManager.requirePageAuth, (request, response) => {
    const job = getOwnedJob(jobStore, request);

    if (!job || !job.outputs.segmentZip || !fs.existsSync(job.outputs.segmentZip)) {
      response.status(404).json({ error: 'Segment archive is not available.' });
      return;
    }

    response.download(job.outputs.segmentZip, 'segments.zip');
  });

  app.get('/download/:jobId/final-video', authManager.requirePageAuth, (request, response) => {
    const job = getOwnedJob(jobStore, request);

    if (!job || !job.outputs.finalVideo || !fs.existsSync(job.outputs.finalVideo)) {
      response.status(404).json({ error: 'Final video is not available.' });
      return;
    }

    response.download(job.outputs.finalVideo, 'final-video.mp4');
  });

  app.get('/download/:jobId/final-video-with-audio', authManager.requirePageAuth, (request, response) => {
    const job = getOwnedJob(jobStore, request);

    if (!job || !job.outputs.finalVideoWithAudio || !fs.existsSync(job.outputs.finalVideoWithAudio)) {
      response.status(404).json({ error: 'Final video with audio is not available.' });
      return;
    }

    response.download(job.outputs.finalVideoWithAudio, 'final-video-with-audio.mp4');
  });

  app.get('/download/:jobId/final-video-with-audio-subtitles', authManager.requirePageAuth, (request, response) => {
    const job = getOwnedJob(jobStore, request);

    if (!job || !job.outputs.finalVideoWithAudioSubtitles || !fs.existsSync(job.outputs.finalVideoWithAudioSubtitles)) {
      response.status(404).json({ error: 'Final video with audio and subtitles is not available.' });
      return;
    }

    response.download(job.outputs.finalVideoWithAudioSubtitles, 'final-video-with-audio-subtitles.mp4');
  });

  app.use((error, request, response, next) => {
    if (!(error instanceof multer.MulterError)) {
      next(error);
      return;
    }

    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      response.status(400).json({
        error: `Unexpected upload field: ${error.field}. Allowed fields must match the current form.`
      });
      return;
    }

    response.status(400).json({
      error: error.message
    });
  });

  app.locals.jobStore = jobStore;
  app.locals.workspaceRoot = workspaceRoot;
  app.locals.authManager = authManager;
  return app;
}

module.exports = {
  SUPPORTED_MEDIA_EXTENSIONS,
  SUPPORTED_WHISPER_LANGUAGES,
  createApp,
  serializeJob
};
