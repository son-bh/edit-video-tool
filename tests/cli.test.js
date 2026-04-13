const assert = require('node:assert/strict');
const test = require('node:test');

const { main, parseArgs } = require('../src/cli');

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
  const errors = [];

  console.error = (message) => {
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
