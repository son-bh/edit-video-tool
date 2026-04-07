#!/usr/bin/env node

const {
  SubtitleGenerationError,
  createWhisperSubtitleFile,
  generateSubtitles
} = require('./subtitle-generation');
const { createLogger } = require('./logger');

function printUsage() {
  console.log([
    'Usage: node src/cli.js --json <subtitles.json> --audio <audio-or-video> --out <output.srt>',
    '',
    'Options:',
    '  --json   Path to JSON array of subtitle text items',
    '  --audio  Path to an audio/video file. PCM WAV is read directly; other formats require ffmpeg',
    '  --out    Path for the generated SRT subtitle file',
    '  --ffmpeg Optional path to ffmpeg executable. Defaults to C:\\ffmpeg\\bin\\ffmpeg.exe, with FFMPEG_PATH also supported',
    '  --whisper-command Optional path to Python whisper executable. Defaults to C:\\Users\\sonbh\\AppData\\Local\\Python\\pythoncore-3.14-64\\Scripts\\whisper.exe',
    '  --whisper-model Optional Whisper model name/path. Python Whisper defaults to turbo. ffmpeg Whisper uses WHISPER_MODEL_PATH for model files',
    '  --language Optional transcription language for Whisper, default auto',
    '  --transcript-in Optional existing Whisper SRT transcript to map instead of transcribing again',
    '  --transcript-out Optional path to save the raw Whisper SRT transcript',
    '  --transcribe-only Create only the raw Whisper transcript and skip JSON mapping',
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

    if (!['--json', '--audio', '--out', '--ffmpeg', '--whisper-command', '--whisper-model', '--language', '--transcript-in', '--transcript-out'].includes(flag)) {
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

  if (args.transcribeOnly && !args.audio) {
    console.error('Missing required --audio argument.');
    printUsage();
    return 2;
  }

  if (!args.transcribeOnly && (!args.json || !args.audio || !args.out)) {
    console.error('Missing required arguments.');
    printUsage();
    return 2;
  }

  try {
    const logger = createLogger({ quiet: args.quiet });
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
