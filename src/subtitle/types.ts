import type { LoggerLike } from '../types/logger';

export interface SubtitleItem {
  text: string;
}

export interface SrtCue {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptWindow extends SrtCue {
  startIndex: number;
  endIndex: number;
}

export interface TranscriptTimelineRange {
  startOffset: number;
  endOffset: number;
  start: number;
  end: number;
}

export interface TranscriptTimeline {
  text: string;
  ranges: TranscriptTimelineRange[];
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface WavInfo {
  audioFormat: number;
  channelCount: number;
  sampleRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
  frameCount: number;
}

export interface AudioSegment {
  start: number;
  end: number;
}

export interface SubtitleGenerationOptions {
  maxItems?: number;
  logger?: LoggerLike;
}

export interface AlignmentOptions extends SubtitleGenerationOptions {
  ffmpegPath?: string;
  whisperCommandPath?: string;
  whisperModel?: string;
  whisperModelPath?: string | null;
  language?: string;
  transcriptInputPath?: string;
  transcriptOutputPath?: string;
  useTranscript?: boolean;
  sampleRate?: number;
  frameDurationMs?: number;
  threshold?: number;
  minSpeechMs?: number;
  maxSilenceGapMs?: number;
  minBoundaryGapSeconds?: number;
  maxCharsPerSecond?: number;
  maxTranscriptCuesPerItem?: number;
  minTokenMatchScore?: number;
  lookaheadWords?: number;
  minWindowFactor?: number;
  maxWindowFactor?: number;
}

export interface GenerateSubtitlesInput {
  jsonPath: string;
  audioPath: string;
  outputPath: string;
  maxItems?: number;
  alignment?: AlignmentOptions;
}

export interface GenerateSubtitlesResult {
  cues: SrtCue[];
  output: string;
}

