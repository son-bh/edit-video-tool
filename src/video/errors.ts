import { SubtitleGenerationError } from '../subtitle/errors';

export class VideoSegmentGenerationError extends SubtitleGenerationError {
  constructor(message: string) {
    super(message, 'VIDEO_SEGMENT_ERROR');
  }
}
