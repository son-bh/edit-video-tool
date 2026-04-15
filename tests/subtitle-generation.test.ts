import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  AlignmentMismatchError,
  AudioAnalysisError,
  TimingError,
  ValidationError,
  alignItemsToAccumulatedTranscript,
  alignSubtitleItemsToAudio,
  alignItemsToTranscriptCues,
  alignItemsToTranscriptTimeline,
  alignItemsToTranscriptWords,
  formatSrt,
  generateSubtitles,
  groupSegmentsToItemCount,
  normalizeForTranscriptMatch,
  parseSrtCues,
  parseSubtitleItems,
  parseSubtitleJsonFile,
  parseSubtitleTextItems,
  validateCues,
  type SrtCue,
  type SubtitleItem
} from '../src/subtitle';

function createPcmWavBuffer(pattern: Array<{ duration: number; amplitude: number }>, sampleRate = 8000): Buffer {
  const samples: number[] = [];

  for (const part of pattern) {
    const sampleCount = Math.floor(part.duration * sampleRate);

    for (let index = 0; index < sampleCount; index += 1) {
      const value = part.amplitude === 0
        ? 0
        : Math.round(Math.sin(index / 3) * part.amplitude * 32767);
      samples.push(value);
    }
  }

  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, 44 + index * 2);
  });

  return buffer;
}

