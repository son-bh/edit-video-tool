import fs from 'node:fs';

import { parseSrtCues } from '../subtitle/srt';
import { TimingError, ValidationError } from '../subtitle/errors';
import type { SrtCue } from '../subtitle/types';
import type { SegmentCue, VideoGenerationOptions } from './types';

export function parseSegmentSrtText(srtText: string): SegmentCue[] {
  let cues: SrtCue[];

  try {
    cues = parseSrtCues(srtText);
  } catch (error) {
    throw new ValidationError(`Invalid SRT input: ${(error as Error).message}`);
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

export function buildSegmentTimeline(cues: SegmentCue[], options: VideoGenerationOptions = {}): SegmentCue[] {
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

export function parseSegmentSrtFile(srtPath: string): SegmentCue[] {
  if (!fs.existsSync(srtPath)) {
    throw new ValidationError(`SRT file cannot be found: ${srtPath}`);
  }

  const stats = fs.statSync(srtPath);
  if (!stats.isFile()) {
    throw new ValidationError(`SRT path is not a file: ${srtPath}`);
  }

  return parseSegmentSrtText(fs.readFileSync(srtPath, 'utf8'));
}
