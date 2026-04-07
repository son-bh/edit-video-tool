## Why

Users need a deterministic way to generate subtitle files from a JSON script and a matching audio file. The workflow should derive subtitle timing from the audio while preserving the JSON text exactly so downstream video editing can trust the subtitle content.

## What Changes

- Add a workflow that accepts one JSON file containing ordered subtitle text items and one audio file containing the corresponding spoken content.
- Validate that the JSON input is a list of items with non-empty `text` fields.
- Derive subtitle segment timing from the audio file instead of estimating duration from text length.
- Generate a subtitle file with one entry per JSON item.
- Reject inputs with clear errors when the JSON items and audio cannot be matched reliably.
- Start with support for up to 10 JSON items while keeping the design extensible to approximately 100 items.

## Capabilities

### New Capabilities
- `subtitle-generation`: Generate subtitles from ordered JSON text items and matching audio-derived timing while preserving the JSON text exactly.

### Modified Capabilities

## Impact

- Adds a new subtitle generation workflow and related validation behavior.
- May require audio analysis or forced-alignment integration during implementation.
- Adds tests for JSON validation, subtitle output integrity, timestamp ordering, and mismatch handling.