function withTempDir(callback: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-generation-'));

  try {
    callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('parseSubtitleItems accepts valid 2-3 item JSON', () => {
  const items = parseSubtitleItems(JSON.stringify([
    { text: 'Something' },
    { text: 'Something 2' },
    { text: 'Something 3' }
  ]));

  assert.deepEqual(items, [
    { text: 'Something' },
    { text: 'Something 2' },
    { text: 'Something 3' }
  ]);
});

test('parseSubtitleItems rejects malformed and invalid input', () => {
  assert.throws(() => parseSubtitleItems('{'), ValidationError);
  assert.throws(() => parseSubtitleItems(JSON.stringify({ text: 'Nope' })), ValidationError);
  assert.throws(() => parseSubtitleItems(JSON.stringify([{ title: 'Missing text' }])), ValidationError);
  assert.throws(() => parseSubtitleItems(JSON.stringify([{ text: '   ' }])), ValidationError);
});

test('parseSubtitleItems enforces the 100 item limit', () => {
  const items = Array.from({ length: 101 }, (_, index) => ({ text: `Item ${index + 1}` }));

  assert.throws(() => parseSubtitleItems(JSON.stringify(items)), /current limit is 100/);
});

test('parseSubtitleTextItems converts non-empty lines into subtitle items', () => {
  const items = parseSubtitleTextItems('Something\n\n Something 2 \r\nSomething 3\r\n');

  assert.deepEqual(items, [
    { text: 'Something' },
    { text: 'Something 2' },
    { text: 'Something 3' }
  ]);
});

test('parseSubtitleTextItems rejects empty text files', () => {
  assert.throws(() => parseSubtitleTextItems('\n  \r\n\t'), /must contain at least one non-empty line/i);
});

test('parseSubtitleJsonFile accepts .txt and rejects unsupported script types', () => withTempDir((dir) => {
  const textPath = path.join(dir, 'script.txt');
  const invalidPath = path.join(dir, 'script.csv');
  fs.writeFileSync(textPath, 'One\nTwo\n');
  fs.writeFileSync(invalidPath, 'One,Two\n');

  assert.deepEqual(parseSubtitleJsonFile(textPath), [
    { text: 'One' },
    { text: 'Two' }
  ]);
  assert.throws(() => parseSubtitleJsonFile(invalidPath), /Use \.json or \.txt/i);
}));

test('alignSubtitleItemsToAudio derives one cue per JSON item and preserves text exactly', () => withTempDir((dir) => {
  const audioPath = path.join(dir, 'voice.wav');
  fs.writeFileSync(audioPath, createPcmWavBuffer([
    { duration: 0.2, amplitude: 0 },
    { duration: 0.3, amplitude: 0.6 },
    { duration: 0.2, amplitude: 0 },
    { duration: 0.4, amplitude: 0.6 }
  ]));

  const items: SubtitleItem[] = [{ text: 'Something' }, { text: 'Something 2' }];
  const cues = alignSubtitleItemsToAudio(items, audioPath);

  assert.equal(cues.length, items.length);
  assert.equal(cues[0].text, items[0].text);
  assert.equal(cues[1].text, items[1].text);
  assert.ok(cues[0].start < cues[0].end);
  assert.ok(cues[1].start < cues[1].end);
  assert.ok(cues[1].start >= cues[0].end);
}));

test('alignSubtitleItemsToAudio rejects missing audio and mismatched segments', () => withTempDir((dir) => {
  assert.throws(
    () => alignSubtitleItemsToAudio([{ text: 'Missing' }], path.join(dir, 'missing.wav')),
    AudioAnalysisError
  );

  const audioPath = path.join(dir, 'voice.wav');
  fs.writeFileSync(audioPath, createPcmWavBuffer([
    { duration: 0.2, amplitude: 0 },
    { duration: 0.3, amplitude: 0.6 }
  ]));

  assert.throws(
    () => alignSubtitleItemsToAudio([{ text: 'One' }, { text: 'Two' }], audioPath),
    AlignmentMismatchError
  );
}));

test('groupSegmentsToItemCount merges extra speech chunks using the largest pauses', () => {
  const grouped = groupSegmentsToItemCount([
    { start: 0, end: 0.2 },
    { start: 0.3, end: 0.5 },
    { start: 1.4, end: 1.8 },
    { start: 2.0, end: 2.2 },
    { start: 3.1, end: 3.4 }
  ], 3);

  assert.deepEqual(grouped, [
    { start: 0, end: 0.5 },
    { start: 1.4, end: 2.2 },
    { start: 3.1, end: 3.4 }
  ]);
});

test('groupSegmentsToItemCount uses JSON text length to close cues at earlier valid pauses', () => {
  const grouped = groupSegmentsToItemCount([
    { start: 0.1, end: 4.1 },
    { start: 4.6, end: 5.4 },
    { start: 5.7, end: 6.8 },
    { start: 7.3, end: 8.2 },
    { start: 9.0, end: 11.8 }
  ], [
    { text: 'Imagine for a second that you wake up tomorrow and the ATM doesn\'t work.' },
    { text: 'You go to the bank, and the doors are locked.' },
    { text: 'You check your phone, and the news says the United States government has run out of money.' }
  ]);

  assert.deepEqual(grouped, [
    { start: 0.1, end: 4.1 },
    { start: 4.6, end: 6.8 },
    { start: 7.3, end: 11.8 }
  ]);
});

test('validateCues rejects invalid and overlapping timestamps', () => {
  assert.throws(() => validateCues([{ start: 1, end: 1, text: 'Bad' }]), TimingError);
  assert.throws(() => validateCues([
    { start: 0, end: 1, text: 'One' },
    { start: 0.5, end: 1.5, text: 'Two' }
  ]), TimingError);
});

test('parseSrtCues parses transcript cues', () => {
  const cues = parseSrtCues([
    '1',
    '00:00:00,000 --> 00:00:04,000',
    'Imagine for a second that you wake up tomorrow and the ATM doesn\'t work.',
    '',
    '2',
    '00:00:04,200 --> 00:00:06,800',
    'You go to the bank, and the doors are locked.',
    ''
  ].join('\n'));

  assert.deepEqual(cues, [
    {
      start: 0,
      end: 4,
      text: 'Imagine for a second that you wake up tomorrow and the ATM doesn\'t work.'
    },
    {
      start: 4.2,
      end: 6.8,
      text: 'You go to the bank, and the doors are locked.'
    }
  ]);
});

test('alignItemsToTranscriptCues maps JSON text to transcript timing and preserves JSON text', () => {
  const transcriptCues: SrtCue[] = [
    { start: 0, end: 4, text: 'Imagine for a second that you wake up tomorrow and the ATM doesnt work' },
    { start: 4.2, end: 6.8, text: 'You go to the bank and the doors are locked' }
  ];
  const items: SubtitleItem[] = [
    { text: 'Imagine for a second that you wake up tomorrow and the ATM doesn\'t work.' },
    { text: 'You go to the bank, and the doors are locked.' }
  ];

  assert.deepEqual(alignItemsToTranscriptCues(items, transcriptCues), [
    {
      start: 0,
      end: 4,
      text: 'Imagine for a second that you wake up tomorrow and the ATM doesn\'t work.'
    },
    {
      start: 4.2,
      end: 6.8,
      text: 'You go to the bank, and the doors are locked.'
    }
  ]);
});

test('alignItemsToTranscriptCues rejects transcript mismatches', () => {
  assert.throws(() => alignItemsToTranscriptCues([
    { text: 'Expected sentence.' }
  ], [
    { start: 0, end: 1, text: 'Different words.' }
  ]), AlignmentMismatchError);
});

test('alignItemsToTranscriptTimeline maps multiple JSON items inside one transcript cue', () => {
  const transcriptCues: SrtCue[] = [
    {
      start: 0,
      end: 9,
      text: 'Imagine for a second that you wake up tomorrow and the ATM doesnt work. You go to the bank and the doors are locked.'
    }
  ];
  const items: SubtitleItem[] = [
    { text: 'Imagine for a second that you wake up tomorrow and the ATM doesn\'t work.' },
    { text: 'You go to the bank, and the doors are locked.' }
  ];
  const aligned = alignItemsToTranscriptTimeline(items, transcriptCues);

  assert.equal(aligned.length, 2);
  assert.equal(aligned[0].text, items[0].text);
  assert.equal(aligned[1].text, items[1].text);
  assert.ok(aligned[0].start < aligned[0].end);
  assert.ok(aligned[0].end <= aligned[1].start);
  assert.ok(aligned[1].end <= 9);
});

test('alignItemsToAccumulatedTranscript combines Whisper segments until script item text matches', () => {
  const transcriptCues: SrtCue[] = [
    { start: 0, end: 1.8, text: 'Imagine for a second that you wake up tomorrow' },
    { start: 1.8, end: 4.1, text: 'and the ATM doesn\'t work.' },
    { start: 4.6, end: 6.8, text: 'You go to the bank, and the doors are locked.' }
  ];
  const items: SubtitleItem[] = [
    { text: 'Imagine for a second that you wake up tomorrow and the ATM doesn\'t work.' },
    { text: 'You go to the bank, and the doors are locked.' }
  ];

  assert.deepEqual(alignItemsToAccumulatedTranscript(items, transcriptCues), [
    {
      start: 0,
      end: 4.1,
      text: 'Imagine for a second that you wake up tomorrow and the ATM doesn\'t work.'
    },
    {
      start: 4.6,
      end: 6.8,
      text: 'You go to the bank, and the doors are locked.'
    }
  ]);
});

test('alignItemsToTranscriptWords handles small transcript wording differences', () => {
  const transcriptCues: SrtCue[] = [
    {
      start: 230,
      end: 238,
      text: 'You see in 1907 all of these banks and trusts were connected like one giant spider web'
    }
  ];
  const items: SubtitleItem[] = [
    { text: 'You see, in 1907, all these banks and Trusts were interconnected like a giant spiderweb.' }
  ];
  const aligned = alignItemsToTranscriptWords(items, transcriptCues);

  assert.equal(aligned.length, 1);
  assert.equal(aligned[0].text, items[0].text);
  assert.ok(aligned[0].start >= 230);
  assert.ok(aligned[0].end <= 238);
});

test('normalizeForTranscriptMatch ignores punctuation and casing', () => {
  assert.equal(
    normalizeForTranscriptMatch('The ATM doesn\u2019t work.'),
    normalizeForTranscriptMatch('the atm doesnt work')
  );
});

test('formatSrt writes standard SRT cues', () => {
  const srt = formatSrt([
    { start: 0.2, end: 0.5, text: 'Something' },
    { start: 0.7, end: 1.1, text: 'Something 2' }
  ]);

  assert.equal(srt, [
    '1',
    '00:00:00,200 --> 00:00:00,500',
    'Something',
    '',
    '2',
    '00:00:00,700 --> 00:00:01,100',
    'Something 2',
    ''
  ].join('\n'));
});

test('generateSubtitles writes an SRT file from JSON and WAV input', () => withTempDir((dir) => {
  const jsonPath = path.join(dir, 'subtitles.json');
  const audioPath = path.join(dir, 'voice.wav');
  const outputPath = path.join(dir, 'subtitles.srt');

  fs.writeFileSync(jsonPath, JSON.stringify([
    { text: 'Something' },
    { text: 'Something 2' }
  ]));
  fs.writeFileSync(audioPath, createPcmWavBuffer([
    { duration: 0.2, amplitude: 0 },
    { duration: 0.3, amplitude: 0.6 },
    { duration: 0.2, amplitude: 0 },
    { duration: 0.4, amplitude: 0.6 }
  ]));

  const result = generateSubtitles({
    jsonPath,
    audioPath,
    outputPath,
    alignment: {
      useTranscript: false
    }
  });
  const output = fs.readFileSync(outputPath, 'utf8');

  assert.equal(result.cues.length, 2);
  assert.match(output, /Something/);
  assert.match(output, /Something 2/);
}));
