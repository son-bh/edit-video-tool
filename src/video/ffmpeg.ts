import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { getFfmpegCommand } from '../subtitle/audio';
import { VideoSegmentGenerationError } from './errors';
import { DEFAULT_DURATION_TOLERANCE_SECONDS } from './render-presets';
import type { VideoGenerationOptions } from './types';

export function getFfprobeCommand(options: VideoGenerationOptions = {}): string {
  if (options.ffprobePath) {
    return options.ffprobePath;
  }

  if (process.env.FFPROBE_PATH) {
    return process.env.FFPROBE_PATH;
  }

  const ffmpegCommand = getFfmpegCommand(options);
  const parsed = path.parse(ffmpegCommand);

  if (!parsed.dir) {
    return 'ffprobe';
  }

  return path.join(parsed.dir, 'ffprobe');
}

export function runCommand(command: string, args: string[], options: VideoGenerationOptions = {}): string | Buffer {
  if (typeof options.commandRunner === 'function') {
    return options.commandRunner(command, args);
  }

  return execFileSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 32
  });
}

export function probeVideoDuration(videoPath: string, options: VideoGenerationOptions = {}): number {
  if (typeof options.durationProbe === 'function') {
    return options.durationProbe(videoPath);
  }

  const ffprobeCommand = getFfprobeCommand(options);

  try {
    const output = runCommand(ffprobeCommand, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath
    ], options);
    const duration = Number(String(output).trim());

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Invalid duration output: ${String(output).trim()}`);
    }

    return duration;
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr?: Buffer }).stderr || '').trim()
      : '';
    const detail = stderr ? ` ${stderr}` : ` ${(error as Error).message || error}`;
    throw new VideoSegmentGenerationError(`ffprobe could not read video duration for ${videoPath}.${detail}`);
  }
}

function runFfmpeg(args: string[], options: VideoGenerationOptions = {}): void {
  const ffmpegCommand = getFfmpegCommand(options);

  try {
    runCommand(ffmpegCommand, args, options);
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr?: Buffer }).stderr || '').trim()
      : '';
    const detail = stderr ? ` ${stderr}` : ` ${(error as Error).message || error}`;
    throw new VideoSegmentGenerationError(`ffmpeg failed.${detail}`);
  }
}

export function formatSeconds(seconds: number): string {
  return seconds.toFixed(3);
}

export function cutVideo(inputPath: string, outputPath: string, duration: number, options: VideoGenerationOptions = {}): void {
  runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    '0',
    '-i',
    inputPath,
    '-t',
    formatSeconds(duration),
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outputPath
  ], options);
}

export function copyVideo(inputPath: string, outputPath: string, options: VideoGenerationOptions = {}): void {
  runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-c',
    'copy',
    outputPath
  ], options);
}

function escapeConcatFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, '\'\\\'\'');
}

function writeConcatListFile(listPath: string, partPaths: string[]): void {
  const contents = partPaths
    .map((partPath) => `file '${escapeConcatFilePath(partPath)}'`)
    .join('\n') + '\n';
  fs.writeFileSync(listPath, contents, 'utf8');
}

export function concatVideos(partPaths: string[], outputPath: string, options: VideoGenerationOptions = {}): void {
  const listPath = options.concatListPath || path.join(options.tempDir || os.tmpdir(), `concat-list-${process.pid}.txt`);
  writeConcatListFile(listPath, partPaths);
  const shouldReencodeVideo = options.reencodeVideo === true;
  let outputArgs: string[];

  if (shouldReencodeVideo) {
    const videoFilters = options.videoFilters || [];
    outputArgs = [
      ...(videoFilters.length > 0 ? ['-vf', videoFilters.join(',')] : []),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart'
    ];

    if (options.stripAudio) {
      outputArgs.push('-an');
    } else {
      outputArgs.push('-c:a', 'aac');
    }
  } else {
    outputArgs = options.stripAudio
      ? ['-c:v', 'copy', '-an']
      : ['-c', 'copy'];
  }

  try {
    runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      ...outputArgs,
      outputPath
    ], options);
  } finally {
    if (!options.concatListPath) {
      fs.rmSync(listPath, { force: true });
    }
  }
}

export function validateOutputDuration(outputPath: string, expectedDuration: number, options: VideoGenerationOptions = {}): number {
  const tolerance = options.durationToleranceSeconds ?? DEFAULT_DURATION_TOLERANCE_SECONDS;
  const actualDuration = probeVideoDuration(outputPath, options);

  if (Math.abs(actualDuration - expectedDuration) > tolerance) {
    throw new VideoSegmentGenerationError(
      `Generated segment duration mismatch for ${outputPath}: expected ${formatSeconds(expectedDuration)}s, got ${formatSeconds(actualDuration)}s.`
    );
  }

  return actualDuration;
}

export function computeExpectedConcatDuration(segmentPaths: string[], options: VideoGenerationOptions = {}): number {
  return segmentPaths.reduce((total, segmentPath) => total + probeVideoDuration(segmentPath, options), 0);
}

export function getConcatDurationTolerance(segmentCount: number, options: VideoGenerationOptions = {}): number {
  const baseTolerance = options.durationToleranceSeconds ?? DEFAULT_DURATION_TOLERANCE_SECONDS;
  return Math.max(baseTolerance, Math.min(5, segmentCount * 0.05));
}
