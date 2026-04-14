export const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.mp4',
  '.mov',
  '.mkv'
]);

export const SUPPORTED_WHISPER_LANGUAGES = new Set(['auto', 'en', 'vi']);

export const SCRIPT_JSON_EXAMPLE = JSON.stringify([
  { text: 'First subtitle text.' },
  { text: 'Second subtitle text.' }
], null, 2);
