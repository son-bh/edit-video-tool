# edit-video-tool

Node.js web application for turning a JSON or text script plus audio into subtitles, then turning subtitle timing into ordered video segments and final rendered videos.

## What It Does

The tool supports two main browser workflows:

1. Generate `script.whisper.srt` and `script.srt` from a script file and an audio or video file.
2. Generate video segments and final rendered videos from `script.srt` plus a folder of source videos.

The final subtitle text always comes from the uploaded script file. Whisper is used only to derive timing from the media.

## Requirements

- Node.js `20+`
- `ffmpeg`
- `ffprobe`
- Python Whisper CLI for media transcription, optional if you upload `script.whisper.srt`

Tool path configuration:

- `.env`
- existing process environment

Create a `.env` file in the repo root:

```dotenv
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
WHISPER_COMMAND_PATH=whisper
WEB_UI_HOST=127.0.0.1
WEB_UI_PORT=3000
WEB_UI_WORKSPACE_ROOT=.tmp-web-ui
PUBLIC_BASE_URL=https://your-domain.example
```

Override these through `.env` or the process environment:

- `FFMPEG_PATH`
- `FFPROBE_PATH`
- `WHISPER_COMMAND_PATH`
- `PUBLIC_BASE_URL`

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

Build the TypeScript runtime:

```bash
npm run build
```

## Project Structure

- `src/*.ts`: TypeScript source
- `src/subtitle/`: subtitle parsing, transcript, audio, alignment, and orchestration modules
- `src/video/`: SRT parsing, segment planning, ffmpeg helpers, render presets, and final video orchestration
- `src/app/`: Express app shell with config, routes, controllers, middleware, and app-level services
- `public/app.ts`: browser UI logic compiled into `dist/public/app.js`
- `dist/`: compiled runtime output from `npm run build`
- `tests/`: automated tests
- `docs/subtitle-generation.md`: detailed workflow notes
- `assets/`: local sample inputs and outputs for manual verification

## Input Format

Script input can be either:

- `.json`: an array of objects with non-empty `text` values
- `.txt`: one subtitle item per non-empty line

JSON example:

```json
[
  { "text": "Something" },
  { "text": "Something 2" }
]
```

Current JSON item limit: `100`

## Commands

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

1. Upload one audio or video file and one `script.json` or `script.txt` file.
2. Optional: upload an existing `script.whisper.srt` file to skip audio transcription and map directly to the uploaded script file.
3. Start subtitle generation and wait for `script.srt` creation.
4. Download `script.whisper.srt` and `script.srt` after the job completes.
5. Either keep the current subtitle job active or upload an existing `script.srt` again after a page reload.
6. Upload source videos.
7. Start video generation.
8. Download the segment zip and final video after completion.

Web UI output filenames are generated from the uploaded script name. For example, uploading `my-story.json` produces downloads such as `my-story.whisper.srt`, `my-story.srt`, `my-story-segments.zip`, and `my-story-final-video-16x9-2k.mp4`.

If `PUBLIC_BASE_URL` and Google Sheets sync are configured, each completed job also updates one row in the target sheet with public URLs for:

- final script SRT
- final silent video
- final video + audio
- final video + audio + subtitles

The public links use:

```text
https://your-domain.example/media/<username>/<job-folder>/<file-name>
```

Only top-level generated files under each job's `outputs/` folder are exposed through that route.

Google Sheets configuration now lives in constants inside [google-sheets.ts](C:\Users\sonbh\Documents\workspace\tool\edit-video-tool\src\app\services\publication\google-sheets.ts), including:

- `USER_GOOGLE_SHEETS`: maps each `ownerKey` to that user's spreadsheet ID
- `DEFAULT_GOOGLE_SHEETS_SHEET_NAME`: fixed tab name, currently `Video`
- `DEFAULT_GOOGLE_SERVICE_ACCOUNT_FILE`: default credential path, currently `config/service_account.json`

Web UI notes:

- Long-running media work runs in background worker processes so the server can keep serving status requests.
- Status is polled from the browser and shows stage, percent, and message.
- Uploaded and generated files are stored under `WEB_UI_WORKSPACE_ROOT`.
- File inputs can be cleared directly in the page before submitting.

### Subtitle Generation In The Web UI

The subtitle workflow does two steps in the background worker:

1. Create a raw Whisper subtitle file.
2. Map Whisper timing back to the script items and write the final SRT.

Outputs are stored in the job workspace and exposed as downloads from the page:

- `<script-name>.whisper.srt`
- `<script-name>.srt`

The final subtitle text must exactly match the uploaded script items. The worker does not paraphrase, split, or rewrite subtitle text.

### Video Generation In The Web UI

The video workflow:

1. Parses each SRT cue start and end time.
2. Preserves the subtitle timeline, including gaps between cues.
3. Selects the source video by cue order.
4. Creates one output segment per cue.
5. Concatenates the generated segments into a silent final video.
6. Optionally creates final video + audio and final video + audio + subtitles.

Outputs are stored in the job workspace and exposed as downloads from the page:

- `<script-name>-segments.zip`
- `<script-name>-final-video-16x9-2k.mp4` or `<script-name>-final-video-9x16-1080p.mp4`
- matching `-audio.mp4` and `-audio-subtitles.mp4` variants when audio is available

## Processing Rules

### Subtitle generation

- The uploaded script file is the source of truth for final subtitle text.
- Final subtitle text must exactly match each script item.
- The tool does not paraphrase, rewrite, split, or merge script text.
- If Whisper transcript text cannot be matched reliably to the script sequence, generation fails with a clear error.

### Video segment generation

- Cue `1` maps to video `1`, cue `2` maps to video `2`, and so on.
- Segment files are generated in subtitle order.
- Final segment duration is validated against the subtitle cue duration.

## Logging

The app uses Winston for processing logs. The web UI keeps its own in-memory job state and browser-visible progress based on worker progress updates.

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
- more subtitle cues than videos when video reuse is not enabled in the web flow

## Development Notes

- Runtime: TypeScript compiled to CommonJS on Node.js
- Logging: Winston
- Tests: Node test runner via `npm test`
- Detailed workflow notes: `docs/subtitle-generation.md`
