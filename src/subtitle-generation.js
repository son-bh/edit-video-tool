const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_MAX_ITEMS = 100;
const DEFAULT_FFMPEG_COMMAND = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const DEFAULT_WHISPER_COMMAND = process.platform === 'win32' ? 'whisper.exe' : 'whisper';

function logStep(options = {}, message) {
  if (options.logger && typeof options.logger.info === 'function') {
    options.logger.info(message);
  }
}

class SubtitleGenerationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

class ValidationError extends SubtitleGenerationError {
  constructor(message) {
    super(message, 'VALIDATION_ERROR');
  }
}

class AudioAnalysisError extends SubtitleGenerationError {
  constructor(message) {
    super(message, 'AUDIO_ANALYSIS_ERROR');
  }
}

class AlignmentMismatchError extends SubtitleGenerationError {
  constructor(message) {
    super(message, 'ALIGNMENT_MISMATCH');
  }
}

class TimingError extends SubtitleGenerationError {
  constructor(message) {
    super(message, 'TIMING_ERROR');
  }
}

function parseSubtitleItems(jsonText, options = {}) {
  logStep(options, 'parseSubtitleItems: parsing JSON text');
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  let parsed;

  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new ValidationError(`Invalid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new ValidationError('Subtitle JSON must be an array of items.');
  }

  if (parsed.length > maxItems) {
    throw new ValidationError(`Subtitle JSON contains ${parsed.length} items; the current limit is ${maxItems} items.`);
  }

  logStep(options, `parseSubtitleItems: validating ${parsed.length} subtitle items`);
  return parsed.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new ValidationError(`Item ${index + 1} must be an object with a non-empty text field.`);
    }

    if (typeof item.text !== 'string' || item.text.trim().length === 0) {
      throw new ValidationError(`Item ${index + 1} must include a non-empty text string.`);
    }

    return { text: item.text };
  });
}

function parseSubtitleJsonFile(jsonPath, options = {}) {
  logStep(options, `parseSubtitleJsonFile: reading ${jsonPath}`);
  return parseSubtitleItems(fs.readFileSync(jsonPath, 'utf8'), options);
}

function validateAudioFile(audioPath, options = {}) {
  logStep(options, `validateAudioFile: checking ${audioPath}`);
  let stats;

  try {
    stats = fs.statSync(audioPath);
  } catch (error) {
    throw new AudioAnalysisError(`Audio file cannot be found: ${audioPath}`);
  }

  if (!stats.isFile()) {
    throw new AudioAnalysisError(`Audio path is not a file: ${audioPath}`);
  }

  try {
    fs.accessSync(audioPath, fs.constants.R_OK);
  } catch (error) {
    throw new AudioAnalysisError(`Audio file cannot be read: ${audioPath}`);
  }
}

function isRiffWaveBuffer(buffer) {
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
}

function getFfmpegCommand(options = {}) {
  return options.ffmpegPath || process.env.FFMPEG_PATH || DEFAULT_FFMPEG_COMMAND;
}

function transcodeMediaToPcmWav(audioPath, options = {}) {
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
    const stderr = error.stderr ? error.stderr.toString('utf8').trim() : '';
    const detail = stderr ? ` ${stderr}` : '';
    throw new AudioAnalysisError(
      `Audio file is not a supported PCM WAV file and ffmpeg could not decode it. ` +
      `Set FFMPEG_PATH in .env, add ffmpeg to PATH, or pass --ffmpeg.${detail}`
    );
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function loadAudioAsPcmWavBuffer(audioPath, options = {}) {
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

function parseWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new AudioAnalysisError('Audio file must decode to a RIFF/WAVE PCM file.');
  }

  let offset = 12;
  let format = null;
  let dataOffset = null;
  let dataSize = null;

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

function sampleAmplitude(buffer, byteOffset, bitsPerSample) {
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

function detectSpeechSegmentsFromWav(buffer, options = {}) {
  const wav = parseWav(buffer);
  logStep(options, `detectSpeechSegmentsFromWav: analyzing ${wav.frameCount} frames at ${wav.sampleRate} Hz`);
  const frameDurationMs = options.frameDurationMs ?? 20;
  const threshold = options.threshold ?? 0.02;
  const minSpeechMs = options.minSpeechMs ?? 80;
  const maxSilenceGapMs = options.maxSilenceGapMs ?? 120;
  const samplesPerWindow = Math.max(1, Math.floor(wav.sampleRate * frameDurationMs / 1000));
  const bytesPerSample = wav.bitsPerSample / 8;
  const rawSegments = [];
  let activeStartFrame = null;

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

  const mergedSegments = [];
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

function groupSegmentsToItemCount(segments, itemsOrItemCount, options = {}) {
  const items = Array.isArray(itemsOrItemCount) ? itemsOrItemCount : null;
  const itemCount = items ? items.length : itemsOrItemCount;

  if (segments.length < itemCount) {
    throw new AlignmentMismatchError(
      `Audio analysis found ${segments.length} speech segments, but JSON contains ${itemCount} subtitle items.`
    );
  }

  if (segments.length === itemCount) {
    return segments;
  }

  const boundaryCount = itemCount - 1;
  const minBoundaryGapSeconds = options.minBoundaryGapSeconds ?? 0.3;
  const maxCharsPerSecond = options.maxCharsPerSecond ?? 22;
  const gaps = [];

  for (let index = 1; index < segments.length; index += 1) {
    gaps.push({
      index,
      gap: segments[index].start - segments[index - 1].end,
      time: segments[index - 1].end
    });
  }

  let boundaries;

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
          `Audio analysis could not find a reliable boundary after JSON item ${itemIndex + 1}.`
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

  const groupedSegments = [];
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

function escapeFilterValue(value) {
  return String(value)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

function getWhisperModelPath(options = {}) {
  return options.whisperModelPath || process.env.WHISPER_MODEL_PATH || null;
}

function getWhisperCommand(options = {}) {
  return options.whisperCommandPath || process.env.WHISPER_COMMAND_PATH || DEFAULT_WHISPER_COMMAND;
}

function shouldUseTranscriptAlignment(options = {}) {
  if (options.useTranscript === false) {
    return false;
  }

  const whisperCommand = getWhisperCommand(options);
  return Boolean(options.useTranscript || getWhisperModelPath(options) || fs.existsSync(whisperCommand));
}

function transcribeAudioToSrtWithWhisperCommand(audioPath, options = {}) {
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
    args.push('--model', options.whisperModel || options.whisperModelPath);
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
    const stderr = error.stderr ? error.stderr.toString('utf8').trim() : '';
    const detail = stderr ? ` ${stderr}` : '';
    throw new AudioAnalysisError(`Python Whisper transcription failed.${detail}`);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

function transcribeAudioToSrtWithFfmpegWhisper(audioPath, options = {}) {
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
    const stderr = error.stderr ? error.stderr.toString('utf8').trim() : '';
    const detail = stderr ? ` ${stderr}` : '';
    throw new AudioAnalysisError(`ffmpeg whisper transcription failed.${detail}`);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function transcribeAudioToSrt(audioPath, options = {}) {
  const whisperCommand = getWhisperCommand(options);
  logStep(options, 'transcribeAudioToSrt: selecting transcription backend');

  if (fs.existsSync(whisperCommand) || options.whisperCommandPath || process.env.WHISPER_COMMAND_PATH) {
    logStep(options, 'transcribeAudioToSrt: using Python Whisper command backend');
    return transcribeAudioToSrtWithWhisperCommand(audioPath, options);
  }

  logStep(options, 'transcribeAudioToSrt: using ffmpeg whisper filter backend');
  return transcribeAudioToSrtWithFfmpegWhisper(audioPath, options);
}

function createWhisperSubtitleFile(audioPath, options = {}) {
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

function parseSrtTimestamp(value) {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);

  if (!match) {
    throw new AudioAnalysisError(`Invalid SRT timestamp: ${value}`);
  }

  return Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000;
}

function parseSrtCues(srtText) {
  const cues = srtText
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const timingLineIndex = lines.findIndex((line) => line.includes('-->'));

      if (timingLineIndex === -1) {
        throw new AudioAnalysisError('Transcript SRT contains a cue without a timing line.');
      }

      const [startText, endText] = lines[timingLineIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
      const text = lines.slice(timingLineIndex + 1).join(' ').trim();

      return {
        start: parseSrtTimestamp(startText),
        end: parseSrtTimestamp(endText),
        text
      };
    });
  return cues;
}

function normalizeForTranscriptMatch(value) {
  return String(value)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildTranscriptWindows(transcriptCues, startIndex, maxWindowSize) {
  const windows = [];
  let text = '';

  for (let endIndex = startIndex; endIndex < transcriptCues.length && endIndex < startIndex + maxWindowSize; endIndex += 1) {
    text = [text, transcriptCues[endIndex].text].filter(Boolean).join(' ');
    windows.push({
      startIndex,
      endIndex,
      start: transcriptCues[startIndex].start,
      end: transcriptCues[endIndex].end,
      text
    });
  }

  return windows;
}

function buildTranscriptTimeline(transcriptCues) {
  let text = '';
  const ranges = [];

  for (const cue of transcriptCues) {
    const normalizedText = normalizeForTranscriptMatch(cue.text);

    if (!normalizedText) {
      continue;
    }

    if (text) {
      text += ' ';
    }

    const startOffset = text.length;
    text += normalizedText;
    ranges.push({
      startOffset,
      endOffset: text.length,
      start: cue.start,
      end: cue.end
    });
  }

  return { text, ranges };
}

function interpolateTimelineTime(timeline, offset, preferEnd = false) {
  const range = timeline.ranges.find((candidate) => offset >= candidate.startOffset && offset <= candidate.endOffset);

  if (!range) {
    return preferEnd
      ? timeline.ranges[timeline.ranges.length - 1].end
      : timeline.ranges[0].start;
  }

  const span = Math.max(1, range.endOffset - range.startOffset);
  const ratio = Math.max(0, Math.min(1, (offset - range.startOffset) / span));
  return range.start + (range.end - range.start) * ratio;
}

function alignItemsToTranscriptTimeline(items, transcriptCues) {
  const timeline = buildTranscriptTimeline(transcriptCues);

  if (!timeline.text || timeline.ranges.length === 0) {
    throw new AlignmentMismatchError('Transcript contains no text to align.');
  }

  const aligned = [];
  let searchOffset = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const normalizedItem = normalizeForTranscriptMatch(items[itemIndex].text);
    const matchOffset = timeline.text.indexOf(normalizedItem, searchOffset);

    if (matchOffset === -1) {
      throw new AlignmentMismatchError(`Transcript text did not match JSON item ${itemIndex + 1}: ${items[itemIndex].text}`);
    }

    const matchEndOffset = matchOffset + normalizedItem.length;
    aligned.push({
      start: interpolateTimelineTime(timeline, matchOffset),
      end: interpolateTimelineTime(timeline, matchEndOffset, true),
      text: items[itemIndex].text
    });
    searchOffset = matchEndOffset;
  }

  return aligned;
}

function appendNormalizedText(left, right) {
  return [left, right].filter(Boolean).join(' ').trim();
}

function alignItemsToAccumulatedTranscript(items, transcriptCues, options = {}) {
  logStep(options, `alignItemsToAccumulatedTranscript: mapping ${items.length} JSON items against ${transcriptCues.length} Whisper cues`);
  const aligned = [];
  let transcriptIndex = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const targetText = normalizeForTranscriptMatch(items[itemIndex].text);
    let accumulatedText = '';
    let startTime = null;
    let endTime = null;
    let matched = false;

    while (transcriptIndex < transcriptCues.length) {
      const cue = transcriptCues[transcriptIndex];
      const cueText = normalizeForTranscriptMatch(cue.text);

      if (!cueText) {
        transcriptIndex += 1;
        continue;
      }

      if (startTime === null) {
        startTime = cue.start;
      }

      accumulatedText = appendNormalizedText(accumulatedText, cueText);
      endTime = cue.end;
      transcriptIndex += 1;

      if (accumulatedText === targetText) {
        aligned.push({
          start: startTime,
          end: endTime,
          text: items[itemIndex].text
        });
        logStep(options, `alignItemsToAccumulatedTranscript: matched item ${itemIndex + 1}/${items.length} at ${formatSrtTimestamp(startTime)} --> ${formatSrtTimestamp(endTime)}`);
        matched = true;
        break;
      }

      if (!targetText.startsWith(accumulatedText)) {
        break;
      }
    }

    if (!matched) {
      throw new AlignmentMismatchError(
        `Accumulated Whisper subtitle text did not match JSON item ${itemIndex + 1}: ${items[itemIndex].text}`
      );
    }
  }

  return aligned;
}

function buildTranscriptWordTimeline(transcriptCues) {
  const words = [];

  for (const cue of transcriptCues) {
    const cueWords = normalizeForTranscriptMatch(cue.text).split(' ').filter(Boolean);

    cueWords.forEach((word, index) => {
      const startRatio = index / Math.max(1, cueWords.length);
      const endRatio = (index + 1) / Math.max(1, cueWords.length);
      words.push({
        word,
        start: cue.start + (cue.end - cue.start) * startRatio,
        end: cue.start + (cue.end - cue.start) * endRatio
      });
    });
  }

  return words;
}

function tokenEditDistance(leftTokens, rightTokens) {
  const previous = Array.from({ length: rightTokens.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= leftTokens.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= rightTokens.length; rightIndex += 1) {
      const cost = leftTokens[leftIndex - 1] === rightTokens[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[rightTokens.length];
}

function scoreTokenWindow(itemWords, transcriptWords) {
  if (itemWords.length === 0 || transcriptWords.length === 0) {
    return 0;
  }

  const distance = tokenEditDistance(itemWords, transcriptWords);
  return 1 - distance / Math.max(itemWords.length, transcriptWords.length);
}

function findBestTokenWindow(itemWords, transcriptWords, startIndex, options = {}) {
  const lookaheadWords = options.lookaheadWords ?? 120;
  const minWindowFactor = options.minWindowFactor ?? 0.6;
  const maxWindowFactor = options.maxWindowFactor ?? 1.6;
  const minLength = Math.max(1, Math.floor(itemWords.length * minWindowFactor));
  const maxLength = Math.max(minLength, Math.ceil(itemWords.length * maxWindowFactor));
  const maxStart = Math.min(transcriptWords.length - 1, startIndex + lookaheadWords);
  let best = null;

  for (let candidateStart = startIndex; candidateStart <= maxStart; candidateStart += 1) {
    for (let length = minLength; length <= maxLength && candidateStart + length <= transcriptWords.length; length += 1) {
      const score = scoreTokenWindow(itemWords, transcriptWords.slice(candidateStart, candidateStart + length).map((token) => token.word));

      if (!best || score > best.score) {
        best = {
          startIndex: candidateStart,
          endIndex: candidateStart + length - 1,
          score
        };
      }
    }
  }

  return best;
}

function alignItemsToTranscriptWords(items, transcriptCues, options = {}) {
  logStep(options, `alignItemsToTranscriptWords: fuzzy mapping ${items.length} JSON items against ${transcriptCues.length} Whisper cues`);
  const transcriptWords = buildTranscriptWordTimeline(transcriptCues);
  const minTokenMatchScore = options.minTokenMatchScore ?? 0.55;
  const aligned = [];
  let wordIndex = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const itemWords = normalizeForTranscriptMatch(items[itemIndex].text).split(' ').filter(Boolean);
    const match = findBestTokenWindow(itemWords, transcriptWords, wordIndex, options);

    if (!match || match.score < minTokenMatchScore) {
      throw new AlignmentMismatchError(`Transcript text did not match JSON item ${itemIndex + 1}: ${items[itemIndex].text}`);
    }

    aligned.push({
      start: transcriptWords[match.startIndex].start,
      end: transcriptWords[match.endIndex].end,
      text: items[itemIndex].text
    });
    logStep(options, `alignItemsToTranscriptWords: matched item ${itemIndex + 1}/${items.length} with score ${match.score.toFixed(2)}`);
    wordIndex = match.endIndex + 1;
  }

  return aligned;
}

function alignItemsToTranscriptCues(items, transcriptCues, options = {}) {
  if (transcriptCues.length === 0) {
    throw new AlignmentMismatchError('Transcript contains no cues to align.');
  }

  const maxTranscriptCuesPerItem = options.maxTranscriptCuesPerItem ?? 4;
  const aligned = [];
  let transcriptIndex = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const normalizedItem = normalizeForTranscriptMatch(items[itemIndex].text);
    const windows = buildTranscriptWindows(transcriptCues, transcriptIndex, maxTranscriptCuesPerItem);
    const match = windows.find((window) => normalizeForTranscriptMatch(window.text).includes(normalizedItem));

    if (!match) {
      throw new AlignmentMismatchError(`Transcript text did not match JSON item ${itemIndex + 1}: ${items[itemIndex].text}`);
    }

    aligned.push({
      start: match.start,
      end: match.end,
      text: items[itemIndex].text
    });
    transcriptIndex = match.endIndex + 1;
  }

  return aligned;
}

function alignSubtitleItemsToTranscript(items, audioPath, options = {}) {
  logStep(options, 'alignSubtitleItemsToTranscript: Step 2 start from generated transcript text');
  const transcriptSrt = transcribeAudioToSrt(audioPath, options);
  const transcriptCues = parseSrtCues(transcriptSrt);
  logStep(options, `alignSubtitleItemsToTranscript: parsed ${transcriptCues.length} transcript cues`);
  return alignSubtitleItemsToTranscriptCues(items, transcriptCues, options);
}

function alignSubtitleItemsToTranscriptCues(items, transcriptCues, options = {}) {
  try {
    const cues = alignItemsToAccumulatedTranscript(items, transcriptCues, options);
    logStep(options, 'alignSubtitleItemsToTranscriptCues: accumulated segment mapping succeeded');
    return cues;
  } catch (error) {
    if (!(error instanceof AlignmentMismatchError)) {
      throw error;
    }

    try {
      logStep(options, 'alignSubtitleItemsToTranscriptCues: accumulated mapping failed, trying exact transcript timeline mapping');
      const cues = alignItemsToTranscriptTimeline(items, transcriptCues, options);
      logStep(options, 'alignSubtitleItemsToTranscriptCues: exact transcript timeline mapping succeeded');
      return cues;
    } catch (timelineError) {
      if (!(timelineError instanceof AlignmentMismatchError)) {
        throw timelineError;
      }

      logStep(options, 'alignSubtitleItemsToTranscriptCues: exact mapping failed, trying fuzzy word mapping');
      const cues = alignItemsToTranscriptWords(items, transcriptCues, options);
      logStep(options, 'alignSubtitleItemsToTranscriptCues: fuzzy word mapping succeeded');
      return cues;
    }
  }
}

function mapJsonItemsToTranscriptFile(items, transcriptPath, options = {}) {
  logStep(options, `mapJsonItemsToTranscriptFile: Step 2 reading ${transcriptPath}`);
  if (!fs.existsSync(transcriptPath)) {
    throw new AudioAnalysisError(`Transcript file cannot be found: ${transcriptPath}`);
  }

  const transcriptSrt = fs.readFileSync(transcriptPath, 'utf8');
  const transcriptCues = parseSrtCues(transcriptSrt);
  logStep(options, `mapJsonItemsToTranscriptFile: parsed ${transcriptCues.length} Whisper cues`);
  return alignSubtitleItemsToTranscriptCues(items, transcriptCues, options);
}

function alignSubtitleItemsToAudio(items, audioPath, options = {}) {
  logStep(options, 'alignSubtitleItemsToAudio: using fallback audio-energy alignment');
  const audioBuffer = loadAudioAsPcmWavBuffer(audioPath, options);
  const segments = detectSpeechSegmentsFromWav(audioBuffer, options);

  if (segments.length === 0) {
    throw new AlignmentMismatchError('Audio analysis found no speech segments to align.');
  }

  const alignedSegments = groupSegmentsToItemCount(segments, items, options);
  logStep(options, `alignSubtitleItemsToAudio: grouped ${segments.length} speech segments into ${alignedSegments.length} cues`);

  return items.map((item, index) => ({
    start: alignedSegments[index].start,
    end: alignedSegments[index].end,
    text: item.text
  }));
}

function validateCues(cues) {
  cues.forEach((cue, index) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) {
      throw new TimingError(`Cue ${index + 1} has invalid timing.`);
    }

    if (index > 0 && cue.start < cues[index - 1].end) {
      throw new TimingError(`Cue ${index + 1} overlaps unexpectedly with cue ${index}.`);
    }
  });
}

function formatSrtTimestamp(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const wholeSeconds = Math.floor((milliseconds % 60000) / 1000);
  const remainder = milliseconds % 1000;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(wholeSeconds).padStart(2, '0')
  ].join(':') + ',' + String(remainder).padStart(3, '0');
}

function formatSrt(cues) {
  validateCues(cues);

  return cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}`,
    cue.text
  ].join('\n')).join('\n\n') + '\n';
}

