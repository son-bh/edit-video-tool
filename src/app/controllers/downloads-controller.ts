import fs from 'node:fs';
import type { Request, Response } from 'express';

import type { AppContext } from '../context';
import { getDownloadFileName } from '../services/jobs/output-names';
import { getOwnedJob } from './job-helpers';

function downloadIfExists(
  filePath: string | undefined,
  filename: string,
  missingMessage: string,
  response: Response
): void {
  if (!filePath || !fs.existsSync(filePath)) {
    response.status(404).json({ error: missingMessage });
    return;
  }

  response.download(filePath, filename);
}

export function createDownloadsController(context: Pick<AppContext, 'jobStore'>) {
  return {
    downloadScript(request: Request, response: Response): void {
      const job = getOwnedJob(context.jobStore, request);
      downloadIfExists(
        job?.outputs.scriptSrt,
        getDownloadFileName(job?.outputs.scriptSrt, 'script.srt'),
        'script.srt is not available.',
        response
      );
    },
    downloadTranscript(request: Request, response: Response): void {
      const job = getOwnedJob(context.jobStore, request);
      downloadIfExists(
        job?.outputs.transcriptSrt,
        getDownloadFileName(job?.outputs.transcriptSrt, 'script.whisper.srt'),
        'script.whisper.srt is not available.',
        response
      );
    },
    downloadSegments(request: Request, response: Response): void {
      const job = getOwnedJob(context.jobStore, request);
      downloadIfExists(
        job?.outputs.segmentZip,
        getDownloadFileName(job?.outputs.segmentZip, 'segments.zip'),
        'Segment archive is not available.',
        response
      );
    },
    downloadFinalVideo(request: Request, response: Response): void {
      const job = getOwnedJob(context.jobStore, request);
      downloadIfExists(
        job?.outputs.finalVideo,
        getDownloadFileName(job?.outputs.finalVideo, 'final-video.mp4'),
        'Final video is not available.',
        response
      );
    },
    downloadFinalVideoWithAudio(request: Request, response: Response): void {
      const job = getOwnedJob(context.jobStore, request);
      downloadIfExists(
        job?.outputs.finalVideoWithAudio,
        getDownloadFileName(job?.outputs.finalVideoWithAudio, 'final-video-with-audio.mp4'),
        'Final video with audio is not available.',
        response
      );
    },
    downloadFinalVideoWithAudioSubtitles(request: Request, response: Response): void {
      const job = getOwnedJob(context.jobStore, request);
      downloadIfExists(
        job?.outputs.finalVideoWithAudioSubtitles,
        getDownloadFileName(job?.outputs.finalVideoWithAudioSubtitles, 'final-video-with-audio-subtitles.mp4'),
        'Final video with audio and subtitles is not available.',
        response
      );
    }
  };
}
