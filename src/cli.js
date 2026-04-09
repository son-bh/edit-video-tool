#!/usr/bin/env node

const {
  SubtitleGenerationError,
  createWhisperSubtitleFile,
  generateSubtitles
} = require('./subtitle-generation');
const { loadEnvFile } = require('./env');
const { createLogger } = require('./logger');
const { concatSegmentFolder, generateVideoSegments } = require('./video-segment-generation');

loadEnvFile();

function printUsage() {
  console.log([
    'Usage: node src/cli.js --json <subtitles.json> --audio <audio-or-video> --out <output.srt>',
    '       node src/cli.js --srt <script.srt> --videos <video-folder> --segments-out <output-folder>',
    '       node src/cli.js --concat-segments <segment-folder> --final-out <output-video>',
    '',
    'Options:',
    '  --json   Path to JSON array of subtitle text items',
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
    '  --loop-videos Reuse source videos from the beginning if there are more SRT cues than videos',
    '  --quiet Disable progress logs'
  ].join('\n'));
}

function parseArgs(argv) {
  const args = {};

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

    if (!['--json', '--audio', '--out', '--srt', '--videos', '--segments-out', '--concat-segments', '--final-out', '--ffmpeg', '--ffprobe', '--whisper-command', '--whisper-model', '--language', '--transcript-in', '--transcript-out', '--duration-tolerance'].includes(flag)) {
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

function main(argv = process.argv.slice(2)) {
  let args;

  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
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
    const logger = createLogger({ quiet: args.quiet });

    if (isConcatSegments) {
      const result = concatSegmentFolder({
        segmentDir: args['concat-segments'],
        outputPath: args['final-out'],
        ffmpegPath: args.ffmpeg,
        ffprobePath: args.ffprobe,
        logger
      });

      console.log(`Concatenated ${result.segmentPaths.length} segments into ${args['final-out']}`);
      return 0;
    }

    if (isSegmentGeneration) {
      const durationToleranceSeconds = args['duration-tolerance'] ? Number(args['duration-tolerance']) : undefined;

      if (args['duration-tolerance'] && (!Number.isFinite(durationToleranceSeconds) || durationToleranceSeconds < 0)) {
        console.error('Invalid --duration-tolerance value.');
        printUsage();
        return 2;
      }

      const result = generateVideoSegments({
        srtPath: args.srt,
        videoDir: args.videos,
        outputDir: args['segments-out'],
        ffmpegPath: args.ffmpeg,
        ffprobePath: args.ffprobe,
        loopVideos: args.loopVideos,
        durationToleranceSeconds,
        logger
      });

      console.log(`Generated ${result.outputs.length} video segments at ${args['segments-out']}`);
      return 0;
    }

    const defaultTranscriptOut = args['transcript-out'] || (args.out
      ? args.out.replace(/(\.[^./\\]+)?$/, '.whisper.srt')
      : args.audio.replace(/(\.[^./\\]+)?$/, '.whisper.srt'));
    const alignment = {
      ffmpegPath: args.ffmpeg,
      whisperCommandPath: args['whisper-command'],
      whisperModel: args['whisper-model'],
      whisperModelPath: process.env.WHISPER_MODEL_PATH,
      language: args.language,
      transcriptInputPath: args['transcript-in'],
      transcriptOutputPath: defaultTranscriptOut,
      logger
    };

    if (args.transcribeOnly) {
      createWhisperSubtitleFile(args.audio, alignment);
      console.log(`Saved Whisper transcript at ${defaultTranscriptOut}`);
      return 0;
    }

    const result = generateSubtitles({
      jsonPath: args.json,
      audioPath: args.audio,
      outputPath: args.out,
      alignment
    });

    console.log(`Generated ${result.cues.length} subtitle cues at ${args.out}`);
    if (!args['transcript-in']) {
      console.log(`Saved Whisper transcript at ${defaultTranscriptOut}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof SubtitleGenerationError) {
      console.error(`${error.code}: ${error.message}`);
      return 1;
    }

    console.error(error.stack || error.message);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, parseArgs };
