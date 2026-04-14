import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { AudioAnalysisError } from './errors';
import { getFfmpegCommand, validateAudioFile } from './audio';
import { logStep } from './logging';
import type { AlignmentOptions } from './types';

export const DEFAULT_WHISPER_COMMAND = 'whisper';

function escapeFilterValue(value: string): string {
  return String(value)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, '\\\'');
}

export function getWhisperModelPath(options: AlignmentOptions = {}): string | null {
  return options.whisperModelPath || process.env.WHISPER_MODEL_PATH || null;
}

export function getWhisperCommand(options: AlignmentOptions = {}): string {
  return options.whisperCommandPath || process.env.WHISPER_COMMAND_PATH || DEFAULT_WHISPER_COMMAND;
}

export function shouldUseTranscriptAlignment(options: AlignmentOptions = {}): boolean {
  if (options.useTranscript === false) {
    return false;
  }

  const whisperCommand = getWhisperCommand(options);
  return Boolean(options.useTranscript || getWhisperModelPath(options) || fs.existsSync(whisperCommand));
}

export function transcribeAudioToSrtWithWhisperCommand(audioPath: string, options: AlignmentOptions = {}): string {
  validateAudioFile(audioPath, options);
  const whisperCommand = getWhisperCommand(options);
  const ffmpegCommand = getFfmpegCommand(options);
  const ffmpegDir = path.dirname(ffmpegCommand);

  if (options.transcriptInputPath && fs.existsSync(options.transcriptInputPath)) {
    logStep(options, `transcribeAudioToSrtWithWhisperCommand: using existing transcript ${options.transcriptInputPath}`);
    return fs.readFileSync(options.transcriptInputPath, 'utf8');
  }

  if (!fs.existsSync(whisperCommand)) {
    throw new AudioAnalysisError(`Whisper command cannot be found: ${whisperCommand}`);
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-whisper-'));
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const outputPath = path.join(outputDir, `${baseName}.srt`);
  const args = [
    audioPath,
    '--output_dir',
    outputDir,
    '--output_format',
    'srt',
    '--verbose',
    'False',
    '--fp16',
    'False'
  ];

  if (options.whisperModel || options.whisperModelPath) {
    args.push('--model', options.whisperModel || options.whisperModelPath || '');
  }

  if (options.language && options.language !== 'auto') {
    args.push('--language', options.language);
  }

  try {
    logStep(options, `transcribeAudioToSrtWithWhisperCommand: running ${whisperCommand}`);
    logStep(options, `transcribeAudioToSrtWithWhisperCommand: raw transcript will be created from ${audioPath}`);
    execFileSync(whisperCommand, args, {
      env: {
        ...process.env,
        PATH: [ffmpegDir, process.env.PATH].filter(Boolean).join(path.delimiter),
        PYTHONIOENCODING: 'utf-8'
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      maxBuffer: 1024 * 1024 * 32
    });

    const transcript = fs.readFileSync(outputPath, 'utf8');

    if (options.transcriptOutputPath) {
      fs.mkdirSync(path.dirname(options.transcriptOutputPath), { recursive: true });
      fs.writeFileSync(options.transcriptOutputPath, transcript, 'utf8');
      logStep(options, `transcribeAudioToSrtWithWhisperCommand: saved transcript ${options.transcriptOutputPath}`);
    }

    logStep(options, `transcribeAudioToSrtWithWhisperCommand: transcript size ${transcript.length} characters`);
    return transcript;
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr?: Buffer }).stderr || '').trim()
      : '';
    const detail = stderr ? ` ${stderr}` : '';
    throw new AudioAnalysisError(`Python Whisper transcription failed.${detail}`);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

export function transcribeAudioToSrtWithFfmpegWhisper(audioPath: string, options: AlignmentOptions = {}): string {
  validateAudioFile(audioPath, options);
  const modelPath = getWhisperModelPath(options);

  if (!modelPath) {
    throw new AudioAnalysisError('ffmpeg Whisper transcription requires --whisper-model or WHISPER_MODEL_PATH.');
  }

  if (!fs.existsSync(modelPath)) {
    throw new AudioAnalysisError(`Whisper model file cannot be found: ${modelPath}`);
  }

  const ffmpegCommand = getFfmpegCommand(options);
  const tempPath = path.join(os.tmpdir(), `subtitle-transcript-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.srt`);
  const filter = [
    `whisper=model='${escapeFilterValue(modelPath)}'`,
    `destination='${escapeFilterValue(tempPath)}'`,
    'format=srt',
    `language='${escapeFilterValue(options.language || 'auto')}'`
  ].join(':');

  try {
    logStep(options, `transcribeAudioToSrtWithFfmpegWhisper: running ${ffmpegCommand}`);
    execFileSync(ffmpegCommand, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      audioPath,
      '-vn',
      '-af',
      filter,
      '-f',
      'null',
      '-'
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      maxBuffer: 1024 * 1024 * 32
    });

    return fs.readFileSync(tempPath, 'utf8');
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr?: Buffer }).stderr || '').trim()
      : '';
    const detail = stderr ? ` ${stderr}` : '';
    throw new AudioAnalysisError(`ffmpeg whisper transcription failed.${detail}`);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

export function transcribeAudioToSrt(audioPath: string, options: AlignmentOptions = {}): string {
  const whisperCommand = getWhisperCommand(options);
  logStep(options, 'transcribeAudioToSrt: selecting transcription backend');

  if (fs.existsSync(whisperCommand) || options.whisperCommandPath || process.env.WHISPER_COMMAND_PATH) {
    logStep(options, 'transcribeAudioToSrt: using Python Whisper command backend');
    return transcribeAudioToSrtWithWhisperCommand(audioPath, options);
  }

  logStep(options, 'transcribeAudioToSrt: using ffmpeg whisper filter backend');
  return transcribeAudioToSrtWithFfmpegWhisper(audioPath, options);
}

export function createWhisperSubtitleFile(audioPath: string, options: AlignmentOptions = {}): { transcript: string; transcriptOutputPath?: string } {
  logStep(options, 'createWhisperSubtitleFile: Step 1 start');
  const transcriptOutputPath = options.transcriptOutputPath;
  const transcript = transcribeAudioToSrt(audioPath, options);

  if (transcriptOutputPath && !fs.existsSync(transcriptOutputPath)) {
    fs.mkdirSync(path.dirname(transcriptOutputPath), { recursive: true });
    fs.writeFileSync(transcriptOutputPath, transcript, 'utf8');
    logStep(options, `createWhisperSubtitleFile: saved transcript ${transcriptOutputPath}`);
  }

  logStep(options, 'createWhisperSubtitleFile: Step 1 complete');
  return {
    transcript,
    transcriptOutputPath
  };
}
