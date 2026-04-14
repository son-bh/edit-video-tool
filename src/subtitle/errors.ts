export class SubtitleGenerationError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ValidationError extends SubtitleGenerationError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

export class AudioAnalysisError extends SubtitleGenerationError {
  constructor(message: string) {
    super(message, 'AUDIO_ANALYSIS_ERROR');
  }
}

export class AlignmentMismatchError extends SubtitleGenerationError {
  constructor(message: string) {
    super(message, 'ALIGNMENT_MISMATCH');
  }
}

export class TimingError extends SubtitleGenerationError {
  constructor(message: string) {
    super(message, 'TIMING_ERROR');
  }
}
