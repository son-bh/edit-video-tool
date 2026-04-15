# Repository Guidelines

## Project Structure & Module Organization

This project is a Node.js TypeScript web application compiled to CommonJS for generating subtitle files from JSON script text and matching audio/video timing.

- `src/subtitle/` contains script parsing, audio/transcript handling, Whisper mapping, SRT formatting, and subtitle orchestration.
- `src/video/` contains SRT-driven segment generation, ffmpeg helpers, render presets, and final output orchestration.
- `src/app/` contains the Express server, routes, controllers, middleware, auth, jobs, and workspace services.
- `src/logger.ts` creates the Winston logger used for processing progress logs.
- `tests/*.test.ts` contains the automated Node test suite compiled into `dist/tests/`.
- `docs/subtitle-generation.md` documents the supported web workflow and deployment-facing configuration.
- `assets/audio/` and `assets/script/` contain local sample media/script files used for manual verification.
- `openspec/specs/` contains the synced OpenSpec capability spec. Archived change history is under `openspec/changes/archive/`.

Do not edit `node_modules/` directly. Keep generated or temporary media artifacts out of source changes unless the user explicitly asks to keep them.

## Build, Test, and Development Commands

Use the checked-in npm scripts:

- `npm install`: install dependencies.
- `npm test`: run the automated test suite.
- `node --test`: equivalent direct test command.
- `npm run build`: compile the TypeScript sources into `dist/`.
- `npm run web-ui`: build and start the web UI server.

Tool paths are normally loaded from a repo-root `.env` file:

```dotenv
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
WHISPER_COMMAND_PATH=${LOCALAPPDATA}\Python\pythoncore-3.14-64\Scripts\whisper.exe
```

Override these with `.env` or process environment. The web app does not expose CLI overrides.

## Subtitle Generation Flow

The JSON file is the source of truth for final subtitle text. The expected JSON shape is:

```json
[
  { "text": "Something" },
  { "text": "Something 2" }
]
```

The normal workflow is:

1. Validate the JSON array and each non-empty `text` value.
2. Generate a raw Whisper SRT from the audio/video file.
3. Read the Whisper SRT and accumulate transcript segments until they match the current JSON item.
4. Copy the matched transcript timing onto the exact JSON text.
5. Write the final SRT with exactly one cue per JSON item.

Do not paraphrase, normalize, split, merge, or rewrite final subtitle text. If transcript text cannot be matched to the JSON item reliably, fail with a clear error instead of guessing.

## Coding Style & Naming Conventions

Use TypeScript modules with two-space indentation. The compiled runtime stays CommonJS. Prefer descriptive function names that reflect the subtitle or media behavior being implemented. Keep dependencies minimal and only introduce new packages when they are required for the requested task.

Use Winston for progress logging. Keep logs useful for following the processing flow without dumping large transcript or media contents.

## Testing Guidelines

Add or update tests for every behavior change, especially around:

- JSON validation and item limits.
- Whisper transcript parsing and mapping.
- Exact JSON text preservation.
- Timestamp validation and SRT formatting.
- Web route validation and error messages.
- Tool path defaults and overrides.

Prefer deterministic generated fixtures in tests over large binary files. Manual runs may use `assets/audio/` and `assets/script/`, but avoid adding large new media samples unless the user requests them.

## Commit & Pull Request Guidelines

This directory does not currently contain Git metadata, so no existing commit convention can be inferred. If Git is initialized later, use concise imperative commit messages such as `Add transcript mapping validation`. Pull requests should describe the change, list test commands run, link related issues, and include sample output details for subtitle/media behavior.

## Agent-Specific Instructions

Keep changes scoped to the requested task. Do not introduce unrelated build tooling or refactors. When editing the subtitle workflow, update `docs/subtitle-generation.md` and tests if the user-facing flow or behavior changes.

Long Whisper transcription can take many minutes on CPU. If running end-to-end web flows in development, use a long timeout and check for leftover `node`, `python`, or `whisper` processes if the command is interrupted.
