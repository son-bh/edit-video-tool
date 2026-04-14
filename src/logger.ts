import winston from 'winston';

export interface LoggerOptions {
  quiet?: boolean;
}

export function createLogger(options: LoggerOptions = {}): winston.Logger {
  return winston.createLogger({
    level: options.quiet ? 'silent' : 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) => (
        `[${timestamp}] [${level}] [subtitle-generation] ${message}`
      ))
    ),
    transports: [
      new winston.transports.Console()
    ]
  });
}
