# subtitle-generation Specification

## Purpose
Generate subtitle files from ordered JSON text items and matching audio-derived timing while preserving JSON text exactly.

## Requirements
### Requirement: JSON subtitle input validation
The system SHALL accept a JSON file containing an ordered array of subtitle items where each item has a non-empty `text` string field.

#### Scenario: Valid JSON subtitle list
- **WHEN** the user provides a JSON file containing 2 to 100 items with non-empty `text` values
- **THEN** the system accepts the JSON input for subtitle generation

#### Scenario: Invalid JSON subtitle list
- **WHEN** the user provides malformed JSON, a non-array JSON value, an item without `text`, or an item with an empty `text` value
- **THEN** the system rejects the input with a clear validation error

### Requirement: Item limit
The system SHALL enforce a maximum of 100 JSON subtitle items.

#### Scenario: JSON list exceeds item limit
- **WHEN** the user provides a JSON file with more than 100 subtitle items
- **THEN** the system rejects the input with an error explaining the current 100-item limit

### Requirement: Audio-derived subtitle timing
The system SHALL derive subtitle start and end timestamps from the provided audio file.

#### Scenario: Transcript text matches JSON item
- **WHEN** audio transcription produces subtitle text that matches a JSON item after punctuation-insensitive comparison
- **THEN** the system uses the matched transcript timing for the generated subtitle cue and preserves the exact JSON item text

#### Scenario: Transcript text does not match JSON item
- **WHEN** audio transcription produces subtitle text that cannot be matched to the corresponding JSON item
- **THEN** the system rejects subtitle generation with a clear mismatch error

#### Scenario: Audio can be aligned to JSON items
- **WHEN** the user provides an audio file whose spoken content can be reliably aligned to every JSON subtitle item
- **THEN** the system generates start and end timestamps for each subtitle item from the audio

#### Scenario: Non-WAV media can be decoded
- **WHEN** the user provides MP3, MP4, or another media file that ffmpeg can decode to PCM WAV
- **THEN** the system analyzes the decoded audio to generate start and end timestamps

#### Scenario: Extra speech chunks can be grouped
- **WHEN** audio analysis detects more speech chunks than JSON items and enough reliable pauses are available
- **THEN** the system uses JSON item text length and reliable pauses to generate exactly one subtitle cue per JSON item

#### Scenario: Audio cannot be aligned reliably
- **WHEN** the provided audio is missing, unreadable, or cannot be reliably matched to every JSON subtitle item
- **THEN** the system rejects subtitle generation with a clear mismatch or audio analysis error

### Requirement: Exact subtitle text preservation
The system SHALL generate subtitle entries whose text exactly matches the corresponding JSON item `text` value.

#### Scenario: Subtitle text matches JSON exactly
- **WHEN** subtitle generation succeeds
- **THEN** each subtitle entry text is byte-for-byte equal to the corresponding JSON item `text` value

#### Scenario: Audio transcript differs from JSON text
- **WHEN** audio analysis returns wording, casing, punctuation, splitting, or merging that differs from the JSON item text
- **THEN** the system preserves the JSON text in output or rejects the generation if reliable alignment cannot be established

### Requirement: Subtitle cue ordering and count
The system SHALL generate exactly one subtitle cue per JSON subtitle item in the same order as the JSON list.

#### Scenario: Successful subtitle output
- **WHEN** subtitle generation succeeds for a JSON list with N items
- **THEN** the output contains exactly N subtitle cues in JSON item order

### Requirement: Timestamp validity
The system SHALL generate valid, increasing subtitle timestamps with no unexpected overlap between adjacent cues.

#### Scenario: Generated timestamps are valid
- **WHEN** subtitle generation succeeds
- **THEN** each cue has a start timestamp earlier than its end timestamp and each cue starts at or after the previous cue starts

#### Scenario: Generated timestamps overlap unexpectedly
- **WHEN** audio-derived timing would produce invalid or unexpected overlapping cue timestamps
- **THEN** the system rejects subtitle generation with a clear timing error

### Requirement: Subtitle file output
The system SHALL output subtitles in a standard subtitle file format.

#### Scenario: Subtitle file is generated
- **WHEN** subtitle generation succeeds
- **THEN** the system writes a subtitle file containing the generated cues in a standard format such as SRT or WebVTT
