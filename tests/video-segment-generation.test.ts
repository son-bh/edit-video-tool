import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSegmentTimeline,
  concatSegmentFolder,
  VideoSegmentGenerationError,
  computeExpectedConcatDuration,
  createSegmentPlan,
  discoverSourceVideos,
  executeSegmentPlan,
  generateVideoSegments,
  getConcatDurationTolerance,
  parseSegmentSrtText,
  resolveVideoRenderPreset,
  selectVideoForCue
} from '../src/video-segment-generation';

function withTempDir(callback: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-segment-generation-'));

  try {
    callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sampleSrt(): string {
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

function sampleSrtWithGaps(): string {
  return [
    '1',
    '00:00:01,200 --> 00:00:04,000',
    'First cue',
    '',
    '2',
    '00:00:05,500 --> 00:00:08,000',
    'Second cue',
    '',
    '3',
    '00:00:09,250 --> 00:00:12,750',
    'Third cue',
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

test('buildSegmentTimeline preserves inter-cue gaps so final timeline matches SRT end time', () => {
  const cues = buildSegmentTimeline(parseSegmentSrtText(sampleSrtWithGaps()));

  assert.equal(cues.length, 3);
  assert.equal(cues[0].segmentDuration, 5.5);
  assert.equal(cues[1].segmentDuration, 3.75);
  assert.equal(cues[2].segmentDuration, 3.5);

  const totalSegmentDuration = cues.reduce((sum, cue) => sum + (cue.segmentDuration || 0), 0);
  assert.equal(totalSegmentDuration, 12.75);
  assert.equal(cues[cues.length - 1].end, 12.75);
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
    createSegmentPlan({ index: 1, duration: 10, start: 0, end: 10, text: '' }, 'video.mp4', 10).parts,
    [{ kind: 'full', duration: 10 }]
  );
  assert.equal(createSegmentPlan({ index: 1, duration: 10, start: 0, end: 10, text: '' }, 'video.mp4', 10).operation, 'copy');

  assert.deepEqual(
    createSegmentPlan({ index: 2, duration: 8, start: 0, end: 8, text: '' }, 'video.mp4', 10).parts,
    [{ kind: 'cut', duration: 8 }]
  );
  assert.equal(createSegmentPlan({ index: 2, duration: 8, start: 0, end: 8, text: '' }, 'video.mp4', 10).operation, 'cut');

  assert.deepEqual(
    createSegmentPlan({ index: 3, duration: 13, start: 0, end: 13, text: '' }, 'video.mp4', 10).parts,
    [{ kind: 'full', duration: 10 }, { kind: 'cut', duration: 3 }]
  );
  assert.equal(createSegmentPlan({ index: 3, duration: 13, start: 0, end: 13, text: '' }, 'video.mp4', 10).operation, 'concat');

  assert.deepEqual(
    createSegmentPlan({ index: 4, duration: 24, start: 0, end: 24, text: '' }, 'video.mp4', 10).parts,
    [{ kind: 'full', duration: 10 }, { kind: 'full', duration: 10 }, { kind: 'cut', duration: 4 }]
  );
});

test('createSegmentPlan uses segmentDuration when timeline gaps are preserved', () => {
  const plan = createSegmentPlan(
    { index: 1, duration: 2.8, segmentDuration: 5.5, start: 0, end: 2.8, text: '' },
    'video.mp4',
    10
  );

  assert.equal(plan.operation, 'cut');
  assert.deepEqual(plan.parts, [{ kind: 'cut', duration: 5.5 }]);
});

test('resolveVideoRenderPreset returns supported presets and rejects invalid values', () => {
  assert.deepEqual(resolveVideoRenderPreset('16:9'), {
    key: '16:9',
    width: 2560,
    height: 1440,
    label: '2K'
  });
  assert.deepEqual(resolveVideoRenderPreset('9:16'), {
    key: '9:16',
    width: 1080,
    height: 1920,
    label: '1080p'
  });
  assert.throws(() => resolveVideoRenderPreset('1:1'), /Unsupported aspect ratio/);
});

test('executeSegmentPlan builds ffmpeg cut and concat commands', () => withTempDir((dir) => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const commandRunner = (command: string, args: string[]) => {
    commands.push({ command, args });
    return '';
  };
  const sourceVideo = path.join(dir, 'source.mp4');
  const outputPath = path.join(dir, 'segment.mp4');
  fs.writeFileSync(sourceVideo, '');

  executeSegmentPlan(
    createSegmentPlan({ index: 1, start: 0, end: 7.5, duration: 7.5, text: '' }, sourceVideo, 10),
    outputPath,
    { commandRunner, ffmpegPath: 'ffmpeg' }
  );

  assert.equal(commands.length, 1);
  assert.ok(commands[0].args.includes('-t'));
  assert.ok(commands[0].args.includes('7.500'));

  commands.length = 0;
  executeSegmentPlan(
    createSegmentPlan({ index: 2, start: 0, end: 24, duration: 24, text: '' }, sourceVideo, 10),
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
  const commands: Array<{ command: string; args: string[] }> = [];

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
  const commands: Array<{ command: string; args: string[] }> = [];

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
        return 30;
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
  assert.equal(result.actualDuration, 30);
  assert.equal(result.expectedDuration, 30);
  assert.equal(commands.length, 1);
  assert.ok(commands[0].args.includes('concat'));
  assert.ok(commands[0].args.includes('-an'));
  assert.ok(commands[0].args.includes('libx264'));
  assert.ok(commands[0].args.includes('-pix_fmt'));
  const filterIndex = commands[0].args.indexOf('-vf');
  assert.notEqual(filterIndex, -1);
  assert.match(commands[0].args[filterIndex + 1], /scale=2560:1440/);
}));

test('concatSegmentFolder applies the 9:16 preset to final rendering', () => withTempDir((dir) => {
  const segmentDir = path.join(dir, 'segments');
  const outputPath = path.join(dir, 'final', 'final.mp4');
  const commands: Array<{ command: string; args: string[] }> = [];

  fs.mkdirSync(segmentDir);
  fs.writeFileSync(path.join(segmentDir, 'segment-001.mp4'), '');

  const result = concatSegmentFolder({
    segmentDir,
    outputPath,
    aspectRatio: '9:16',
    ffmpegPath: 'ffmpeg',
    commandRunner: (command, args) => {
      commands.push({ command, args });
      return '';
    },
    durationProbe: (filePath) => {
      if (filePath === outputPath) {
        return 6;
      }

      return 6;
    }
  });

  assert.equal(result.videoRenderPreset.key, '9:16');
  const filterIndex = commands[0].args.indexOf('-vf');
  assert.notEqual(filterIndex, -1);
  assert.match(commands[0].args[filterIndex + 1], /scale=1080:1920/);
}));

test('computeExpectedConcatDuration sums segment durations', () => {
  const result = computeExpectedConcatDuration(['one.mp4', 'two.mp4', 'three.mp4'], {
    durationProbe: (filePath) => {
      if (filePath === 'one.mp4') {
        return 3.5;
      }

      if (filePath === 'two.mp4') {
        return 4;
      }

      return 5.25;
    }
  });

  assert.equal(result, 12.75);
});

test('getConcatDurationTolerance scales for larger concat jobs', () => {
  assert.equal(getConcatDurationTolerance(1), 0.25);
  assert.equal(getConcatDurationTolerance(20), 1);
  assert.equal(getConcatDurationTolerance(200), 5);
});

test('concatSegmentFolder rejects final duration mismatches', () => withTempDir((dir) => {
  const segmentDir = path.join(dir, 'segments');
  const outputPath = path.join(dir, 'final', 'final.mp4');

  fs.mkdirSync(segmentDir);
  fs.writeFileSync(path.join(segmentDir, 'segment-001.mp4'), '');
  fs.writeFileSync(path.join(segmentDir, 'segment-002.mp4'), '');

  assert.throws(() => concatSegmentFolder({
    segmentDir,
    outputPath,
    ffmpegPath: 'ffmpeg',
    commandRunner: () => '',
    durationProbe: (filePath) => {
      if (filePath === outputPath) {
        return 9;
      }

      return 6;
    }
  }), /Final video duration mismatch/);
}));
