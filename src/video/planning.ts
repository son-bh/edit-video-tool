import path from 'node:path';

import { TimingError, ValidationError } from '../subtitle/errors';
import { formatSrtTimestamp } from '../subtitle/srt';
import { VideoSegmentGenerationError } from './errors';
import { concatVideos, copyVideo, cutVideo, formatSeconds } from './ffmpeg';
import { DEFAULT_DURATION_TOLERANCE_SECONDS } from './render-presets';
import type { SegmentCue, SegmentPlan, VideoGenerationOptions } from './types';

export function createSegmentPlan(cue: SegmentCue, sourceVideo: string, sourceDuration: number, options: VideoGenerationOptions = {}): SegmentPlan {
  const tolerance = options.durationToleranceSeconds ?? DEFAULT_DURATION_TOLERANCE_SECONDS;
  const targetDuration = cue.segmentDuration ?? cue.duration;

  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new VideoSegmentGenerationError(`Invalid source video duration for ${sourceVideo}.`);
  }

  if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
    throw new TimingError(`SRT cue ${cue.index} has invalid duration.`);
  }

  if (Math.abs(targetDuration - sourceDuration) <= tolerance) {
    return {
      cue,
      sourceVideo,
      sourceDuration,
      operation: 'copy',
      parts: [{ kind: 'full', duration: sourceDuration }]
    };
  }

  if (targetDuration < sourceDuration) {
    return {
      cue,
      sourceVideo,
      sourceDuration,
      operation: 'cut',
      parts: [{ kind: 'cut', duration: targetDuration }]
    };
  }

  const parts: SegmentPlan['parts'] = [];
  let remaining = targetDuration;

  while (remaining >= sourceDuration - tolerance) {
    parts.push({ kind: 'full', duration: sourceDuration });
    remaining -= sourceDuration;
  }

  if (remaining > tolerance) {
    parts.push({ kind: 'cut', duration: remaining });
  }

  return {
    cue,
    sourceVideo,
    sourceDuration,
    operation: 'concat',
    parts
  };
}

export function buildOutputSegmentPath(outputDir: string, cueIndex: number): string {
  return path.join(outputDir, `segment-${String(cueIndex).padStart(3, '0')}.mp4`);
}

export function executeSegmentPlan(plan: SegmentPlan, outputPath: string, options: VideoGenerationOptions = {}): void {
  const requestedDuration = plan.cue.segmentDuration ?? plan.cue.duration;

  if (plan.operation === 'copy') {
    copyVideo(plan.sourceVideo, outputPath, options);
    return;
  }

  if (plan.operation === 'cut') {
    cutVideo(plan.sourceVideo, outputPath, requestedDuration, options);
    return;
  }

  const tempDir = path.join(options.tempRoot || process.cwd(), `.segment-temp-${plan.cue.index}-${Date.now()}`);
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const partPaths = plan.parts.map((part, index) => {
      const partPath = path.join(tempDir, `part-${String(index + 1).padStart(3, '0')}.mp4`);
      cutVideo(plan.sourceVideo, partPath, part.duration, { ...options, tempDir });
      return partPath;
    });
    concatVideos(partPaths, outputPath, { ...options, tempDir });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
