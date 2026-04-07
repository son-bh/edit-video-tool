## 1. Project Setup

- [x] 1.1 Choose the initial implementation runtime and document the build, test, and development commands.
- [x] 1.2 Create the source and test structure for the subtitle generation workflow.
- [x] 1.3 Select and document any audio analysis or forced-alignment dependency required to derive subtitle timing from audio.

## 2. Input Validation

- [x] 2.1 Implement JSON parsing for an ordered array of subtitle items with `text` string fields.
- [x] 2.2 Reject malformed JSON, non-array JSON values, missing `text` fields, and empty `text` values with clear errors.
- [x] 2.3 Enforce the initial 10-item maximum with an error that explains the current limit.
- [x] 2.4 Validate that the audio file path exists and can be read before attempting alignment.

## 3. Audio Alignment

- [x] 3.1 Implement the alignment interface that accepts validated JSON items and an audio file.
- [x] 3.2 Derive start and end timestamps from the audio for each JSON item.
- [x] 3.3 Preserve JSON text exactly and use alignment results only for timing and match confidence.
- [x] 3.4 Reject unreliable matches, missing audio content, extra spoken content that prevents reliable matching, and item-level mismatches with clear errors.

## 4. Subtitle Output

- [x] 4.1 Generate exactly one subtitle cue per JSON item in JSON order.
- [x] 4.2 Validate that each cue has a start time earlier than its end time and that cue ordering is increasing.
- [x] 4.3 Reject invalid or unexpectedly overlapping timestamps with a clear timing error.
- [x] 4.4 Write the generated subtitles to a standard subtitle format such as SRT or WebVTT.

## 5. Verification

- [x] 5.1 Add tests for valid 2-3 item JSON input and successful subtitle generation.
- [x] 5.2 Add tests confirming subtitle cue count equals JSON item count.
- [x] 5.3 Add tests confirming each subtitle cue text exactly equals the corresponding JSON `text` value.
- [x] 5.4 Add tests for malformed JSON, empty text, over-limit input, missing audio, mismatch errors, and invalid timestamps.
- [x] 5.5 Update project documentation with usage examples and the current 10-item limit.
