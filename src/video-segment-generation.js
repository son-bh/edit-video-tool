const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  SubtitleGenerationError,
  ValidationError,
  TimingError,
  getFfmpegCommand,
  parseSrtCues,
  formatSrtTimestamp
} = require('./subtitle-generation');

const DEFAULT_DURATION_TOLERANCE_SECONDS = 0.25;
const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi'
]);

class VideoSegmentGenerationError extends SubtitleGenerationError {
  constructor(message) {
    super(message, 'VIDEO_SEGMENT_ERROR');
  }
}

function logInfo(options = {}, message) {
  if (options.logger && typeof options.logger.info === 'function') {
    options.logger.info(message);
  }
}

function parseSegmentSrtText(srtText, options = {}) {
  let cues;

  try {
    cues = parseSrtCues(srtText);
  } catch (error) {
    throw new ValidationError(`Invalid SRT input: ${error.message}`);
  }

  if (cues.length === 0) {
    throw new ValidationError('SRT file must contain at least one cue.');
  }

  return cues.map((cue, index) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start) {
      throw new TimingError(`SRT cue ${index + 1} has invalid timing.`);
    }

    return {
      index: index + 1,
      start: cue.start,
      end: cue.end,
      duration: cue.end - cue.start,
      text: cue.text
    };
  });
}

function buildSegmentTimeline(cues, options = {}) {
  const preserveTimelineGaps = options.preserveTimelineGaps !== false;

  if (!preserveTimelineGaps) {
    return cues.map((cue) => ({ ...cue, segmentDuration: cue.duration }));
  }

  return cues.map((cue, index) => {
    const segmentStart = index === 0 ? 0 : cue.start;
    const segmentEnd = index < cues.length - 1 ? cues[index + 1].start : cue.end;
    const segmentDuration = segmentEnd - segmentStart;

    if (!Number.isFinite(segmentDuration) || segmentDuration <= 0) {
      throw new TimingError(`SRT cue ${cue.index} has invalid timeline spacing.`);
    }

    return {
      ...cue,
      segmentStart,
      segmentEnd,
      segmentDuration
    };
  });
}

function parseSegmentSrtFile(srtPath, options = {}) {
  logInfo(options, `parseSegmentSrtFile: reading ${srtPath}`);

  if (!fs.existsSync(srtPath)) {
    throw new ValidationError(`SRT file cannot be found: ${srtPath}`);
  }

  const stats = fs.statSync(srtPath);
  if (!stats.isFile()) {
    throw new ValidationError(`SRT path is not a file: ${srtPath}`);
  }

  return parseSegmentSrtText(fs.readFileSync(srtPath, 'utf8'), options);
}

function discoverSourceVideos(videoDir, options = {}) {
  logInfo(options, `discoverSourceVideos: scanning ${videoDir}`);

  if (!fs.existsSync(videoDir)) {
    throw new VideoSegmentGenerationError(`Video folder cannot be found: ${videoDir}`);
  }

  const stats = fs.statSync(videoDir);
  if (!stats.isDirectory()) {
    throw new VideoSegmentGenerationError(`Video path is not a folder: ${videoDir}`);
  }

  const videos = fs.readdirSync(videoDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => SUPPORTED_VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.resolve(videoDir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));

  if (videos.length === 0) {
    throw new VideoSegmentGenerationError(`No supported source videos found in ${videoDir}.`);
  }

  logInfo(options, `discoverSourceVideos: found ${videos.length} source videos`);
  return videos;
}

function selectVideoForCue(cueIndex, sourceVideos, options = {}) {
  const zeroBasedIndex = cueIndex - 1;

  if (zeroBasedIndex < sourceVideos.length) {
    return sourceVideos[zeroBasedIndex];
  }

  if (options.loopVideos) {
    return sourceVideos[zeroBasedIndex % sourceVideos.length];
  }

  throw new VideoSegmentGenerationError(
    `Missing source video for subtitle cue ${cueIndex}; only ${sourceVideos.length} source videos were found.`
  );
}

function createSegmentPlan(cue, sourceVideo, sourceDuration, options = {}) {
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

  const parts = [];
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

function getFfprobeCommand(options = {}) {
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

function runCommand(command, args, options = {}) {
  if (typeof options.commandRunner === 'function') {
    return options.commandRunner(command, args);
  }

  return execFileSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 32
  });
}

function probeVideoDuration(videoPath, options = {}) {
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
    const stderr = error.stderr ? error.stderr.toString('utf8').trim() : '';
    const detail = stderr ? ` ${stderr}` : ` ${error.message || error}`;
    throw new VideoSegmentGenerationError(`ffprobe could not read video duration for ${videoPath}.${detail}`);
  }
}

