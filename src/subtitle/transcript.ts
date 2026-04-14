import type { SrtCue, TranscriptTimeline, TranscriptWindow, TranscriptWord } from './types';
import { AlignmentMismatchError } from './errors';

export function normalizeForTranscriptMatch(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/[\u2018\u2019]/gu, '\'')
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function buildTranscriptWindows(transcriptCues: SrtCue[], startIndex: number, maxWindowSize: number): TranscriptWindow[] {
  const windows: TranscriptWindow[] = [];
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

export function buildTranscriptTimeline(transcriptCues: SrtCue[]): TranscriptTimeline {
  let text = '';
  const ranges: TranscriptTimeline['ranges'] = [];

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

export function interpolateTimelineTime(timeline: TranscriptTimeline, offset: number, preferEnd = false): number {
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

export function appendNormalizedText(left: string, right: string): string {
  return [left, right].filter(Boolean).join(' ').trim();
}

export function buildTranscriptWordTimeline(transcriptCues: SrtCue[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];

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

export function ensureTranscriptHasText(timeline: TranscriptTimeline): void {
  if (!timeline.text || timeline.ranges.length === 0) {
    throw new AlignmentMismatchError('Transcript contains no text to align.');
  }
}
