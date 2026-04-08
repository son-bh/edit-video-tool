# video-segment-generation Specification

## Purpose
Generate ordered video segments and final concatenated output from subtitle cue timing using ffmpeg-based cutting and concatenation.
## Requirements
### Requirement: SRT cue input parsing
The system SHALL accept an SRT subtitle file and parse each cue index, start timestamp, end timestamp, text, and duration.

#### Scenario: Valid SRT cue durations
- **WHEN** the user provides a valid `script.srt` file with subtitle cues
- **THEN** the system calculates each cue duration from the cue start and end timestamps

#### Scenario: Invalid SRT input
- **WHEN** the subtitle file is missing, unreadable, malformed, or contains a cue with an invalid timestamp range
- **THEN** the system rejects segment generation with a clear validation error

### Requirement: Ordered source video selection
The system SHALL read source videos from an input folder in deterministic order and map subtitle cue order to source video order.

#### Scenario: Video selected by cue index
- **WHEN** subtitle cue 1 is processed
- **THEN** the system selects the first source video in deterministic order

#### Scenario: Missing source video
- **WHEN** there are fewer source videos than subtitle cues and no explicit looping behavior is enabled
- **THEN** the system rejects segment generation with a clear error identifying the missing video index

#### Scenario: No source videos found
- **WHEN** the input video folder contains no supported video files
- **THEN** the system rejects segment generation with a clear error

### Requirement: Cue duration based video cutting
The system SHALL generate one output video segment per subtitle cue whose duration matches the cue duration.

#### Scenario: Cue duration equals source duration
- **WHEN** a cue duration equals the selected source video duration within tolerance
- **THEN** the system keeps or copies the selected video as the output segment for that cue

#### Scenario: Cue duration is shorter than source duration
- **WHEN** a cue duration is shorter than the selected source video duration
- **THEN** the system cuts the selected source video from `0` to the cue duration and writes it as the output segment for that cue

#### Scenario: Cue duration is longer than source duration
- **WHEN** a cue duration is longer than the selected source video duration
- **THEN** the system concatenates full-length repeats of the selected source video plus a final cut remainder from `0` to the remaining duration

#### Scenario: Cue duration requires multiple repeats
- **WHEN** a cue duration is more than twice the selected source video duration
- **THEN** the system repeats the selected source video as many times as needed and appends a final cut remainder if required

### Requirement: ffmpeg execution
The system SHALL use ffmpeg for video cutting, copying, and concatenation operations.

#### Scenario: ffmpeg command succeeds
- **WHEN** ffmpeg successfully creates an output segment
- **THEN** the system continues processing the next subtitle cue

#### Scenario: ffmpeg command fails
- **WHEN** ffmpeg fails to cut, copy, concatenate, or probe required video data
- **THEN** the system stops generation and reports the failed operation with a clear error

#### Scenario: ffmpeg operation is debuggable
- **WHEN** a video segment operation is executed
- **THEN** the system logs enough operation context to identify the input video, output video, requested duration, and operation type

### Requirement: Output segment validation
The system SHALL validate generated video segment outputs before reporting success.

#### Scenario: Output count matches cue count
- **WHEN** segment generation succeeds for an SRT file with N cues
- **THEN** the output folder contains exactly N generated video segments in cue order

#### Scenario: Output duration matches cue duration
- **WHEN** a video segment is generated for a subtitle cue
- **THEN** the generated video duration matches the cue duration within an acceptable tolerance

#### Scenario: Output duration mismatch
- **WHEN** a generated video segment duration differs from the cue duration beyond the allowed tolerance
- **THEN** the system rejects segment generation with a clear duration mismatch error
