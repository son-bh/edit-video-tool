import fs from 'node:fs';
import path from 'node:path';

import { ValidationError } from '../subtitle/errors';
import { buildScalePadFilter, DEFAULT_ASPECT_RATIO, resolveVideoRenderPreset } from './render-presets';
import { buildSegmentTimeline, parseSegmentSrtFile } from './srt';
import { discoverSourceVideos, selectVideoForCue } from './source-videos';
import {
  computeExpectedConcatDuration,
  concatVideos,
  formatSeconds,
  getConcatDurationTolerance,
  probeVideoDuration,
  validateOutputDuration
} from './ffmpeg';
import { buildOutputSegmentPath, createSegmentPlan, executeSegmentPlan } from './planning';
import { VideoSegmentGenerationError } from './errors';
import type { GenerateVideoSegmentsInput, SegmentCue, VideoGenerationOptions } from './types';

function ensureOutputDir(outputDir: string): void {
  fs.mkdirSync(outputDir, { recursive: true });
}

export function generateVideoSegments(options: GenerateVideoSegmentsInput): {
  cues: SegmentCue[];
  sourceVideos: string[];
  outputs: Array<{ cue: SegmentCue; sourceVideo: string; outputPath: string; plan: ReturnType<typeof createSegmentPlan>; actualDuration: number }>;
} {
  const cues = buildSegmentTimeline(parseSegmentSrtFile(options.srtPath), options);
  const sourceVideos = discoverSourceVideos(options.videoDir);
  const outputDir = options.outputDir;

  if (!outputDir) {
    throw new ValidationError('Missing output folder for generated video segments.');
  }

  ensureOutputDir(outputDir);

  const outputs = cues.map((cue) => {
    const sourceVideo = selectVideoForCue(cue.index, sourceVideos, options);
    const sourceDuration = probeVideoDuration(sourceVideo, options);
    const outputPath = buildOutputSegmentPath(outputDir, cue.index);
    const plan = createSegmentPlan(cue, sourceVideo, sourceDuration, options);

    executeSegmentPlan(plan, outputPath, options);
    const actualDuration = validateOutputDuration(outputPath, cue.segmentDuration ?? cue.duration, options);

    return {
      cue,
      sourceVideo,
      outputPath,
      plan,
      actualDuration
    };
  });

  if (outputs.length !== cues.length) {
    throw new VideoSegmentGenerationError(`Generated ${outputs.length} output segments, but SRT contains ${cues.length} cues.`);
  }

  return {
    cues,
    sourceVideos,
    outputs
  };
}

export function concatSegmentFolder(options: VideoGenerationOptions & { segmentDir: string; outputPath: string }): {
  segmentPaths: string[];
  outputPath: string;
  videoRenderPreset: ReturnType<typeof resolveVideoRenderPreset>;
  actualDuration: number;
  expectedDuration: number;
} {
  const segmentDir = options.segmentDir;
  const outputPath = options.outputPath;
  const videoRenderPreset = resolveVideoRenderPreset(options.aspectRatio);

  if (!segmentDir) {
    throw new ValidationError('Missing segment folder for final concat.');
  }

  if (!outputPath) {
    throw new ValidationError('Missing output path for final video.');
  }

  const segmentPaths = discoverSourceVideos(segmentDir);
  const stripAudio = options.stripAudio !== false;
  const expectedDuration = computeExpectedConcatDuration(segmentPaths, options);
  const concatTolerance = getConcatDurationTolerance(segmentPaths.length, options);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  concatVideos(segmentPaths, outputPath, {
    ...options,
    videoRenderPreset,
    stripAudio,
    reencodeVideo: true,
    videoFilters: [buildScalePadFilter({ ...options, videoRenderPreset })]
  });

  const actualDuration = probeVideoDuration(outputPath, options);
  if (Math.abs(actualDuration - expectedDuration) > concatTolerance) {
    throw new VideoSegmentGenerationError(
      `Final video duration mismatch for ${outputPath}: expected ${formatSeconds(expectedDuration)}s from ${segmentPaths.length} segments, got ${formatSeconds(actualDuration)}s.`
    );
  }

  return {
    segmentPaths,
    outputPath,
    videoRenderPreset,
    actualDuration,
    expectedDuration
  };
}

