# edit-video-tool

Node.js CLI for turning a JSON script plus audio into subtitles, then turning subtitle timing into ordered video segments and a final concatenated video.

## What It Does

The tool supports four workflows:

1. Generate `script.srt` from `script.json` and an audio or video file.
2. Generate one video segment per SRT cue from a folder of source videos.
3. Concatenate all generated segments into one final video.
4. Run the same workflows from a browser-based web UI.

The final subtitle text always comes from JSON. Whisper is used only to derive timing from the media.

## Requirements

- Node.js `20+`
- `ffmpeg`
- `ffprobe`
- Python Whisper CLI for media transcription, optional if you upload `script.whisper.srt`

Tool path configuration:

- `.env`
- CLI flags
- existing process environment

Create a `.env` file in the repo root:

```dotenv
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
WHISPER_COMMAND_PATH=whisper
WEB_UI_HOST=127.0.0.1
WEB_UI_PORT=3000
WEB_UI_WORKSPACE_ROOT=.tmp-web-ui
```

Override these with:

- `--ffmpeg` or `FFMPEG_PATH`
- `--ffprobe` or `FFPROBE_PATH`
- `--whisper-command` or `WHISPER_COMMAND_PATH`

CLI flags still win over `.env`.

If the tools are already available on `PATH`, prefer command names like `ffmpeg`, `ffprobe`, and `whisper`. That keeps the same config portable across Windows, Linux, and macOS.

## One-Time Setup

If you share this project as a zip file, do not include `node_modules`, Python environments, or Whisper model/runtime folders. After extracting the zip on Windows, run:

```powershell
.\setup.cmd
```

What setup does:

- installs `node` and `npm` automatically with WinGet if missing
- installs `ffmpeg` and `ffprobe` automatically with WinGet if missing
- detects `whisper` if available
- creates or updates `.env`
- writes detected executable paths into `.env`
- runs `npm install`
- starts the web UI server
- opens the configured web UI URL in the default browser

Installer notes:

- The automatic install path is Windows-only and uses `winget`.
- If `winget` is not available, setup stops with a clear error and the machine must be fixed first.
- Whisper is optional during setup because the web UI can also accept an uploaded `script.whisper.srt` file.

## Install

```bash
npm install
```

## Project Structure

- `src/cli.js`: CLI entrypoint
- `src/web/server.js`: web UI server entrypoint
- `src/web/app.js`: Express app, routes, upload handling, and download endpoints
- `src/web/media-worker.js`: background worker for subtitle and video jobs
- `src/subtitle-generation.js`: JSON validation, Whisper transcript creation, transcript mapping, SRT generation
- `src/video-segment-generation.js`: SRT-driven segment generation and final concat
- `src/logger.js`: Winston logger setup
- `tests/`: automated tests
- `docs/subtitle-generation.md`: detailed workflow notes
- `assets/`: local sample inputs and outputs for manual verification

## Input Format

JSON input must be an array of objects with non-empty `text` values:

```json
[
  { "text": "Something" },
  { "text": "Something 2" }
]
```

Current JSON item limit: `100`

## Commands

Show CLI help:

```bash
npm run generate-subtitles -- --help
```

Run tests:

```bash
npm test
```

### Web UI

Start the browser UI:

```bash
npm run web-ui
```

For a zip-based handoff, the practical flow is:

1. extract the zip
2. run `.\setup.cmd` once
3. run `npm run web-ui`

Open:

```text
http://127.0.0.1:3000
```

The web UI flow:

1. Upload one audio or video file and one `script.json` file.
2. Optional: upload an existing `script.whisper.srt` file to skip audio transcription and map directly to `script.json`.
3. Start subtitle generation and wait for `script.srt` creation.
4. Download `script.whisper.srt` and `script.srt` after the job completes.
5. Either keep the current subtitle job active or upload an existing `script.srt` again after a page reload.
6. Upload source videos.
7. Start video generation.
8. Download the segment zip and final video after completion.

Web UI notes:

- Long-running media work runs in background worker processes so the server can keep serving status requests.
- Status is polled from the browser and shows stage, percent, and message.
- Uploaded and generated files are stored under `WEB_UI_WORKSPACE_ROOT`.
- File inputs can be cleared directly in the page before submitting.

### 1. Generate Subtitles

Full flow:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en
```

This does two steps:

1. Create a raw Whisper subtitle file.
2. Map Whisper timing back to the JSON items and write the final SRT.

Outputs:

- `assets/script/script.whisper.srt`: raw Whisper transcript
- `assets/script/script.srt`: final JSON-mapped subtitle file

Create only the raw Whisper transcript:

```bash
npm run generate-subtitles -- --audio assets/audio/audio.MP3 --transcribe-only --transcript-out assets/script/script.whisper.srt --language en
```

Map an existing Whisper transcript without transcribing again:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-in assets/script/script.whisper.srt --language en
```

Use a smaller Whisper model on CPU:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en --whisper-model tiny.en
```

Git Bash example:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt
```

### 2. Generate Video Segments

Generate one output video per subtitle cue:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments
```

The segment workflow:

1. Parse each SRT cue start and end time.
2. Compute cue duration, add a `0.5s` segment buffer, then round it to whole seconds. Any fractional milliseconds round up to the next full second.
3. Select the source video by cue order.
4. Create an output segment that matches the cue duration.

Duration behavior:

- If the cue duration matches the source video duration within tolerance, copy the source video.
- If the cue duration is shorter, cut the source video from `0` to the cue duration.
- If the cue duration is longer, repeat and concatenate the source video until the target duration is reached.

Example:

- `13s` cue with a `10s` source video becomes `10 + 3`
- `24s` cue with a `10s` source video becomes `10 + 10 + 4`

By default, the command fails if there are more cues than source videos. To intentionally reuse videos from the beginning:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments --loop-videos
```

Set a custom duration validation tolerance:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments --duration-tolerance 0.5
```

### 3. Concatenate All Segments

After segments are generated, concatenate them into one final video:

```bash
npm run generate-video-segments -- --concat-segments assets/segments --final-out assets/final/final.mp4
```

This reads segment files in deterministic filename order, re-encodes the final concat with `ffmpeg`, removes the audio track from the final output video, and validates that the final duration matches the sum of the segment durations within tolerance.

## Processing Rules

### Subtitle generation

- JSON is the source of truth for final subtitle text.
- Final subtitle text must exactly match the JSON `text` field.
- The tool does not paraphrase, rewrite, split, or merge JSON text.
- If Whisper transcript text cannot be matched reliably to JSON, generation fails with a clear error.

### Video segment generation

- Cue `1` maps to video `1`, cue `2` maps to video `2`, and so on.
- Segment files are generated in subtitle order.
- Final segment duration is validated against the subtitle cue duration.

## Logging

The CLI uses Winston for progress logs. Disable them with:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --quiet
```

The web UI keeps its own in-memory job state and browser-visible progress based on worker progress updates.

## Common Errors

Examples of cases that fail fast:

- malformed JSON
- missing or empty `text` fields
- more than `100` JSON items
- missing media file
- `ffmpeg` or `ffprobe` path issues
- Whisper transcript creation failure
- transcript text does not match the JSON sequence
- invalid SRT timestamps
- more subtitle cues than videos without `--loop-videos`

## Development Notes

- Runtime: CommonJS on Node.js
- Logging: Winston
- Tests: Node test runner via `node --test`
- Detailed workflow notes: `docs/subtitle-generation.md`
