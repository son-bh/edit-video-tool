const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  concatSegmentFolder,
  VideoSegmentGenerationError,
  createSegmentPlan,
  discoverSourceVideos,
  executeSegmentPlan,
  generateVideoSegments,
  parseSegmentSrtText,
  selectVideoForCue
} = require('../src/video-segment-generation');

function withTempDir(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-segment-generation-'));

  try {
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sampleSrt() {
  return [
    '1',
    '00:00:00,000 --> 00:00:10,000',
    'Ten seconds',
    '',
    '2',
    '00:00:10,000 --> 00:00:17,500',
    'Seven point five seconds',
    '',
    '3',
    '00:00:17,500 --> 00:00:30,500',
    'Thirteen seconds',
    ''
  ].join('\n');
}

test('parseSegmentSrtText parses cue durations', () => {
  const cues = parseSegmentSrtText(sampleSrt());

  assert.equal(cues.length, 3);
  assert.equal(cues[0].index, 1);
  assert.equal(cues[0].duration, 10);
  assert.equal(cues[1].duration, 7.5);
  assert.equal(cues[2].duration, 13);
});

test('parseSegmentSrtText rejects malformed and empty SRT input', () => {
  assert.throws(() => parseSegmentSrtText(''), /at least one cue/);
  assert.throws(() => parseSegmentSrtText(['1', 'No timing line'].join('\n')), /Invalid SRT input/);
  assert.throws(() => parseSegmentSrtText([
    '1',
    '00:00:02,000 --> 00:00:01,000',
    'Bad timing'
  ].join('\n')), /invalid timing/);
});

test('discoverSourceVideos returns supported videos in deterministic order', () => withTempDir((dir) => {
  fs.writeFileSync(path.join(dir, 'video-10.mp4'), '');
  fs.writeFileSync(path.join(dir, 'video-2.mp4'), '');
  fs.writeFileSync(path.join(dir, 'notes.txt'), '');
  fs.writeFileSync(path.join(dir, 'video-1.mov'), '');

  assert.deepEqual(
    discoverSourceVideos(dir).map((filePath) => path.basename(filePath)),
    ['video-1.mov', 'video-2.mp4', 'video-10.mp4']
  );
}));

test('selectVideoForCue rejects missing video unless looping is enabled', () => {
  const videos = ['one.mp4', 'two.mp4'];

  assert.equal(selectVideoForCue(1, videos), 'one.mp4');
  assert.throws(() => selectVideoForCue(3, videos), VideoSegmentGenerationError);
  assert.equal(selectVideoForCue(3, videos, { loopVideos: true }), 'one.mp4');
});

test('createSegmentPlan handles equal, shorter, longer, and multi-repeat durations', () => {
  assert.deepEqual(
    createSegmentPlan({ index: 1, duration: 10 }, 'video.mp4', 10).parts,
    [{ kind: 'full', duration: 10 }]
  );
  assert.equal(createSegmentPlan({ index: 1, duration: 10 }, 'video.mp4', 10).operation, 'copy');

  assert.deepEqual(
    createSegmentPlan({ index: 2, duration: 7.5 }, 'video.mp4', 10).parts,
    [{ kind: 'cut', duration: 7.5 }]
  );
  assert.equal(createSegmentPlan({ index: 2, duration: 7.5 }, 'video.mp4', 10).operation, 'cut');

  assert.deepEqual(
    createSegmentPlan({ index: 3, duration: 13 }, 'video.mp4', 10).parts,
    [{ kind: 'full', duration: 10 }, { kind: 'cut', duration: 3 }]
  );
  assert.equal(createSegmentPlan({ index: 3, duration: 13 }, 'video.mp4', 10).operation, 'concat');

  assert.deepEqual(
    createSegmentPlan({ index: 4, duration: 24 }, 'video.mp4', 10).parts,
    [{ kind: 'full', duration: 10 }, { kind: 'full', duration: 10 }, { kind: 'cut', duration: 4 }]
  );
});

test('executeSegmentPlan builds ffmpeg cut and concat commands', () => withTempDir((dir) => {
  const commands = [];
  const commandRunner = (command, args) => {
    commands.push({ command, args });
    return '';
  };
  const sourceVideo = path.join(dir, 'source.mp4');
  const outputPath = path.join(dir, 'segment.mp4');
  fs.writeFileSync(sourceVideo, '');

  executeSegmentPlan(
    createSegmentPlan({ index: 1, start: 0, end: 7.5, duration: 7.5 }, sourceVideo, 10),
    outputPath,
    { commandRunner, ffmpegPath: 'ffmpeg' }
  );

  assert.equal(commands.length, 1);
  assert.ok(commands[0].args.includes('-t'));
  assert.ok(commands[0].args.includes('7.500'));

  commands.length = 0;
  executeSegmentPlan(
    createSegmentPlan({ index: 2, start: 0, end: 24, duration: 24 }, sourceVideo, 10),
    outputPath,
    { commandRunner, ffmpegPath: 'ffmpeg', tempRoot: dir }
  );

  assert.equal(commands.length, 4);
  assert.equal(commands[3].args[0], '-hide_banner');
  assert.ok(commands[3].args.includes('concat'));
}));

test('generateVideoSegments creates one planned output per SRT cue', () => withTempDir((dir) => {
  const srtPath = path.join(dir, 'script.srt');
  const videoDir = path.join(dir, 'videos');
  const outputDir = path.join(dir, 'out');
  const commands = [];

  fs.writeFileSync(srtPath, sampleSrt());
  fs.mkdirSync(videoDir);
  fs.writeFileSync(path.join(videoDir, 'video-1.mp4'), '');
  fs.writeFileSync(path.join(videoDir, 'video-2.mp4'), '');
  fs.writeFileSync(path.join(videoDir, 'video-3.mp4'), '');

  const result = generateVideoSegments({
    srtPath,
    videoDir,
    outputDir,
    ffmpegPath: 'ffmpeg',
    commandRunner: (command, args) => {
      commands.push({ command, args });
      return '';
    },
    durationProbe: (filePath) => {
      if (path.basename(filePath) === 'segment-001.mp4') {
        return 10;
      }

      if (path.basename(filePath) === 'segment-002.mp4') {
        return 7.5;
      }

      if (path.basename(filePath) === 'segment-003.mp4') {
        return 13;
      }

      return 10;
    }
  });

  assert.equal(result.outputs.length, 3);
  assert.equal(result.outputs[0].plan.operation, 'copy');
  assert.equal(result.outputs[1].plan.operation, 'cut');
  assert.equal(result.outputs[2].plan.operation, 'concat');
  assert.ok(commands.length >= 1);
}));

test('concatSegmentFolder concatenates segment videos in deterministic order', () => withTempDir((dir) => {
  const segmentDir = path.join(dir, 'segments');
  const outputPath = path.join(dir, 'final', 'final.mp4');
  const commands = [];

  fs.mkdirSync(segmentDir);
  fs.writeFileSync(path.join(segmentDir, 'segment-010.mp4'), '');
  fs.writeFileSync(path.join(segmentDir, 'segment-002.mp4'), '');
  fs.writeFileSync(path.join(segmentDir, 'segment-001.mp4'), '');

  const result = concatSegmentFolder({
    segmentDir,
    outputPath,
    ffmpegPath: 'ffmpeg',
    commandRunner: (command, args) => {
      commands.push({ command, args });
      return '';
    },
    durationProbe: (filePath) => {
      if (filePath === outputPath) {
        return 42;
      }

      return 10;
    }
  });

  assert.equal(result.segmentPaths.length, 3);
  assert.deepEqual(
    result.segmentPaths.map((filePath) => path.basename(filePath)),
    ['segment-001.mp4', 'segment-002.mp4', 'segment-010.mp4']
  );
  assert.equal(result.outputPath, outputPath);
  assert.equal(result.actualDuration, 42);
  assert.equal(commands.length, 1);
  assert.ok(commands[0].args.includes('concat'));
  assert.ok(commands[0].args.includes('-an'));
  assert.ok(commands[0].args.includes('-c:v'));
}));
