import { DEFAULT_ASPECT_RATIO, resolveVideoRenderPreset } from '../../video-segment-generation';
import type { JobRecord } from '../types';

export function serializeJob(job: JobRecord | null): Record<string, unknown> | null {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    folderName: job.folderName,
    ownerUsername: job.ownerUsername,
    aspectRatio: job.aspectRatio || DEFAULT_ASPECT_RATIO,
    renderLabel: job.renderLabel || resolveVideoRenderPreset(job.aspectRatio || DEFAULT_ASPECT_RATIO).label,
    phase: job.phase,
    status: job.status,
    stage: job.stage,
    percent: job.percent,
    message: job.message,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedPhases: job.completedPhases,
    outputs: {
      hasTranscriptSrt: Boolean(job.outputs.transcriptSrt),
      hasScriptSrt: Boolean(job.outputs.scriptSrt),
      hasSegmentZip: Boolean(job.outputs.segmentZip),
      hasFinalVideo: Boolean(job.outputs.finalVideo),
      hasFinalVideoWithAudio: Boolean(job.outputs.finalVideoWithAudio),
      hasFinalVideoWithAudioSubtitles: Boolean(job.outputs.finalVideoWithAudioSubtitles)
    }
  };
}