export function muxVideoWithAudio(options: VideoGenerationOptions & { videoPath: string; audioPath: string; outputPath: string }): {
  outputPath: string;
  actualDuration: number;
  expectedDuration: number;
} {
  const { videoPath, audioPath, outputPath } = options;

  if (!videoPath) {
    throw new ValidationError('Missing video path for final video plus audio generation.');
  }

  if (!audioPath) {
    throw new ValidationError('Missing audio path for final video plus audio generation.');
  }

  if (!outputPath) {
    throw new ValidationError('Missing output path for final video plus audio generation.');
  }

  if (!fs.existsSync(videoPath)) {
    throw new ValidationError(`Final video cannot be found: ${videoPath}`);
  }

  if (!fs.existsSync(audioPath)) {
    throw new ValidationError(`Audio file cannot be found: ${audioPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const videoDuration = probeVideoDuration(videoPath, options);
  const audioDuration = probeVideoDuration(audioPath, options);
  const targetDuration = Math.min(videoDuration, audioDuration);
  const ffmpeg = require('./ffmpeg') as typeof import('./ffmpeg');

  (ffmpeg as typeof import('./ffmpeg')).runCommand;
  const { getFfmpegCommand } = require('../subtitle/audio') as typeof import('../subtitle/audio');
  const ffmpegCommand = getFfmpegCommand(options);
  const { runCommand } = require('./ffmpeg') as typeof import('./ffmpeg');
  runCommand(ffmpegCommand, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-t',
    formatSeconds(targetDuration),
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath
  ], options);

  const actualDuration = probeVideoDuration(outputPath, options);
  const tolerance = getConcatDurationTolerance(1, options);

  if (Math.abs(actualDuration - targetDuration) > tolerance) {
    throw new VideoSegmentGenerationError(
      `Final video plus audio duration mismatch for ${outputPath}: expected ${formatSeconds(targetDuration)}s, got ${formatSeconds(actualDuration)}s.`
    );
  }

  return {
    outputPath,
    actualDuration,
    expectedDuration: targetDuration
  };
}

function escapeSubtitleFilterPath(filePath: string): string {
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/'/g, '\\\'');
}

export function renderVideoWithAudioAndSubtitles(options: VideoGenerationOptions & { videoPath: string; subtitlePath: string; outputPath: string }): {
  outputPath: string;
  actualDuration: number;
  expectedDuration: number;
} {
  const { videoPath, subtitlePath, outputPath } = options;

  if (!videoPath) {
    throw new ValidationError('Missing video path for final video plus audio plus subtitle generation.');
  }

  if (!subtitlePath) {
    throw new ValidationError('Missing subtitle path for final video plus audio plus subtitle generation.');
  }

  if (!outputPath) {
    throw new ValidationError('Missing output path for final video plus audio plus subtitle generation.');
  }

  if (!fs.existsSync(videoPath)) {
    throw new ValidationError(`Final video with audio cannot be found: ${videoPath}`);
  }

  if (!fs.existsSync(subtitlePath)) {
    throw new ValidationError(`Subtitle file cannot be found: ${subtitlePath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const expectedDuration = probeVideoDuration(videoPath, options);
  const videoFilter = `subtitles='${escapeSubtitleFilterPath(subtitlePath)}'`;
  const { getFfmpegCommand } = require('../subtitle/audio') as typeof import('../subtitle/audio');
  const { runCommand } = require('./ffmpeg') as typeof import('./ffmpeg');

  runCommand(getFfmpegCommand(options), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    videoPath,
    '-vf',
    videoFilter,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outputPath
  ], options);

  const actualDuration = probeVideoDuration(outputPath, options);
  const tolerance = getConcatDurationTolerance(1, options);

  if (Math.abs(actualDuration - expectedDuration) > tolerance) {
    throw new VideoSegmentGenerationError(
      `Final video plus audio plus subtitle duration mismatch for ${outputPath}: expected ${formatSeconds(expectedDuration)}s, got ${formatSeconds(actualDuration)}s.`
    );
  }

  return {
    outputPath,
    actualDuration,
    expectedDuration
  };
}
