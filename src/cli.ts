#!/usr/bin/env node

import { loadEnvFile } from './env';
import { createLogger } from './logger';
import {
  SubtitleGenerationError,
  createWhisperSubtitleFile,
  generateSubtitles
} from './subtitle-generation';
import {
  DEFAULT_ASPECT_RATIO,
  concatSegmentFolder,
  generateVideoSegments,
  resolveVideoRenderPreset
} from './video-segment-generation';

loadEnvFile();

type ParsedArgs = Record<string, string | boolean | undefined> & {
  help?: boolean;
  transcribeOnly?: boolean;
  quiet?: boolean;
  loopVideos?: boolean;
};

const VALUE_FLAGS = new Set([
  '--json',
  '--audio',
  '--out',
  '--srt',
  '--videos',
  '--segments-out',
  '--concat-segments',
  '--final-out',
  '--ffmpeg',
  '--ffprobe',
  '--whisper-command',
  '--whisper-model',
  '--language',
  '--transcript-in',
  '--transcript-out',
  '--duration-tolerance',
  '--aspect-ratio'
]);

function printUsage(): void {
  console.log([
    'Usage: node dist/src/cli.js --json <subtitles.json|subtitles.txt> --audio <audio-or-video> --out <output.srt>',
    '       node dist/src/cli.js --srt <script.srt> --videos <video-folder> --segments-out <output-folder>',
    '       node dist/src/cli.js --concat-segments <segment-folder> --final-out <output-video>',
    '',
    'Options:',
    '  --json   Path to a subtitle script file in .json or .txt format',
    '  --audio  Path to an audio/video file. PCM WAV is read directly; other formats require ffmpeg',
    '  --out    Path for the generated SRT subtitle file',
    '  --srt    Path to an existing SRT file for video segment generation',
    '  --videos Path to a folder of source videos for video segment generation',
    '  --segments-out Path to write generated video segments',
    '  --concat-segments Path to a folder of generated segment videos to concatenate',
    '  --final-out Path for the concatenated final video output',
    '  --ffmpeg Optional ffmpeg command or path. Defaults to FFMPEG_PATH from .env or ffmpeg on PATH',
    '  --ffprobe Optional ffprobe command or path. Defaults to FFPROBE_PATH from .env or ffprobe next to ffmpeg',
    '  --whisper-command Optional Whisper command or path. Defaults to WHISPER_COMMAND_PATH from .env or whisper on PATH',
    '  --whisper-model Optional Whisper model name/path. Python Whisper defaults to turbo. ffmpeg Whisper uses WHISPER_MODEL_PATH for model files',
    '  --language Optional transcription language for Whisper, default auto',
    '  --transcript-in Optional existing Whisper SRT transcript to map instead of transcribing again',
    '  --transcript-out Optional path to save the raw Whisper SRT transcript',
    '  --transcribe-only Create only the raw Whisper transcript and skip JSON mapping',
    '  --duration-tolerance Optional duration tolerance in seconds for generated video segments',
    '  --aspect-ratio Optional final render aspect ratio for concat outputs: 16:9 or 9:16',
    '  --loop-videos Reuse source videos from the beginning if there are more SRT cues than videos',
    '  --quiet Disable progress logs'
  ].join('\n'));
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (flag === '--help' || flag === '-h') {
      args.help = true;
      continue;
    }

    if (flag === '--transcribe-only') {
      args.transcribeOnly = true;
      continue;
    }

    if (flag === '--quiet') {
      args.quiet = true;
      continue;
    }

    if (flag === '--loop-videos') {
      args.loopVideos = true;
      continue;
    }

    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }

    args[flag.slice(2)] = value;
    index += 1;
  }

  return args;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  let args: ParsedArgs;

  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    printUsage();
    return 2;
  }

  if (args.help) {
    printUsage();
    return 0;
  }

  const isConcatSegments = Boolean(args['concat-segments'] || args['final-out']);
  const isSegmentGeneration = Boolean(args.srt || args.videos || args['segments-out']);

  if (isConcatSegments && (!args['concat-segments'] || !args['final-out'])) {
    console.error('Missing required final concat arguments.');
    printUsage();
    return 2;
  }

  if (isSegmentGeneration && (!args.srt || !args.videos || !args['segments-out'])) {
    console.error('Missing required segment generation arguments.');
    printUsage();
    return 2;
  }

  if (!isSegmentGeneration && !isConcatSegments && args.transcribeOnly && !args.audio) {
    console.error('Missing required --audio argument.');
    printUsage();
    return 2;
  }

  if (!isSegmentGeneration && !isConcatSegments && !args.transcribeOnly && (!args.json || !args.audio || !args.out)) {
    console.error('Missing required arguments.');
    printUsage();
    return 2;
  }

  try {
    const logger = createLogger({ quiet: Boolean(args.quiet) });
    const aspectRatio = String(args['aspect-ratio'] || DEFAULT_ASPECT_RATIO);

    if (args['aspect-ratio']) {
      resolveVideoRenderPreset(aspectRatio);
    }

    if (isConcatSegments) {
      const result = concatSegmentFolder({
        segmentDir: String(args['concat-segments']),
        outputPath: String(args['final-out']),
        ffmpegPath: args.ffmpeg as string | undefined,
        ffprobePath: args.ffprobe as string | undefined,
        aspectRatio,
        logger
      });

      console.log(`Concatenated ${result.segmentPaths.length} segments into ${String(args['final-out'])} (${result.videoRenderPreset.label}, ${result.videoRenderPreset.key})`);
      return 0;
    }

    if (isSegmentGeneration) {
      const durationToleranceSeconds = args['duration-tolerance'] ? Number(args['duration-tolerance']) : undefined;

      if (args['duration-tolerance'] && (!Number.isFinite(durationToleranceSeconds) || (durationToleranceSeconds ?? 0) < 0)) {
        console.error('Invalid --duration-tolerance value.');
        printUsage();
        return 2;
      }

      const result = generateVideoSegments({
        srtPath: String(args.srt),
        videoDir: String(args.videos),
        outputDir: String(args['segments-out']),
        ffmpegPath: args.ffmpeg as string | undefined,
        ffprobePath: args.ffprobe as string | undefined,
        loopVideos: Boolean(args.loopVideos),
        durationToleranceSeconds,
        logger
      });

      console.log(`Generated ${result.outputs.length} video segments at ${String(args['segments-out'])}`);
      return 0;
    }

    const outputPath = args.out ? String(args.out) : '';
    const audioPath = String(args.audio);
    const defaultTranscriptOut = String(args['transcript-out'] || (outputPath
      ? outputPath.replace(/(\.[^./\\]+)?$/, '.whisper.srt')
      : audioPath.replace(/(\.[^./\\]+)?$/, '.whisper.srt')));
    const alignment = {
      ffmpegPath: args.ffmpeg as string | undefined,
      whisperCommandPath: args['whisper-command'] as string | undefined,
      whisperModel: args['whisper-model'] as string | undefined,
      whisperModelPath: process.env.WHISPER_MODEL_PATH,
      language: args.language as string | undefined,
      transcriptInputPath: args['transcript-in'] as string | undefined,
      transcriptOutputPath: defaultTranscriptOut,
      logger
    };

    if (args.transcribeOnly) {
      createWhisperSubtitleFile(audioPath, alignment);
      console.log(`Saved Whisper transcript at ${defaultTranscriptOut}`);
      return 0;
    }

    const result = generateSubtitles({
      jsonPath: String(args.json),
      audioPath,
      outputPath,
      alignment
    });

    console.log(`Generated ${result.cues.length} subtitle cues at ${outputPath}`);
    if (!args['transcript-in']) {
      console.log(`Saved Whisper transcript at ${defaultTranscriptOut}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof SubtitleGenerationError) {
      console.error(`${error.code}: ${error.message}`);
      return 1;
    }

    console.error((error as Error).stack || (error as Error).message);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}
