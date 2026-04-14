import fs from 'node:fs';

import { AlignmentMismatchError, AudioAnalysisError } from './errors';
import { detectSpeechSegmentsFromWav, groupSegmentsToItemCount, loadAudioAsPcmWavBuffer } from './audio';
import { logStep } from './logging';
import { formatSrt, parseSrtCues } from './srt';
import {
  appendNormalizedText,
  buildTranscriptTimeline,
  buildTranscriptWindows,
  buildTranscriptWordTimeline,
  ensureTranscriptHasText,
  interpolateTimelineTime,
  normalizeForTranscriptMatch
} from './transcript';
import type { AlignmentOptions, SrtCue, SubtitleItem, TranscriptWord } from './types';

export function alignItemsToTranscriptTimeline(items: SubtitleItem[], transcriptCues: SrtCue[]): SrtCue[] {
  const timeline = buildTranscriptTimeline(transcriptCues);
  ensureTranscriptHasText(timeline);
  const aligned: SrtCue[] = [];
  let searchOffset = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const normalizedItem = normalizeForTranscriptMatch(items[itemIndex].text);
    const matchOffset = timeline.text.indexOf(normalizedItem, searchOffset);

    if (matchOffset === -1) {
      throw new AlignmentMismatchError(`Transcript text did not match script item ${itemIndex + 1}: ${items[itemIndex].text}`);
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

export function alignItemsToAccumulatedTranscript(items: SubtitleItem[], transcriptCues: SrtCue[], options: AlignmentOptions = {}): SrtCue[] {
  logStep(options, `alignItemsToAccumulatedTranscript: mapping ${items.length} script items against ${transcriptCues.length} Whisper cues`);
  const aligned: SrtCue[] = [];
  let transcriptIndex = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const targetText = normalizeForTranscriptMatch(items[itemIndex].text);
    let accumulatedText = '';
    let startTime: number | null = null;
    let endTime: number | null = null;
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
        logStep(options, `alignItemsToAccumulatedTranscript: matched item ${itemIndex + 1}/${items.length} at ${startTime} -> ${endTime}`);
        matched = true;
        break;
      }

      if (!targetText.startsWith(accumulatedText)) {
        break;
      }
    }

    if (!matched) {
      throw new AlignmentMismatchError(
        `Accumulated Whisper subtitle text did not match script item ${itemIndex + 1}: ${items[itemIndex].text}`
      );
    }
  }

  return aligned;
}

function tokenEditDistance(leftTokens: string[], rightTokens: string[]): number {
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

function scoreTokenWindow(itemWords: string[], transcriptWords: string[]): number {
  if (itemWords.length === 0 || transcriptWords.length === 0) {
    return 0;
  }

  const distance = tokenEditDistance(itemWords, transcriptWords);
  return 1 - distance / Math.max(itemWords.length, transcriptWords.length);
}

function findBestTokenWindow(itemWords: string[], transcriptWords: TranscriptWord[], startIndex: number, options: AlignmentOptions = {}): { startIndex: number; endIndex: number; score: number } | null {
  const lookaheadWords = options.lookaheadWords ?? 120;
  const minWindowFactor = options.minWindowFactor ?? 0.6;
  const maxWindowFactor = options.maxWindowFactor ?? 1.6;
  const minLength = Math.max(1, Math.floor(itemWords.length * minWindowFactor));
  const maxLength = Math.max(minLength, Math.ceil(itemWords.length * maxWindowFactor));
  const maxStart = Math.min(transcriptWords.length - 1, startIndex + lookaheadWords);
  let best: { startIndex: number; endIndex: number; score: number } | null = null;

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

export function alignItemsToTranscriptWords(items: SubtitleItem[], transcriptCues: SrtCue[], options: AlignmentOptions = {}): SrtCue[] {
  logStep(options, `alignItemsToTranscriptWords: fuzzy mapping ${items.length} script items against ${transcriptCues.length} Whisper cues`);
  const transcriptWords = buildTranscriptWordTimeline(transcriptCues);
  const minTokenMatchScore = options.minTokenMatchScore ?? 0.55;
  const aligned: SrtCue[] = [];
  let wordIndex = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const itemWords = normalizeForTranscriptMatch(items[itemIndex].text).split(' ').filter(Boolean);
    const match = findBestTokenWindow(itemWords, transcriptWords, wordIndex, options);

    if (!match || match.score < minTokenMatchScore) {
      throw new AlignmentMismatchError(`Transcript text did not match script item ${itemIndex + 1}: ${items[itemIndex].text}`);
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

export function alignItemsToTranscriptCues(items: SubtitleItem[], transcriptCues: SrtCue[], options: AlignmentOptions = {}): SrtCue[] {
  if (transcriptCues.length === 0) {
    throw new AlignmentMismatchError('Transcript contains no cues to align.');
  }

  const maxTranscriptCuesPerItem = options.maxTranscriptCuesPerItem ?? 4;
  const aligned: SrtCue[] = [];
  let transcriptIndex = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const normalizedItem = normalizeForTranscriptMatch(items[itemIndex].text);
    const windows = buildTranscriptWindows(transcriptCues, transcriptIndex, maxTranscriptCuesPerItem);
    const match = windows.find((window) => normalizeForTranscriptMatch(window.text).includes(normalizedItem));

    if (!match) {
      throw new AlignmentMismatchError(`Transcript text did not match script item ${itemIndex + 1}: ${items[itemIndex].text}`);
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

export function alignSubtitleItemsToTranscriptCues(items: SubtitleItem[], transcriptCues: SrtCue[], options: AlignmentOptions = {}): SrtCue[] {
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
      const cues = alignItemsToTranscriptTimeline(items, transcriptCues);
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

export function mapJsonItemsToTranscriptFile(items: SubtitleItem[], transcriptPath: string, options: AlignmentOptions = {}): SrtCue[] {
  logStep(options, `mapJsonItemsToTranscriptFile: Step 2 reading ${transcriptPath}`);
  if (!fs.existsSync(transcriptPath)) {
    throw new AudioAnalysisError(`Transcript file cannot be found: ${transcriptPath}`);
  }

  const transcriptSrt = fs.readFileSync(transcriptPath, 'utf8');
  const transcriptCues = parseSrtCues(transcriptSrt);
  logStep(options, `mapJsonItemsToTranscriptFile: parsed ${transcriptCues.length} Whisper cues`);
  return alignSubtitleItemsToTranscriptCues(items, transcriptCues, options);
}

export function alignSubtitleItemsToAudio(items: SubtitleItem[], audioPath: string, options: AlignmentOptions = {}): SrtCue[] {
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
