import assert from 'node:assert/strict';
import test from 'node:test';

import { main, parseArgs } from '../src/cli';

test('parseArgs accepts --aspect-ratio', () => {
  const args = parseArgs([
    '--concat-segments', 'segments',
    '--final-out', 'final.mp4',
    '--aspect-ratio', '9:16'
  ]);

  assert.equal(args['aspect-ratio'], '9:16');
});

test('main rejects unsupported --aspect-ratio values', () => {
  const originalError = console.error;
  const originalLog = console.log;
  const errors: string[] = [];

  console.error = (message?: unknown) => {
    errors.push(String(message));
  };
  console.log = () => {};

  try {
    const exitCode = main([
      '--concat-segments', 'segments',
      '--final-out', 'final.mp4',
      '--aspect-ratio', '1:1'
    ]);

    assert.equal(exitCode, 1);
    assert.match(errors.join('\n'), /Unsupported aspect ratio/);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});
