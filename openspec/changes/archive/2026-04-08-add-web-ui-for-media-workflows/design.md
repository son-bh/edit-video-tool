## Context

The repository currently exposes three working media flows through `src/cli.js`: subtitle generation from JSON plus audio, video segment generation from `script.srt`, and final segment concatenation. The core processing logic already lives in `src/subtitle-generation.js` and `src/video-segment-generation.js`, with Winston-based progress logs but no HTTP interface, upload handling, or browser-facing progress model.

The requested change adds a web UI without replacing the CLI. The implementation needs to reuse the existing processing modules, support long-running local media jobs, and provide clear downloads for generated outputs. The project is a lightweight CommonJS Node application, so the design should stay close to that shape instead of introducing a larger frontend framework.

## Goals / Non-Goals

**Goals:**
- Add a template-based web UI that runs the existing subtitle and video workflows.
- Support browser uploads for audio, `script.json`, and multiple video files.
- Provide progress updates for the current job so the user can follow long-running processing.
- Expose download endpoints for `script.srt`, a packaged segment output, and the final video.
- Keep the existing CLI behavior intact.

**Non-Goals:**
- Multi-user isolation, authentication, or remote deployment concerns.
- Rewriting the subtitle or video generation algorithms.
- Real-time push infrastructure such as WebSockets if polling is sufficient.
- Persistent job storage across process restarts.

## Decisions

### 1. Add a small Express server with server-rendered templates
Use a lightweight Node HTTP stack with server-rendered templates and static assets. Express plus a simple view engine keeps routing, form handling, and downloads straightforward.

Why this choice:
- Fits the repo's current Node/CommonJS setup.
- Keeps UI integration simple for uploads and download routes.
- Avoids a separate frontend build pipeline.

Alternatives considered:
- Native `http` server: lighter, but slower to build and harder to maintain for multipart uploads and templating.
- SPA framework: too much complexity for a local workflow tool.

### 2. Reuse existing processing modules through a web orchestration layer
Add a thin orchestration layer that prepares working directories, calls the current generation functions, and translates progress/log events into UI job state.

Why this choice:
- Preserves existing business logic and test surface.
- Avoids divergence between CLI and UI behavior.
- Makes it practical to keep one processing implementation and two entrypoints.

Alternatives considered:
- Reimplement flow separately for HTTP requests: higher regression risk and duplicated logic.

### 3. Represent progress as staged job state plus percent completion
Introduce a job model with stages such as `uploading`, `creating-transcript`, `mapping-subtitles`, `generating-segments`, `concatenating-final-video`, `packaging-downloads`, `completed`, and `failed`. The server will track current stage, percent, message, and output paths.

Why this choice:
- The current backend emits logs but not precise numeric progress for all steps.
- Stage-based progress is accurate enough for long-running local jobs.
- It can be implemented by injecting progress hooks into orchestration and existing modules where needed.

Alternatives considered:
- Parsing raw ffmpeg or Whisper console output into exact percentages: brittle and backend-specific.
- No percent, only text logs: weaker UX than requested.

### 4. Use polling endpoints for job status
The browser will start a job, receive a `jobId`, and poll a JSON status endpoint for progress and completion state.

Why this choice:
- Simpler than WebSockets or Server-Sent Events.
- Reliable for local long-running tasks.
- Easy to integrate with plain JavaScript in a template-based UI.

Alternatives considered:
- WebSockets: more moving parts than needed for a single-user local tool.
- Full page reloads: poor feedback for long operations.

### 5. Use a workspace job directory per run
Each job will get a dedicated working folder under a controlled application workspace, separating uploaded inputs from generated outputs.

Why this choice:
- Prevents file collisions across runs.
- Makes cleanup and download routing simpler.
- Gives a stable place for audio, JSON, videos, `script.whisper.srt`, `script.srt`, segments, zip output, and final video.

Alternatives considered:
- Writing directly into `assets/`: convenient for manual tests, but poor isolation for UI runs.

### 6. Package segment downloads as a zip artifact
After segment generation completes, create a single downloadable archive for all segment files, alongside the final video download.

Why this choice:
- Browsers handle one archive download more cleanly than dozens of segment files.
- Matches the user request for downloading all segments.

Alternatives considered:
- Expose the segment folder directly: awkward in browsers and inconsistent across environments.

## Risks / Trade-offs

- [In-memory job store is lost on restart] → Mitigation: keep scope to local single-process use and make this explicit in docs.
- [Stage-based percent may be approximate rather than exact media progress] → Mitigation: define deterministic stage percentages and expose the current message and stage in the UI.
- [Large video uploads can stress local disk usage] → Mitigation: isolate files per job and document cleanup expectations.
- [Long-running synchronous processing can block the server if called directly in the request handler] → Mitigation: dispatch work after request acceptance and track completion through job state instead of keeping the request open.
- [New web dependencies increase surface area] → Mitigation: keep dependency count minimal and choose stable packages only for HTTP, multipart handling, templates, and archiving.

## Migration Plan

1. Add the web server entrypoint, template views, static assets, upload handling, and job workspace layout.
2. Add orchestration wrappers and progress hooks around existing subtitle and video generation flows.
3. Add status and download routes for generated outputs.
4. Add tests for route validation and orchestration behavior.
5. Update README and workflow docs with UI startup and usage.

Rollback is simple: remove the web server entrypoint and related modules without affecting the existing CLI commands.

## Open Questions

- Should the UI support only one active job at a time in the first version, or allow multiple queued jobs in memory?
- Should completed job directories be retained until manual cleanup, or should the server expose a cleanup action?
- Which zip implementation is preferred for segment packaging: a Node archive library or an OS/tool-based archive step?
