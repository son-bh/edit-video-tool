import { ValidationError } from '../subtitle/errors';
import type { VideoRenderPreset } from './types';

export const DEFAULT_DURATION_TOLERANCE_SECONDS = 0.25;
export const DEFAULT_FINAL_WIDTH = 2560;
export const DEFAULT_FINAL_HEIGHT = 1440;
export const DEFAULT_ASPECT_RATIO = '16:9';
export const VIDEO_RENDER_PRESETS: Readonly<Record<string, VideoRenderPreset>> = Object.freeze({
  '16:9': {
    key: '16:9',
    width: DEFAULT_FINAL_WIDTH,
    height: DEFAULT_FINAL_HEIGHT,
    label: '2K'
  },
  '9:16': {
    key: '9:16',
    width: 1080,
    height: 1920,
    label: '1080p'
  }
});

export function resolveVideoRenderPreset(aspectRatio = DEFAULT_ASPECT_RATIO): VideoRenderPreset {
  const normalized = String(aspectRatio || DEFAULT_ASPECT_RATIO).trim();
  const preset = VIDEO_RENDER_PRESETS[normalized];

  if (!preset) {
    throw new ValidationError(`Unsupported aspect ratio: ${normalized}. Use 16:9 or 9:16.`);
  }

  return preset;
}

export function buildScalePadFilter(options: { outputWidth?: number; outputHeight?: number; aspectRatio?: string; videoRenderPreset?: VideoRenderPreset } = {}): string {
  const preset = options.videoRenderPreset || resolveVideoRenderPreset(options.aspectRatio);
  const width = options.outputWidth ?? preset.width;
  const height = options.outputHeight ?? preset.height;
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}
