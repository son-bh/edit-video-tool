import type { LoggerLike } from '../types/logger';

export function logStep(options: { logger?: LoggerLike } = {}, message: string): void {
  if (options.logger && typeof options.logger.info === 'function') {
    options.logger.info(message);
  }
}
