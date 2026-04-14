import fs from 'node:fs';
import path from 'node:path';

import { formatSrt } from '../../../subtitle/srt';
import {
  createWhisperSubtitleFile,
  generateSubtitles,
  mapJsonItemsToTranscriptFile,
  parseSubtitleJsonFile,
  shouldUseTranscriptAlignment
} from '../../../subtitle-generation';
import {
  concatSegmentFolder,
  generateVideoSegments,
  muxVideoWithAudio,
  renderVideoWithAudioAndSubtitles
} from '../../../video-segment-generation';
import { zipDirectory } from './archive';
import { createProgressReporter, createSubtitleLogger, createVideoLogger } from './progress';

function send(message: unknown): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

async function runSubtitleJob(payload: any, progress: ReturnType<typeof createProgressReporter>): Promise<void> {
  const transcriptPath = path.join(payload.workspace.outputs, 'script.whisper.srt');
  const scriptSrtPath = path.join(payload.workspace.outputs, 'script.srt');
  const logger = createSubtitleLogger(progress);
  const alignment = {
    ffmpegPath: payload.ffmpegPath,
    whisperCommandPath: payload.whisperCommandPath,
    whisperModel: payload.whisperModel,
    whisperModelPath: payload.whisperModelPath,
    language: payload.language,
    logger
  };

  progress.update({
    stage: 'preparing-subtitle',
    percent: 5,
    message: 'Preparing subtitle generation job'
  });

  if (payload.transcriptPath) {
    progress.update({
      stage: 'mapping-subtitles',
      percent: 55,
      message: 'Mapping uploaded transcript to script items'
    });

    const items = parseSubtitleJsonFile(payload.jsonPath, { logger });
    const cues = mapJsonItemsToTranscriptFile(items, payload.transcriptPath, { logger });
    const output = formatSrt(cues);
    fs.writeFileSync(scriptSrtPath, output, 'utf8');

    progress.complete({
      transcriptSrt: payload.transcriptPath,
      scriptSrt: scriptSrtPath
    });
    return;
  }

  if (shouldUseTranscriptAlignment(alignment)) {
    progress.update({
      stage: 'creating-transcript',
      percent: 15,
      message: 'Creating Whisper transcript'
    });

    createWhisperSubtitleFile(payload.audioPath, {
      ...alignment,
      transcriptOutputPath: transcriptPath
    });

    progress.update({
      stage: 'mapping-subtitles',
      percent: 55,
      message: 'Mapping transcript timing to script items'
    });

    generateSubtitles({
      jsonPath: payload.jsonPath,
      audioPath: payload.audioPath,
      outputPath: scriptSrtPath,
      alignment: {
        ...alignment,
        transcriptInputPath: transcriptPath,
        transcriptOutputPath: transcriptPath
      }
    });

    progress.complete({
      transcriptSrt: transcriptPath,
      scriptSrt: scriptSrtPath
    });
    return;
  }

  progress.update({
    stage: 'aligning-audio',
    percent: 40,
    message: 'Using fallback audio alignment'
  });

  generateSubtitles({
    jsonPath: payload.jsonPath,
    audioPath: payload.audioPath,
    outputPath: scriptSrtPath,
    alignment: {
      ...alignment,
      useTranscript: false
    }
  });

  progress.complete({
    scriptSrt: scriptSrtPath
  });
}

async function runVideoJob(payload: any, progress: ReturnType<typeof createProgressReporter>): Promise<void> {
  const segmentZipPath = path.join(payload.workspace.outputs, 'segments.zip');
  const finalVideoPath = path.join(payload.workspace.outputs, 'final-video.mp4');
  const finalVideoWithAudioPath = path.join(payload.workspace.outputs, 'final-video-with-audio.mp4');
  const finalVideoWithAudioSubtitlesPath = path.join(payload.workspace.outputs, 'final-video-with-audio-subtitles.mp4');
  const logger = createVideoLogger(progress);

  progress.update({
    stage: 'preparing-video',
    percent: 45,
    message: 'Preparing video generation job'
  });

  progress.update({
    stage: 'generating-segments',
    percent: 50,
    message: 'Generating video segments'
  });

  generateVideoSegments({
    srtPath: payload.scriptSrtPath,
    videoDir: payload.videosDir,
    outputDir: payload.workspace.segments,
    ffmpegPath: payload.ffmpegPath,
    ffprobePath: payload.ffprobePath,
    loopVideos: payload.loopVideos,
    durationToleranceSeconds: payload.durationToleranceSeconds,
    logger
  });

  progress.update({
    stage: 'concatenating-final-video',
    percent: 92,
    message: 'Concatenating final video'
  });

  concatSegmentFolder({
    segmentDir: payload.workspace.segments,
    outputPath: finalVideoPath,
    ffmpegPath: payload.ffmpegPath,
    ffprobePath: payload.ffprobePath,
    aspectRatio: payload.aspectRatio,
    logger
  });

  const completedOutputs: Record<string, string> = {
    segmentZip: segmentZipPath,
    finalVideo: finalVideoPath,
    segmentsDir: payload.workspace.segments
  };

  if (payload.audioPath) {
    progress.update({
      stage: 'muxing-final-video-audio',
      percent: 95,
      message: 'Generating final video with audio'
    });

    muxVideoWithAudio({
      videoPath: finalVideoPath,
      audioPath: payload.audioPath,
      outputPath: finalVideoWithAudioPath,
      ffmpegPath: payload.ffmpegPath,
      ffprobePath: payload.ffprobePath,
      logger
    });

    completedOutputs.finalVideoWithAudio = finalVideoWithAudioPath;

    progress.update({
      stage: 'burning-subtitles',
      percent: 97,
      message: 'Generating final video with audio and subtitles'
    });

    renderVideoWithAudioAndSubtitles({
      videoPath: finalVideoWithAudioPath,
      subtitlePath: payload.scriptSrtPath,
      outputPath: finalVideoWithAudioSubtitlesPath,
      ffmpegPath: payload.ffmpegPath,
      ffprobePath: payload.ffprobePath,
      logger
    });

    completedOutputs.finalVideoWithAudioSubtitles = finalVideoWithAudioSubtitlesPath;
  }

  progress.update({
    stage: 'packaging-downloads',
    percent: 99,
    message: 'Packaging generated segments'
  });

  await zipDirectory(payload.workspace.segments, segmentZipPath);

  progress.complete(completedOutputs);
}

process.on('message', async (message: any) => {
  if (!message || message.type !== 'start') {
    return;
  }

  const progress = createProgressReporter(send);

  try {
    if (message.jobType === 'subtitle') {
      await runSubtitleJob(message.payload, progress);
    } else if (message.jobType === 'video') {
      await runVideoJob(message.payload, progress);
    } else {
      throw new Error(`Unsupported job type: ${message.jobType}`);
    }

    process.exit(0);
  } catch (error) {
    progress.fail((error as Error).message || String(error));
    process.exit(1);
  }
});
