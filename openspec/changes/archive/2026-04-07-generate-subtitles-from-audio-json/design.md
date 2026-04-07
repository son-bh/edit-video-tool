## Context

The workspace currently has no implementation stack, source tree, or build system. This change defines the workflow contract for generating subtitles from a JSON script and a matching audio file before selecting concrete libraries or runtime details during implementation.

The core constraint is that subtitle text is authoritative from JSON. Audio analysis is used only to derive timing and alignment confidence; it must not rewrite, normalize, split, merge, or paraphrase subtitle text.

## Goals / Non-Goals

**Goals:**
- Accept one JSON file containing an ordered array of `{ "text": string }` items and one audio file containing corresponding spoken content.
- Validate inputs before alignment, starting with a maximum of 10 JSON items.
- Derive subtitle start and end times from audio analysis or forced alignment.
- Emit a subtitle file with one entry per JSON item and exact text preservation.
- Report clear errors when matching is not reliable.
- Keep the workflow extensible for approximately 100 JSON items without changing the subtitle contract.

**Non-Goals:**
- Build a full video editor or timeline UI.
- Translate, paraphrase, normalize, or correct JSON subtitle text.
- Guess timing from text length when audio alignment fails.
- Support arbitrary speaker diarization, overlapping dialogue, or multi-language alignment in the first version.

## Decisions

1. Treat JSON as the source of truth for subtitle text.
   - Rationale: The mandatory condition requires subtitles to match JSON items exactly.
   - Alternative considered: Use transcription output as subtitle text. Rejected because it can introduce spelling, casing, punctuation, or wording differences.

2. Use audio analysis for timing and matching confidence only.
   - Rationale: Timing must be derived from the audio, but text content must remain unchanged.
   - Alternative considered: Estimate durations from text length. Rejected because it violates the requirement and will be unreliable for real speech pacing.

3. Require one subtitle cue per JSON item.
   - Rationale: This makes verification deterministic and preserves item-level ordering from the input list.
   - Alternative considered: Allow the aligner to split or merge cues. Rejected for the first version because it weakens the exact item-to-subtitle contract.

4. Fail closed on unreliable alignment.
   - Rationale: Incorrect subtitles are worse than an actionable mismatch error for downstream video workflows.
   - Alternative considered: Produce best-effort subtitles with warnings. Rejected for the first version because it can silently create unusable output.

5. Start with a 10-item input limit and avoid implementation choices that prevent scaling to 100 items.
   - Rationale: A small first scope simplifies validation and testing while preserving a clear growth path.
   - Alternative considered: Build for 100 items immediately. Deferred until the initial alignment and error model are proven.

## Risks / Trade-offs

- [Risk] Forced alignment quality depends on the selected audio analysis backend and audio quality. -> Mitigation: expose clear mismatch errors and avoid emitting subtitles when confidence is insufficient.
- [Risk] Exact JSON text may differ from spoken audio because of punctuation, casing, or wording. -> Mitigation: keep JSON exact in output and treat alignment mismatch as an error rather than rewriting JSON.
- [Risk] A 10-item limit may not satisfy larger real inputs initially. -> Mitigation: keep parsing, validation, and alignment interfaces list-based so the limit can be raised after performance testing.
- [Risk] The repo has no current runtime or dependency policy. -> Mitigation: defer concrete package selection to implementation and document any new dependency with tests and setup commands.
