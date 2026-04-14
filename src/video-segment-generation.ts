export {
  DEFAULT_DURATION_TOLERANCE_SECONDS,
  DEFAULT_FINAL_WIDTH,
  DEFAULT_FINAL_HEIGHT,
  DEFAULT_ASPECT_RATIO,
  VIDEO_RENDER_PRESETS,
  buildScalePadFilter,
  resolveVideoRenderPreset
} from './video/render-presets';
export {
  SUPPORTED_VIDEO_EXTENSIONS,
  discoverSourceVideos,
  selectVideoForCue
} from './video/source-videos';
export {
  parseSegmentSrtText,
  buildSegmentTimeline,
  parseSegmentSrtFile
} from './video/srt';
export {
  getFfprobeCommand,
  probeVideoDuration,
  cutVideo,
  copyVideo,
  concatVideos,
  computeExpectedConcatDuration,
  getConcatDurationTolerance,
  validateOutputDuration
} from './video/ffmpeg';
export {
  buildOutputSegmentPath,
  createSegmentPlan,
  executeSegmentPlan
} from './video/planning';
export {
  concatSegmentFolder,
  generateVideoSegments,
  muxVideoWithAudio,
  renderVideoWithAudioAndSubtitles
} from './video/service';
export { VideoSegmentGenerationError } from './video/errors';
export type { GenerateVideoSegmentsInput, SegmentCue, SegmentPlan, VideoRenderPreset } from './video/types';