function generateSubtitles(options) {
  const alignmentOptions = options.alignment || {};
  logStep(alignmentOptions, 'generateSubtitles: start');
  const items = parseSubtitleJsonFile(options.jsonPath, { maxItems: options.maxItems, logger: alignmentOptions.logger });
  let cues;

  if (shouldUseTranscriptAlignment(alignmentOptions)) {
    logStep(alignmentOptions, 'generateSubtitles: transcript alignment enabled');
    const transcriptPath = alignmentOptions.transcriptInputPath || alignmentOptions.transcriptOutputPath;

    if (!transcriptPath) {
      throw new AudioAnalysisError('Transcript alignment requires a transcript path.');
    }

    if (!alignmentOptions.transcriptInputPath) {
      logStep(alignmentOptions, 'generateSubtitles: Step 1 creating Whisper transcript');
      createWhisperSubtitleFile(options.audioPath, {
        ...alignmentOptions,
        transcriptOutputPath: transcriptPath
      });
    }

    logStep(alignmentOptions, 'generateSubtitles: Step 2 mapping transcript to JSON');
    cues = mapJsonItemsToTranscriptFile(items, transcriptPath, alignmentOptions);
  } else {
    logStep(alignmentOptions, 'generateSubtitles: transcript alignment disabled, using fallback');
    cues = alignSubtitleItemsToAudio(items, options.audioPath, alignmentOptions);
  }

  logStep(alignmentOptions, `generateSubtitles: validating ${cues.length} cues`);
  validateCues(cues);

  const output = formatSrt(cues);
  logStep(alignmentOptions, `generateSubtitles: writing final SRT ${options.outputPath}`);
  fs.writeFileSync(options.outputPath, output, 'utf8');

  logStep(alignmentOptions, 'generateSubtitles: complete');
  return { cues, output };
}

