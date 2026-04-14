import fs from 'node:fs';
import path from 'node:path';

import { VideoSegmentGenerationError } from './errors';

export const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi'
]);

export function discoverSourceVideos(videoDir: string): string[] {
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

  return videos;
}

export function selectVideoForCue(cueIndex: number, sourceVideos: string[], options: { loopVideos?: boolean } = {}): string {
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
