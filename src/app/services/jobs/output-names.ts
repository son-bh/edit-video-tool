import path from 'node:path';

import { resolveVideoRenderPreset } from '../../../video';

function normalizeStem(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return 'file';
  }

  const normalized = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'file';
}

export function buildStoredUploadName(originalName: string, fallbackStem: string): string {
  const extension = path.extname(originalName || '').toLowerCase();
  const stem = normalizeStem(path.basename(originalName || '', extension) || fallbackStem);
  return `${stem || normalizeStem(fallbackStem)}${extension}`;
}

export function buildSubtitleOutputPaths(outputsDir: string, scriptPath: string): {
  transcriptSrtPath: string;
  scriptSrtPath: string;
  baseName: string;
} {
  const extension = path.extname(scriptPath);
  const baseName = normalizeStem(path.basename(scriptPath, extension) || 'script');

  return {
    baseName,
    transcriptSrtPath: path.join(outputsDir, `${baseName}.whisper.srt`),
    scriptSrtPath: path.join(outputsDir, `${baseName}.srt`)
  };
}

export function buildVideoOutputPaths(outputsDir: string, scriptSrtPath: string, aspectRatio?: string): {
  baseName: string;
  segmentZipPath: string;
  finalVideoPath: string;
  finalVideoWithAudioPath: string;
  finalVideoWithAudioSubtitlesPath: string;
} {
  const extension = path.extname(scriptSrtPath);
  const baseName = normalizeStem(path.basename(scriptSrtPath, extension) || 'script');
  const preset = resolveVideoRenderPreset(aspectRatio);
  const presetKey = preset.key.replace(':', 'x');
  const renderSuffix = `${presetKey}-${String(preset.label || '').toLowerCase()}`;
  const finalBaseName = `${baseName}-final-video-${renderSuffix}`;

  return {
    baseName,
    segmentZipPath: path.join(outputsDir, `${baseName}-segments.zip`),
    finalVideoPath: path.join(outputsDir, `${finalBaseName}.mp4`),
    finalVideoWithAudioPath: path.join(outputsDir, `${finalBaseName}-audio.mp4`),
    finalVideoWithAudioSubtitlesPath: path.join(outputsDir, `${finalBaseName}-audio-subtitles.mp4`)
  };
}

export function getDownloadFileName(filePath: string | undefined, fallbackName: string): string {
  if (!filePath) {
    return fallbackName;
  }

  const fileName = path.basename(filePath);
  return fileName || fallbackName;
}
