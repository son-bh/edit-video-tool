## Why

The current project can generate subtitles, segments, and final videos, but only through CLI commands. A template-based web UI is needed so the same workflows can be run interactively with uploads, visible progress, and downloads, without reimplementing the existing processing logic.

## What Changes

- Add a Node.js web server with server-rendered templates for the existing subtitle and video workflows.
- Add UI flows for uploading an audio file and `script.json`, starting subtitle generation, tracking progress, and downloading the final `script.srt`.
- Add UI flows for uploading multiple source videos after subtitle generation, starting segment generation and final concat, and downloading the segment bundle and final video.
- Add backend job orchestration, upload handling, progress reporting, and download endpoints that reuse the existing `subtitle-generation` and `video-segment-generation` modules.
- Add a clear working-directory layout for uploaded files, generated subtitle files, generated segments, and final video outputs.
- Keep the existing CLI commands intact.

## Capabilities

### New Capabilities
- `media-workflow-web-ui`: Browser-based upload, progress, job execution, and download flows for subtitle generation, segment generation, and final video output.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/cli.js`, `src/subtitle-generation.js`, `src/video-segment-generation.js`, plus new web server, routes, templates, static assets, and orchestration modules.
- Affected behavior: introduces a non-CLI entrypoint while preserving existing CLI behavior.
- Dependencies: likely minimal additions for HTTP serving, multipart uploads, templating, and segment archive download.
- Systems: local file storage, long-running media jobs, ffmpeg/ffprobe/Whisper execution, and progress reporting from backend processing into the UI.
