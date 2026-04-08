## Context

The project already generates `script.srt` from JSON text and audio timing. The next workflow consumes that subtitle file and a folder of short source videos to produce one video segment per subtitle cue. Each output segment must match the cue duration, not the text length.

The implementation should fit the existing Node.js CommonJS CLI shape, reuse the configured ffmpeg path, and use Winston progress logging for debuggable processing. Source videos are expected to be short clips, typically up to 10 seconds, and selected in deterministic filename order.

## Goals / Non-Goals

**Goals:**

- Parse SRT cues and calculate cue durations from start/end timestamps.
- Select source videos by cue order.
- Generate one output video segment per cue using ffmpeg.
- Cut source videos for cue durations shorter than the source clip duration.
- Repeat and concatenate the same source video for cue durations longer than the source clip duration.
- Validate that generated output durations match cue durations within a small tolerance.
- Provide clear logs and errors for ffmpeg operations.

**Non-Goals:**

- Do not generate subtitle timings from text or audio in this workflow.
- Do not edit subtitle text.
- Do not perform semantic video selection based on subtitle content.
- Do not build a full nonlinear video editor or timeline UI.
- Do not require new large media fixtures in the repository.

## Decisions

1. Use a separate video segment module instead of mixing this logic into subtitle generation.

   Rationale: subtitle generation and video segment generation are different workflows. Keeping a dedicated module makes parsing, ffmpeg planning, and duration validation easier to test independently.

   Alternative considered: add the behavior directly to `src/subtitle-generation.js`. This would couple unrelated responsibilities and make the existing file harder to maintain.

2. Use deterministic filename ordering for source video selection.

   Rationale: the user wants cue order to map to video order. Sorting filenames provides stable behavior across runs.

   Alternative considered: use filesystem enumeration order directly. That can vary and would make output nondeterministic.

3. Fail when there are more subtitle cues than source videos unless an explicit loop option is implemented.

   Rationale: failing is safer than silently reusing the wrong clip order. If looping is desired, it should be exposed as an intentional option with logs.

   Alternative considered: loop videos automatically. That is convenient, but it may hide missing input videos and produce unexpected output.

4. Build an ffmpeg segment plan from duration units before executing.

   Rationale: cue duration branching becomes testable without requiring media processing in every test. For a 24-second cue and a 10-second source video, the plan is full clip + full clip + 4-second cut.

   Alternative considered: generate command strings inline while iterating cues. That is harder to verify and debug.

5. Validate output duration after ffmpeg generation.

   Rationale: encoding, stream copy, and keyframe behavior can create duration drift. A small tolerance should be allowed, but large differences must fail.

   Alternative considered: trust ffmpeg success alone. This misses cases where output exists but does not match the cue duration.

## Risks / Trade-offs

- ffmpeg cuts may be inaccurate when using stream copy → Prefer re-encode or validate duration and document the chosen ffmpeg strategy.
- Source videos may not be exactly 10 seconds → Probe actual video duration instead of hardcoding 10 seconds where possible.
- Long cue durations can create repeated visual loops → This is expected by the requested behavior; log the repeat count so it is visible.
- More SRT cues than videos may block generation → Fail clearly by default and consider an explicit `--loop-videos` option later if needed.
- Duration probing may require `ffprobe` → Reuse the installed ffmpeg folder to locate `ffprobe.exe` or provide a path override if implementation needs it.
