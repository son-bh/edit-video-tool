import type { LoggerLike } from '../types/logger';
import type { SrtCue } from '../subtitle/types';

export interface SegmentCue extends SrtCue {
  index: number;
  duration: number;
  segmentStart?: number;
  segmentEnd?: number;
  segmentDuration?: number;
}

export interface VideoRenderPreset {
  key: string;
  width: number;
  height: number;
  label: string;
}

export interface SegmentPlanPart {
  kind: 'full' | 'cut';
  duration: number;
}

export interface SegmentPlan {
  cue: SegmentCue;
  sourceVideo: string;
  sourceDuration: number;
  operation: 'copy' | 'cut' | 'concat';
  parts: SegmentPlanPart[];
}

export interface VideoGenerationOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  loopVideos?: boolean;
  durationToleranceSeconds?: number;
  commandRunner?: (command: string, args: string[]) => string | Buffer;
  durationProbe?: (filePath: string) => number;
  tempRoot?: string;
  tempDir?: string;
  concatListPath?: string;
  reencodeVideo?: boolean;
  videoFilters?: string[];
  stripAudio?: boolean;
  outputWidth?: number;
  outputHeight?: number;
  aspectRatio?: string;
  videoRenderPreset?: VideoRenderPreset;
  preserveTimelineGaps?: boolean;
  logger?: LoggerLike;
}

export interface GenerateVideoSegmentsInput extends VideoGenerationOptions {
  srtPath: string;
  videoDir: string;
  outputDir: string;
}
