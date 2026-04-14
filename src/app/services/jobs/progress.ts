import type { LoggerLike } from '../../../types/logger';
import type { JobOutputs, ProgressPayload } from '../../types';

export interface ProgressReporter {
  update(payload: ProgressPayload): void;
  log(message: string): void;
  complete(outputs: JobOutputs): void;
  fail(error: string): void;
}

export function createProgressReporter(send: (message: unknown) => void): ProgressReporter {
  return {
    update(payload: ProgressPayload): void {
      send({
        type: 'progress',
        ...payload
      });
    },
    log(message: string): void {
      send({
        type: 'log',
        message
      });
    },
    complete(outputs: JobOutputs): void {
      send({
        type: 'completed',
        outputs
      });
    },
    fail(error: string): void {
      send({
        type: 'failed',
        error
      });
    }
  };
}

export function createSubtitleLogger(progress: ProgressReporter): LoggerLike {
  return {
    info(message: string): void {
      progress.log(message);
      const matchedItem = message.match(/matched item (\d+)\/(\d+)/i);

      if (matchedItem) {
        const current = Number(matchedItem[1]);
        const total = Number(matchedItem[2]);
        const percent = 60 + Math.round((current / total) * 25);
        progress.update({
          stage: 'mapping-subtitles',
          percent,
          message
        });
      }
    }
  };
}

export function createVideoLogger(progress: ProgressReporter): LoggerLike {
  return {
    info(message: string): void {
      progress.log(message);
      const cueMatch = message.match(/cue (\d+)\/(\d+)/i);

      if (cueMatch) {
        const current = Number(cueMatch[1]);
        const total = Number(cueMatch[2]);
        const percent = 50 + Math.round((current / total) * 40);
        progress.update({
          stage: 'generating-segments',
          percent,
          message
        });
      }
    }
  };
}
