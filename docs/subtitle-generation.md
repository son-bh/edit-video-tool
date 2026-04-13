# Subtitle Generation

Generate a final SRT file from a script file and an audio/video file.

The script file is the source of truth for subtitle text. Whisper is used to create timing from the audio, then the tool maps Whisper subtitle segments back to the script items. The final subtitle text is copied exactly from the script input.

## Current Scope

- Runtime: Node.js 20 or newer.
- Script input:
  - `.json`: an array of objects with non-empty `text` string fields
  - `.txt`: one subtitle item per non-empty line
- Current limit: 100 script items.
- Audio input: any audio/video format that `ffmpeg` can decode, such as MP3, MP4, M4A, MOV, AAC, and WAV.
- Raw transcript output: Whisper-generated SRT.
- Final output: script-mapped SRT.
- Tool paths are loaded from `.env`, CLI flags, or the current process environment.

Example `.env`:

```dotenv
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
WHISPER_COMMAND_PATH=whisper
WEB_UI_HOST=127.0.0.1
WEB_UI_PORT=3000
WEB_UI_WORKSPACE_ROOT=.tmp-web-ui
```

Override tool paths with `--ffmpeg`, `FFMPEG_PATH`, `--whisper-command`, or `WHISPER_COMMAND_PATH`. CLI flags override `.env`.

For cross-platform setup, prefer command names on `PATH` instead of Windows-only absolute executable paths.

## Flow

The normal command runs two steps:

1. Create a raw Whisper subtitle file from the audio.
2. Read the raw Whisper subtitle file, accumulate Whisper segments until their normalized text matches the current script item, then copy the accumulated start/end time onto the exact script text.

If the current accumulated Whisper text does not match the current script item, the mapper continues accumulating Whisper segments. If it still cannot match, generation fails with a mismatch error instead of guessing.

## Commands

Run tests:

```bash
node --test
```

Start the web UI:

```bash
npm run web-ui
```

The web UI lets the user:

1. Upload audio plus `script.json` or `script.txt`
2. Optional: upload `script.whisper.srt` with `script.json` or `script.txt` to skip audio transcription
3. Start subtitle generation and track progress
4. Download `script.whisper.srt` and `script.srt`
5. Upload `script.srt` again after a page reload if the earlier subtitle job is no longer in browser state
6. Optional: upload the original audio again in the video section after a page reload
7. Upload multiple source videos for the same job
8. Start segment generation and final rendering
9. Download a segment zip plus the rendered 2K outputs
10. If audio is available from either the subtitle job or the video form upload, download:
    - `final-video.mp4` as a silent 2K final
    - `final-video-with-audio.mp4` as a 2K final with audio
    - `final-video-with-audio-subtitles.mp4` as a 2K final with burned subtitles

The page also provides clear buttons for the selected upload files before submission.

Run the full flow in one command:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en
```

This creates:

- `assets/script/script.whisper.srt`: raw Whisper subtitle file
- `assets/script/script.srt`: final script-mapped subtitle file

Create only the raw Whisper subtitle file:

```bash
npm run generate-subtitles -- --audio assets/audio/audio.MP3 --transcribe-only --transcript-out assets/script/script.whisper.srt --language en
```

Map an existing Whisper subtitle file without transcribing again:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-in assets/script/script.whisper.srt --language en
```

Use a faster Python Whisper model on CPU:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en --whisper-model tiny.en
```

Use a custom `ffmpeg` path:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en --ffmpeg /path/to/ffmpeg
```

Use a custom Python Whisper command:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en --whisper-command /path/to/whisper
```

## Video Segment Generation

After `script.srt` exists, generate one video segment per subtitle cue:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments
```

The command:

1. Parses each SRT cue start/end timestamp.
2. Preserves the subtitle timeline, including gaps between cues, so the final concatenated video can reach the last `script.srt` end time.
3. Reads source videos from the video folder in deterministic filename order.
4. Maps cue 1 to video 1, cue 2 to video 2, and so on.
5. Uses `ffmpeg` to create `segment-001.mp4`, `segment-002.mp4`, etc.

Duration behavior:

- Each generated segment uses the cue's timeline span, not only the visible subtitle text duration. For non-last cues, that means the segment runs until the next cue start so subtitle gaps are preserved.
- If the target segment duration equals the selected source video duration within tolerance, the video is copied with `ffmpeg`.
- If the target segment duration is shorter than the source video duration, the source video is cut from `0` to the target segment duration.
- If the target segment duration is longer than the source video duration, the source video is repeated and concatenated. For example, a 24-second timeline span with a 10-second source video becomes `10 + 10 + 4`.

By default, generation fails if there are more SRT cues than source videos:

```text
Missing source video for subtitle cue N
```

To intentionally reuse videos from the beginning, pass `--loop-videos`:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments --loop-videos
```

Use a custom tolerance for output duration validation:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments --duration-tolerance 0.5
```

Use a custom `ffprobe` path:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments --ffprobe /path/to/ffprobe
```

## Final Video Concat

After all segment videos are generated, concatenate them into one final video:

```bash
npm run generate-video-segments -- --concat-segments assets/segments --final-out assets/final/final.mp4
```

This command:

1. Reads all segment videos from the segment folder in deterministic filename order.
2. Builds an ffmpeg concat list.
3. Concatenates the segment files into one final output video and re-encodes the final stream for more reliable timing across many segments.
4. Scales and pads the final rendered outputs to 2K (`2560x1440`) while preserving aspect ratio.
5. Removes the audio track from the silent final output video.
6. Probes the segment durations and the final output duration, then fails if the final file duration does not match the segment total within tolerance.

When the web UI video job has access to the original uploaded media file from subtitle generation, it also runs one extra ffmpeg step after the silent final concat:

1. Read the generated silent 2K `final-video.mp4`
2. Read the original uploaded audio or video file
3. Map video from the silent final file and audio from the original media
4. If the generated video is longer than the uploaded audio, trim the output to the uploaded audio duration by default
5. Write `final-video-with-audio.mp4`
6. Burn `script.srt` into the video so subtitles show at the bottom
7. Write `final-video-with-audio-subtitles.mp4`
8. Expose separate download buttons for those outputs in the UI

If the video workflow starts only from an uploaded `script.srt` plus source videos, the UI can still create a `final-video-with-audio.mp4` when the user uploads audio in the video section. Without any audio source, the UI only exposes the silent final video download.

Use a custom `ffmpeg` or `ffprobe` path if needed:

```bash
npm run generate-video-segments -- --concat-segments assets/segments --final-out assets/final/final.mp4 --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe
```

## Script Formats

```json
[
  { "text": "Something" },
  { "text": "Something 2" }
]
```

```text
Something
Something 2
```

## Error Behavior

The tool rejects generation when:

- the script file type is not `.json` or `.txt`
- the JSON file is malformed or not an array
- a JSON item is missing a non-empty `text` string
- the text file contains no non-empty lines
- the script list contains more than 100 items
- the audio file is missing or unreadable
- `ffmpeg` cannot decode the audio/video file
- Python Whisper cannot create the raw subtitle file
- accumulated Whisper subtitle text cannot be matched to the current script item
- generated timestamps are invalid or unexpectedly overlap

Successful output contains exactly one SRT cue per script item, in input order, with cue text exactly equal to the corresponding script text.
