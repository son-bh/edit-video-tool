import assert from 'node:assert/strict';
import test from 'node:test';

import { expandEnvValue, parseEnvFileContents } from '../src/env';

test('expandEnvValue resolves ${VAR} and %VAR% placeholders', () => {
  process.env.TEST_ENV_ROOT = 'C:\\Tools';

  assert.equal(expandEnvValue('${TEST_ENV_ROOT}\\ffmpeg.exe'), 'C:\\Tools\\ffmpeg.exe');
  assert.equal(expandEnvValue('%TEST_ENV_ROOT%\\whisper.exe'), 'C:\\Tools\\whisper.exe');
});

test('parseEnvFileContents ignores comments and keeps explicit values', () => {
  process.env.TEST_ENV_ROOT = 'C:\\Tools';

  const parsed = parseEnvFileContents([
    '# comment',
    'FFMPEG_PATH=C:\\ffmpeg\\bin\\ffmpeg.exe',
    'WHISPER_COMMAND_PATH=${TEST_ENV_ROOT}\\whisper.exe'
  ].join('\n'));

  assert.deepEqual(parsed, {
    FFMPEG_PATH: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    WHISPER_COMMAND_PATH: 'C:\\Tools\\whisper.exe'
  });
});
