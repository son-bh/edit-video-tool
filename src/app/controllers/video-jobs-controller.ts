import path from 'node:path';
import type { Request, Response } from 'express';

import { DEFAULT_ASPECT_RATIO, resolveVideoRenderPreset, SUPPORTED_VIDEO_EXTENSIONS } from '../../video-segment-generation';
import type { AppContext } from '../context';
import type { JobRecord } from '../types';
import { SUPPORTED_MEDIA_EXTENSIONS } from '../config/media';
import { moveFile, unlinkIfPresent } from '../http/files';
import { serializeJob } from '../http/serializers';
import { createOwnedJob, getOwnedJob, moveVideoFiles } from './job-helpers';

function cleanupUploadFiles(audioPath: string | undefined | null, scriptSrtPath: string | undefined | null, files: Express.Multer.File[]): void {
  unlinkIfPresent(audioPath);
  unlinkIfPresent(scriptSrtPath);
  files.forEach((file) => unlinkIfPresent(file.path));
}

export function createVideoJobsController(
  context: Pick<AppContext, 'workspaceRoot' | 'jobStore' | 'jobRunner'>
) {
  return {
    createForExistingSubtitleJob(request: Request, response: Response): void {
      const requestFiles = request.files as Record<string, Express.Multer.File[]> | undefined;
      const job = getOwnedJob(context.jobStore, request);
      const audioFile = requestFiles?.audio?.[0];
      const files = requestFiles?.videos || [];
      const requestedAspectRatio = String(request.body?.aspectRatio || '').trim() || job?.aspectRatio || DEFAULT_ASPECT_RATIO;

      if (!job) {
        cleanupUploadFiles(audioFile?.path, null, files);
        response.status(404).json({ error: 'Job not found.' });
        return;
      }

      let videoRenderPreset;

      try {
        videoRenderPreset = resolveVideoRenderPreset(requestedAspectRatio);
      } catch (error) {
        cleanupUploadFiles(audioFile?.path, null, files);
        response.status(400).json({ error: (error as Error).message });
        return;
      }

      if (!job.completedPhases.subtitle || !job.outputs.scriptSrt) {
        cleanupUploadFiles(audioFile?.path, null, files);
        response.status(400).json({ error: 'Subtitle generation must complete successfully before video generation.' });
        return;
      }

      if (files.length === 0) {
        unlinkIfPresent(audioFile?.path);
        response.status(400).json({ error: 'At least one video file is required.' });
        return;
      }

      if (audioFile && !SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(audioFile.originalname).toLowerCase())) {
        cleanupUploadFiles(audioFile.path, null, files);
        response.status(400).json({ error: 'Unsupported audio or video file type for audio upload.' });
        return;
      }

      const invalidFile = files.find((file) => !SUPPORTED_VIDEO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase()));
      if (invalidFile) {
        cleanupUploadFiles(audioFile?.path, null, files);
        response.status(400).json({ error: 'All uploaded files must be supported video types.' });
        return;
      }

      const audioPath = audioFile
        ? moveFile(audioFile.path, path.join(job.workspace!.inputs, `audio-for-video${path.extname(audioFile.originalname).toLowerCase()}`))
        : job.files.audioPath;
      moveVideoFiles(files, job.workspace!.videos);

      context.jobStore.markRunning(job.id, {
        phase: 'video',
        stage: 'queued',
        percent: 45,
        message: 'Video generation queued',
        aspectRatio: videoRenderPreset.key,
        renderLabel: videoRenderPreset.label,
        files: {
          ...job.files,
          audioPath
        }
      });

      context.jobRunner.startVideoJob(context.jobStore.get(job.id) as JobRecord, {
        workspace: job.workspace,
        videosDir: job.workspace!.videos,
        scriptSrtPath: job.outputs.scriptSrt,
        audioPath,
        ffmpegPath: process.env.FFMPEG_PATH,
        ffprobePath: process.env.FFPROBE_PATH,
        aspectRatio: videoRenderPreset.key,
        loopVideos: true,
        durationToleranceSeconds: 0.25
      });

      response.status(202).json({
        job: serializeJob(context.jobStore.get(job.id))
      });
    },
    createStandaloneVideoJob(request: Request, response: Response): void {
      const requestFiles = request.files as Record<string, Express.Multer.File[]> | undefined;
      const audioFile = requestFiles?.audio?.[0];
      const scriptSrtFile = requestFiles?.scriptSrt?.[0];
      const files = requestFiles?.videos || [];
      const requestedAspectRatio = String(request.body?.aspectRatio || '').trim() || DEFAULT_ASPECT_RATIO;

      if (!scriptSrtFile) {
        cleanupUploadFiles(audioFile?.path, null, files);
        response.status(400).json({ error: 'scriptSrt is required when starting video generation without an existing subtitle job.' });
        return;
      }

      if (path.extname(scriptSrtFile.originalname).toLowerCase() !== '.srt') {
        cleanupUploadFiles(audioFile?.path, scriptSrtFile.path, files);
        response.status(400).json({ error: 'scriptSrt must be an .srt file.' });
        return;
      }

      if (files.length === 0) {
        cleanupUploadFiles(audioFile?.path, scriptSrtFile.path, []);
        response.status(400).json({ error: 'At least one video file is required.' });
        return;
      }

      if (audioFile && !SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(audioFile.originalname).toLowerCase())) {
        cleanupUploadFiles(audioFile.path, scriptSrtFile.path, files);
        response.status(400).json({ error: 'Unsupported audio or video file type for audio upload.' });
        return;
      }

      const invalidFile = files.find((file) => !SUPPORTED_VIDEO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase()));
      if (invalidFile) {
        cleanupUploadFiles(audioFile?.path, scriptSrtFile.path, files);
        response.status(400).json({ error: 'All uploaded files must be supported video types.' });
        return;
      }

      let videoRenderPreset;

      try {
        videoRenderPreset = resolveVideoRenderPreset(requestedAspectRatio);
      } catch (error) {
        cleanupUploadFiles(audioFile?.path, scriptSrtFile.path, files);
        response.status(400).json({ error: (error as Error).message });
        return;
      }

      const job = createOwnedJob(context.jobStore, context.workspaceRoot, request);
      const audioPath = audioFile
        ? moveFile(audioFile.path, path.join(job.workspace!.inputs, `audio-for-video${path.extname(audioFile.originalname).toLowerCase()}`))
        : null;
      const scriptSrtPath = moveFile(scriptSrtFile.path, path.join(job.workspace!.inputs, 'script.srt'));
      moveVideoFiles(files, job.workspace!.videos);

      context.jobStore.markCompleted(job.id, 'subtitle', {
        scriptSrt: scriptSrtPath
      }, {
        phase: 'subtitle',
        stage: 'completed',
        percent: 100,
        message: 'Uploaded script.srt ready for video generation'
      });

      context.jobStore.markRunning(job.id, {
        phase: 'video',
        stage: 'queued',
        percent: 45,
        message: 'Video generation queued',
        aspectRatio: videoRenderPreset.key,
        renderLabel: videoRenderPreset.label,
        files: {
          ...job.files,
          audioPath
        }
      });

      context.jobRunner.startVideoJob(context.jobStore.get(job.id) as JobRecord, {
        workspace: job.workspace,
        videosDir: job.workspace!.videos,
        scriptSrtPath,
        audioPath,
        ffmpegPath: process.env.FFMPEG_PATH,
        ffprobePath: process.env.FFPROBE_PATH,
        aspectRatio: videoRenderPreset.key,
        loopVideos: true,
        durationToleranceSeconds: 0.25
      });

      response.status(202).json({
        job: serializeJob(context.jobStore.get(job.id))
      });
    }
  };
}
