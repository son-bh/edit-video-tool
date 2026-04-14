import path from 'node:path';
import type { Request, Response } from 'express';

import type { AppContext } from '../context';
import type { JobRecord } from '../types';
import { SUPPORTED_MEDIA_EXTENSIONS, SUPPORTED_WHISPER_LANGUAGES } from '../config/media';
import { moveFile, unlinkIfPresent } from '../http/files';
import { serializeJob } from '../http/serializers';
import { createOwnedJob } from './job-helpers';

function cleanupFiles(...files: Array<string | undefined | null>): void {
  files.forEach((filePath) => unlinkIfPresent(filePath));
}

export function createSubtitleJobsController(
  context: Pick<AppContext, 'workspaceRoot' | 'jobStore' | 'jobRunner'>
) {
  return {
    createJob(request: Request, response: Response): void {
      const requestFiles = request.files as Record<string, Express.Multer.File[]> | undefined;
      const audioFile = requestFiles?.audio?.[0];
      const scriptFile = requestFiles?.scriptJson?.[0];
      const transcriptFile = requestFiles?.transcriptSrt?.[0];
      const requestedLanguage = String(request.body?.language || '').trim().toLowerCase() || process.env.WHISPER_LANGUAGE || 'auto';

      if (!scriptFile || (!audioFile && !transcriptFile)) {
        cleanupFiles(audioFile?.path, scriptFile?.path, transcriptFile?.path);
        response.status(400).json({ error: 'scriptJson and either audio or transcriptSrt are required.' });
        return;
      }

      if (audioFile && !SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(audioFile.originalname).toLowerCase())) {
        cleanupFiles(audioFile.path, scriptFile.path, transcriptFile?.path);
        response.status(400).json({ error: 'Unsupported audio or video file type.' });
        return;
      }

      const scriptExtension = path.extname(scriptFile.originalname).toLowerCase();
      if (!['.json', '.txt'].includes(scriptExtension)) {
        cleanupFiles(audioFile?.path, scriptFile.path, transcriptFile?.path);
        response.status(400).json({ error: 'scriptJson must be a .json or .txt file.' });
        return;
      }

      if (transcriptFile && path.extname(transcriptFile.originalname).toLowerCase() !== '.srt') {
        cleanupFiles(audioFile?.path, scriptFile.path, transcriptFile.path);
        response.status(400).json({ error: 'transcriptSrt must be an .srt file.' });
        return;
      }

      if (!SUPPORTED_WHISPER_LANGUAGES.has(requestedLanguage)) {
        cleanupFiles(audioFile?.path, scriptFile.path, transcriptFile?.path);
        response.status(400).json({ error: 'language must be one of: auto, en, vi.' });
        return;
      }

      const job = createOwnedJob(context.jobStore, context.workspaceRoot, request);
      const audioPath = audioFile
        ? moveFile(audioFile.path, path.join(job.workspace!.inputs, `audio${path.extname(audioFile.originalname).toLowerCase()}`))
        : null;
      const jsonPath = moveFile(scriptFile.path, path.join(job.workspace!.inputs, `script${scriptExtension}`));
      const transcriptPath = transcriptFile
        ? moveFile(transcriptFile.path, path.join(job.workspace!.inputs, 'script.whisper.srt'))
        : null;

      context.jobStore.markRunning(job.id, {
        phase: 'subtitle',
        stage: 'queued',
        percent: 1,
        message: transcriptPath ? 'Subtitle mapping queued' : 'Subtitle generation queued',
        workspace: job.workspace,
        files: {
          audioPath,
          jsonPath,
          transcriptPath
        }
      });

      context.jobRunner.startSubtitleJob(context.jobStore.get(job.id) as JobRecord, {
        workspace: job.workspace,
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
        job: serializeJob(context.jobStore.get(job.id))
      });
    }
  };
}
