import fs from 'node:fs';

import { AudioAnalysisError } from './errors';
import { alignSubtitleItemsToAudio, mapJsonItemsToTranscriptFile } from './alignment';
import { logStep } from './logging';
import { parseSubtitleJsonFile } from './script-parser';
import { formatSrt, validateCues } from './srt';
import { createWhisperSubtitleFile, shouldUseTranscriptAlignment } from './whisper';
import type { GenerateSubtitlesInput, GenerateSubtitlesResult } from './types';

export function generateSubtitles(options: GenerateSubtitlesInput): GenerateSubtitlesResult {
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

    logStep(alignmentOptions, 'generateSubtitles: Step 2 mapping transcript to script items');
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