module.exports = {
  DEFAULT_MAX_ITEMS,
  DEFAULT_FFMPEG_COMMAND,
  DEFAULT_WHISPER_COMMAND,
  SubtitleGenerationError,
  ValidationError,
  AudioAnalysisError,
  AlignmentMismatchError,
  TimingError,
  parseSubtitleItems,
  parseSubtitleJsonFile,
  validateAudioFile,
  isRiffWaveBuffer,
  getFfmpegCommand,
  getWhisperCommand,
  shouldUseTranscriptAlignment,
  transcodeMediaToPcmWav,
  loadAudioAsPcmWavBuffer,
  parseWav,
  detectSpeechSegmentsFromWav,
  groupSegmentsToItemCount,
  transcribeAudioToSrt,
  createWhisperSubtitleFile,
  transcribeAudioToSrtWithWhisperCommand,
  transcribeAudioToSrtWithFfmpegWhisper,
  parseSrtTimestamp,
  parseSrtCues,
  normalizeForTranscriptMatch,
  buildTranscriptTimeline,
  alignItemsToAccumulatedTranscript,
  alignItemsToTranscriptTimeline,
  buildTranscriptWordTimeline,
  tokenEditDistance,
  scoreTokenWindow,
  findBestTokenWindow,
  alignItemsToTranscriptWords,
  alignItemsToTranscriptCues,
  alignSubtitleItemsToTranscriptCues,
  alignSubtitleItemsToTranscript,
  mapJsonItemsToTranscriptFile,
  alignSubtitleItemsToAudio,
  validateCues,
  formatSrtTimestamp,
  formatSrt,
  generateSubtitles
};
