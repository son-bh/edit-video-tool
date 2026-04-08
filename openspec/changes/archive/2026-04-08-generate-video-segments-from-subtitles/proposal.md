## Why

After `script.srt` is generated, the project needs a repeatable way to create video segments whose durations match each subtitle cue. This solves the manual work of cutting and extending short source videos to match subtitle timing.

## What Changes

- Add a workflow that parses `script.srt` and calculates duration for each cue from start and end timestamps.
- Add deterministic source video selection from an input folder in subtitle cue order.
- Add ffmpeg-based cutting for cues shorter than the source video duration.
- Add ffmpeg-based loop-and-concat behavior for cues longer than the source video duration, including durations above 20 seconds.
- Add output generation that produces one video segment per subtitle cue.
- Add validation and clear errors for invalid SRT, missing videos, unreadable videos, ffmpeg failures, and duration mismatches.
- Add logs or debuggable command visibility for ffmpeg operations.

## Capabilities

### New Capabilities
- `video-segment-generation`: Generate ordered video segments from SRT cue durations using ffmpeg cutting and concatenation.

### Modified Capabilities

None.

## Impact

- Affected code: CLI argument handling, subtitle/SRT parsing reuse, new video segment generation module, ffmpeg process execution, and Winston progress logging.
- Affected docs: usage documentation for running the segment generation workflow.
- Affected tests: deterministic tests for SRT parsing, duration branching, video selection, concat planning, and error cases.
- Dependencies: use the existing ffmpeg installation/configuration; no new dependency is expected unless needed for robust duration probing.
