const winston = require('winston');

function createLogger(options = {}) {
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

module.exports = {
  createLogger
};
