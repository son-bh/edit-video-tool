import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { AudioAnalysisError, AlignmentMismatchError } from './errors';
import { logStep } from './logging';
import type { AlignmentOptions, AudioSegment, SubtitleItem, WavInfo } from './types';

export const DEFAULT_FFMPEG_COMMAND = 'ffmpeg';

export function validateAudioFile(audioPath: string, options: AlignmentOptions = {}): void {
  logStep(options, `validateAudioFile: checking ${audioPath}`);
  let stats: fs.Stats;

  try {
    stats = fs.statSync(audioPath);
  } catch {
    throw new AudioAnalysisError(`Audio file cannot be found: ${audioPath}`);
  }

  if (!stats.isFile()) {
    throw new AudioAnalysisError(`Audio path is not a file: ${audioPath}`);
  }

  try {
    fs.accessSync(audioPath, fs.constants.R_OK);
  } catch {
    throw new AudioAnalysisError(`Audio file cannot be read: ${audioPath}`);
  }
}

export function isRiffWaveBuffer(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
}

export function getFfmpegCommand(options: AlignmentOptions = {}): string {
  return options.ffmpegPath || process.env.FFMPEG_PATH || DEFAULT_FFMPEG_COMMAND;
}

export function transcodeMediaToPcmWav(audioPath: string, options: AlignmentOptions = {}): Buffer {
  const ffmpegCommand = getFfmpegCommand(options);
  const tempPath = path.join(os.tmpdir(), `subtitle-audio-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);

  try {
    logStep(options, `transcodeMediaToPcmWav: decoding ${audioPath} with ${ffmpegCommand}`);
    execFileSync(ffmpegCommand, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      audioPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(options.sampleRate ?? 16000),
      '-acodec',
      'pcm_s16le',
      tempPath
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      maxBuffer: 1024 * 1024 * 32
    });

    const decodedAudio = fs.readFileSync(tempPath);
    logStep(options, `transcodeMediaToPcmWav: decoded ${decodedAudio.length} bytes`);
    return decodedAudio;
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr?: Buffer }).stderr || '').trim()
      : '';
    const detail = stderr ? ` ${stderr}` : '';
    throw new AudioAnalysisError(
      'Audio file is not a supported PCM WAV file and ffmpeg could not decode it. ' +
      `Set FFMPEG_PATH in .env, add ffmpeg to PATH, or pass --ffmpeg.${detail}`
    );
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

export function loadAudioAsPcmWavBuffer(audioPath: string, options: AlignmentOptions = {}): Buffer {
  validateAudioFile(audioPath, options);
  logStep(options, `loadAudioAsPcmWavBuffer: loading ${audioPath}`);
  const audioBuffer = fs.readFileSync(audioPath);

  if (isRiffWaveBuffer(audioBuffer)) {
    logStep(options, 'loadAudioAsPcmWavBuffer: input is already RIFF/WAVE');
    return audioBuffer;
  }

  logStep(options, 'loadAudioAsPcmWavBuffer: input is not RIFF/WAVE, using ffmpeg decode');
  return transcodeMediaToPcmWav(audioPath, options);
}

export function parseWav(buffer: Buffer): WavInfo {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new AudioAnalysisError('Audio file must decode to a RIFF/WAVE PCM file.');
  }

  let offset = 12;
  let format: Omit<WavInfo, 'dataOffset' | 'dataSize' | 'frameCount'> | null = null;
  let dataOffset: number | null = null;
  let dataSize: number | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + chunkSize > buffer.length) {
      throw new AudioAnalysisError(`Invalid WAV chunk size for ${chunkId}.`);
    }

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        throw new AudioAnalysisError('Invalid WAV fmt chunk.');
      }

      format = {
        audioFormat: buffer.readUInt16LE(chunkDataOffset),
        channelCount: buffer.readUInt16LE(chunkDataOffset + 2),
        sampleRate: buffer.readUInt32LE(chunkDataOffset + 4),
        blockAlign: buffer.readUInt16LE(chunkDataOffset + 12),
        bitsPerSample: buffer.readUInt16LE(chunkDataOffset + 14)
      };
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!format) {
    throw new AudioAnalysisError('WAV file is missing a fmt chunk.');
  }

  if (dataOffset === null || dataSize === null) {
    throw new AudioAnalysisError('WAV file is missing a data chunk.');
  }

  if (format.audioFormat !== 1) {
    throw new AudioAnalysisError('Only uncompressed PCM WAV audio is supported.');
  }

  if (format.channelCount < 1 || format.sampleRate < 1 || format.blockAlign < 1) {
    throw new AudioAnalysisError('WAV file has invalid audio format metadata.');
  }

  if (![8, 16, 24, 32].includes(format.bitsPerSample)) {
    throw new AudioAnalysisError(`Unsupported PCM bit depth: ${format.bitsPerSample}.`);
  }

  return {
    ...format,
    dataOffset,
    dataSize,
    frameCount: Math.floor(dataSize / format.blockAlign)
  };
}

function sampleAmplitude(buffer: Buffer, byteOffset: number, bitsPerSample: number): number {
  if (bitsPerSample === 8) {
    return Math.abs((buffer.readUInt8(byteOffset) - 128) / 128);
  }

  if (bitsPerSample === 16) {
    return Math.abs(buffer.readInt16LE(byteOffset) / 32768);
  }

  if (bitsPerSample === 24) {
    return Math.abs(buffer.readIntLE(byteOffset, 3) / 8388608);
  }

  return Math.abs(buffer.readInt32LE(byteOffset) / 2147483648);
}

export function detectSpeechSegmentsFromWav(buffer: Buffer, options: AlignmentOptions = {}): AudioSegment[] {
  const wav = parseWav(buffer);
  logStep(options, `detectSpeechSegmentsFromWav: analyzing ${wav.frameCount} frames at ${wav.sampleRate} Hz`);
  const frameDurationMs = options.frameDurationMs ?? 20;
  const threshold = options.threshold ?? 0.02;
  const minSpeechMs = options.minSpeechMs ?? 80;
  const maxSilenceGapMs = options.maxSilenceGapMs ?? 120;
  const samplesPerWindow = Math.max(1, Math.floor(wav.sampleRate * frameDurationMs / 1000));
  const bytesPerSample = wav.bitsPerSample / 8;
  const rawSegments: Array<{ startFrame: number; endFrame: number }> = [];
  let activeStartFrame: number | null = null;

  for (let frameStart = 0; frameStart < wav.frameCount; frameStart += samplesPerWindow) {
    const frameEnd = Math.min(wav.frameCount, frameStart + samplesPerWindow);
    let peakAmplitude = 0;

    for (let frame = frameStart; frame < frameEnd; frame += 1) {
      const baseOffset = wav.dataOffset + frame * wav.blockAlign;

      for (let channel = 0; channel < wav.channelCount; channel += 1) {
        const valueOffset = baseOffset + channel * bytesPerSample;
        peakAmplitude = Math.max(peakAmplitude, sampleAmplitude(buffer, valueOffset, wav.bitsPerSample));
      }
    }

    if (peakAmplitude >= threshold && activeStartFrame === null) {
      activeStartFrame = frameStart;
    }

    if (peakAmplitude < threshold && activeStartFrame !== null) {
      rawSegments.push({ startFrame: activeStartFrame, endFrame: frameStart });
      activeStartFrame = null;
    }
  }

  if (activeStartFrame !== null) {
    rawSegments.push({ startFrame: activeStartFrame, endFrame: wav.frameCount });
  }

  const mergedSegments: Array<{ startFrame: number; endFrame: number }> = [];
  const maxGapFrames = Math.floor(wav.sampleRate * maxSilenceGapMs / 1000);

  for (const segment of rawSegments) {
    const previous = mergedSegments[mergedSegments.length - 1];

    if (previous && segment.startFrame - previous.endFrame <= maxGapFrames) {
      previous.endFrame = segment.endFrame;
    } else {
      mergedSegments.push({ ...segment });
    }
  }

  const minSpeechFrames = Math.floor(wav.sampleRate * minSpeechMs / 1000);
  const segments = mergedSegments
    .filter((segment) => segment.endFrame - segment.startFrame >= minSpeechFrames)
    .map((segment) => ({
      start: segment.startFrame / wav.sampleRate,
      end: segment.endFrame / wav.sampleRate
    }));
  logStep(options, `detectSpeechSegmentsFromWav: detected ${segments.length} speech segments`);
  return segments;
}

export function groupSegmentsToItemCount(segments: AudioSegment[], itemsOrItemCount: SubtitleItem[] | number, options: AlignmentOptions = {}): AudioSegment[] {
  const items = Array.isArray(itemsOrItemCount) ? itemsOrItemCount : null;
  const itemCount: number = items ? items.length : itemsOrItemCount as number;

  if (segments.length < itemCount) {
    throw new AlignmentMismatchError(
      `Audio analysis found ${segments.length} speech segments, but the script contains ${itemCount} subtitle items.`
    );
  }

  if (segments.length === itemCount) {
    return segments;
  }

  const boundaryCount = itemCount - 1;
  const minBoundaryGapSeconds = options.minBoundaryGapSeconds ?? 0.3;
  const maxCharsPerSecond = options.maxCharsPerSecond ?? 22;
  const gaps: Array<{ index: number; gap: number; time: number }> = [];

  for (let index = 1; index < segments.length; index += 1) {
    gaps.push({
      index,
      gap: segments[index].start - segments[index - 1].end,
      time: segments[index - 1].end
    });
  }

  let boundaries: Array<{ index: number; gap: number; time: number }>;

  if (items) {
    boundaries = [];
    let startSegmentIndex = 0;

    for (let itemIndex = 0; itemIndex < boundaryCount; itemIndex += 1) {
      const textLength = items[itemIndex].text.length;
      const minCueDuration = Math.max(0.8, textLength / maxCharsPerSecond);
      const earliestEndTime = segments[startSegmentIndex].start + minCueDuration;
      const boundary = gaps.find((gap) =>
        gap.index > startSegmentIndex &&
        gap.time >= earliestEndTime &&
        gap.gap >= minBoundaryGapSeconds
      );

      if (!boundary) {
        throw new AlignmentMismatchError(
          `Audio analysis could not find a reliable boundary after script item ${itemIndex + 1}.`
        );
      }

      boundaries.push(boundary);
      startSegmentIndex = boundary.index;
    }
  } else {
    boundaries = gaps
      .sort((left, right) => right.gap - left.gap)
      .slice(0, boundaryCount)
      .sort((left, right) => left.index - right.index);
  }

  if (boundaries.length !== boundaryCount || boundaries.some((boundary) => boundary.gap < minBoundaryGapSeconds)) {
    throw new AlignmentMismatchError(
      `Audio analysis found ${segments.length} speech segments, but could not find ${boundaryCount} reliable item boundaries.`
    );
  }

  const groupedSegments: AudioSegment[] = [];
  let startIndex = 0;

  for (const boundary of boundaries) {
    groupedSegments.push({
      start: segments[startIndex].start,
      end: segments[boundary.index - 1].end
    });
    startIndex = boundary.index;
  }

  groupedSegments.push({
    start: segments[startIndex].start,
    end: segments[segments.length - 1].end
  });

  return groupedSegments;
}