function ensureOutputDir(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function buildOutputSegmentPath(outputDir, cueIndex) {
  return path.join(outputDir, `segment-${String(cueIndex).padStart(3, '0')}.mp4`);
}

function runFfmpeg(args, options = {}) {
  const ffmpegCommand = getFfmpegCommand(options);
  logInfo(options, `ffmpeg: ${args.join(' ')}`);

  try {
    runCommand(ffmpegCommand, args, options);
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString('utf8').trim() : '';
    const detail = stderr ? ` ${stderr}` : ` ${error.message || error}`;
    throw new VideoSegmentGenerationError(`ffmpeg failed.${detail}`);
  }
}

function formatSeconds(seconds) {
  return seconds.toFixed(3);
}

function cutVideo(inputPath, outputPath, duration, options = {}) {
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

function copyVideo(inputPath, outputPath, options = {}) {
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

function escapeConcatFilePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function writeConcatListFile(listPath, partPaths) {
  const contents = partPaths
    .map((partPath) => `file '${escapeConcatFilePath(partPath)}'`)
    .join('\n') + '\n';
  fs.writeFileSync(listPath, contents, 'utf8');
}

function concatVideos(partPaths, outputPath, options = {}) {
  const listPath = options.concatListPath || path.join(options.tempDir || os.tmpdir(), `concat-list-${process.pid}.txt`);
  writeConcatListFile(listPath, partPaths);
  const shouldReencodeVideo = options.reencodeVideo === true;
  let outputArgs;

  if (shouldReencodeVideo) {
    outputArgs = [
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

function executeSegmentPlan(plan, outputPath, options = {}) {
  const requestedDuration = plan.cue.segmentDuration ?? plan.cue.duration;
  logInfo(
    options,
    `executeSegmentPlan: cue ${plan.cue.index}, ${plan.operation}, ${formatSrtTimestamp(plan.cue.start)} --> ${formatSrtTimestamp(plan.cue.end)}, requested ${formatSeconds(requestedDuration)}s`
  );

  if (plan.operation === 'copy') {
    copyVideo(plan.sourceVideo, outputPath, options);
    return;
  }

  if (plan.operation === 'cut') {
    cutVideo(plan.sourceVideo, outputPath, requestedDuration, options);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), `video-segment-${plan.cue.index}-`));

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

function validateOutputDuration(outputPath, expectedDuration, options = {}) {
  const tolerance = options.durationToleranceSeconds ?? DEFAULT_DURATION_TOLERANCE_SECONDS;
  const actualDuration = probeVideoDuration(outputPath, options);

  if (Math.abs(actualDuration - expectedDuration) > tolerance) {
    throw new VideoSegmentGenerationError(
      `Generated segment duration mismatch for ${outputPath}: expected ${formatSeconds(expectedDuration)}s, got ${formatSeconds(actualDuration)}s.`
    );
  }

  return actualDuration;
}

function computeExpectedConcatDuration(segmentPaths, options = {}) {
  return segmentPaths.reduce((total, segmentPath) => total + probeVideoDuration(segmentPath, options), 0);
}

function getConcatDurationTolerance(segmentCount, options = {}) {
  const baseTolerance = options.durationToleranceSeconds ?? DEFAULT_DURATION_TOLERANCE_SECONDS;
  return Math.max(baseTolerance, Math.min(5, segmentCount * 0.05));
}

function generateVideoSegments(options) {
  const loggerOptions = { ...options, logger: options.logger };
  logInfo(loggerOptions, 'generateVideoSegments: start');
  const cues = buildSegmentTimeline(parseSegmentSrtFile(options.srtPath, loggerOptions), options);
  const sourceVideos = discoverSourceVideos(options.videoDir, loggerOptions);
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

    logInfo(loggerOptions, `generateVideoSegments: cue ${cue.index}/${cues.length}, source ${sourceVideo}, output ${outputPath}`);
    executeSegmentPlan(plan, outputPath, loggerOptions);
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

  logInfo(loggerOptions, `generateVideoSegments: complete with ${outputs.length} segments`);
  return {
    cues,
    sourceVideos,
    outputs
  };
}

function concatSegmentFolder(options) {
  const loggerOptions = { ...options, logger: options.logger };
  const segmentDir = options.segmentDir;
  const outputPath = options.outputPath;

  if (!segmentDir) {
    throw new ValidationError('Missing segment folder for final concat.');
  }

  if (!outputPath) {
    throw new ValidationError('Missing output path for final video.');
  }

  logInfo(loggerOptions, `concatSegmentFolder: reading ${segmentDir}`);
  const segmentPaths = discoverSourceVideos(segmentDir, loggerOptions);
  const stripAudio = options.stripAudio !== false;
  const expectedDuration = computeExpectedConcatDuration(segmentPaths, options);
  const concatTolerance = getConcatDurationTolerance(segmentPaths.length, options);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  logInfo(loggerOptions, `concatSegmentFolder: concatenating ${segmentPaths.length} segments into ${outputPath}`);
  concatVideos(segmentPaths, outputPath, {
    ...loggerOptions,
    stripAudio,
    reencodeVideo: true
  });

  const actualDuration = probeVideoDuration(outputPath, options);
  if (Math.abs(actualDuration - expectedDuration) > concatTolerance) {
    throw new VideoSegmentGenerationError(
      `Final video duration mismatch for ${outputPath}: expected ${formatSeconds(expectedDuration)}s from ${segmentPaths.length} segments, got ${formatSeconds(actualDuration)}s.`
    );
  }
  logInfo(loggerOptions, `concatSegmentFolder: complete, final duration ${formatSeconds(actualDuration)}s`);

  return {
    segmentPaths,
    outputPath,
    actualDuration,
    expectedDuration
  };
}

module.exports = {
  DEFAULT_DURATION_TOLERANCE_SECONDS,
  SUPPORTED_VIDEO_EXTENSIONS,
  VideoSegmentGenerationError,
  parseSegmentSrtText,
  buildSegmentTimeline,
  parseSegmentSrtFile,
  discoverSourceVideos,
  selectVideoForCue,
  createSegmentPlan,
  getFfprobeCommand,
  probeVideoDuration,
  buildOutputSegmentPath,
  cutVideo,
  copyVideo,
  concatVideos,
  executeSegmentPlan,
  validateOutputDuration,
  computeExpectedConcatDuration,
  getConcatDurationTolerance,
  generateVideoSegments,
  concatSegmentFolder
};
