import fs from 'node:fs';

import { AudioAnalysisError, TimingError } from './errors';
import type { SrtCue } from './types';

export function parseSrtTimestamp(value: string): number {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/u);

  if (!match) {
    throw new AudioAnalysisError(`Invalid SRT timestamp: ${value}`);
  }

  return Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000;
}

export function parseSrtCues(srtText: string): SrtCue[] {
  return srtText
    .trim()
    .split(/\r?\n\r?\n/u)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/u);
      const timingLineIndex = lines.findIndex((line) => line.includes('-->'));

      if (timingLineIndex === -1) {
        throw new AudioAnalysisError('Transcript SRT contains a cue without a timing line.');
      }

      const [startText, endText] = lines[timingLineIndex].split('-->').map((part) => part.trim().split(/\s+/u)[0]);
      const text = lines.slice(timingLineIndex + 1).join(' ').trim();

      return {
        start: parseSrtTimestamp(startText),
        end: parseSrtTimestamp(endText),
        text
      };
    });
}

export function validateCues(cues: SrtCue[]): void {
  cues.forEach((cue, index) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) {
      throw new TimingError(`Cue ${index + 1} has invalid timing.`);
    }

    if (index > 0 && cue.start < cues[index - 1].end) {
      throw new TimingError(`Cue ${index + 1} overlaps unexpectedly with cue ${index}.`);
    }
  });
}

export function formatSrtTimestamp(seconds: number): string {
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

export function formatSrt(cues: SrtCue[]): string {
  validateCues(cues);

  return cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}`,
    cue.text
  ].join('\n')).join('\n\n') + '\n';
}

export function readSrtFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}
