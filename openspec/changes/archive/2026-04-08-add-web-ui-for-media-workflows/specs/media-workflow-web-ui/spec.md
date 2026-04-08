## ADDED Requirements

### Requirement: User can start subtitle generation from the web UI
The system SHALL provide a browser flow that accepts one audio or video media file and one `script.json` file, validates the inputs, and starts the existing subtitle-generation workflow without requiring CLI usage.

#### Scenario: Valid subtitle generation inputs start a job
- **WHEN** the user uploads one supported audio or video file and one valid `script.json` file, then starts subtitle generation
- **THEN** the system starts a subtitle-generation job
- **THEN** the system stores the uploaded files in a job workspace
- **THEN** the system returns a job identifier and initial processing state to the UI

#### Scenario: Invalid subtitle generation inputs are rejected
- **WHEN** the user submits subtitle generation without both required files, or the JSON file is invalid
- **THEN** the system rejects the request with a clear validation error
- **THEN** the system does not start a subtitle-generation job

### Requirement: Subtitle generation progress is visible in the web UI
The system SHALL expose browser-readable job status for subtitle generation, including current stage, percent progress, human-readable message, and terminal success or failure state.

#### Scenario: Subtitle generation reports progress through defined stages
- **WHEN** a subtitle-generation job is running
- **THEN** the system exposes progress states covering transcript creation and final subtitle mapping
- **THEN** each status response includes a percent value, stage identifier, and current message

#### Scenario: Subtitle generation failure is visible to the user
- **WHEN** subtitle generation fails because of upload, tool, transcript, or mapping errors
- **THEN** the system marks the job as failed
- **THEN** the UI can retrieve a clear failure message for display

### Requirement: User can download generated subtitle outputs
The system SHALL make generated subtitle outputs available for browser download after a subtitle-generation job completes successfully.

#### Scenario: Final subtitle file becomes downloadable after success
- **WHEN** a subtitle-generation job completes successfully
- **THEN** the system stores `script.whisper.srt` and `script.srt` in the job workspace
- **THEN** the system exposes a download action for the final `script.srt`

### Requirement: User can start video generation after subtitle generation succeeds
The system SHALL provide a browser flow for uploading multiple source videos after subtitle generation has completed successfully for the current job, and SHALL run the existing segment-generation and final-concat workflows for that job.

#### Scenario: Valid video uploads start segment generation
- **WHEN** the user uploads one or more supported source video files for a job that already has a successful `script.srt`
- **THEN** the system starts video processing for that job
- **THEN** the system uses the generated `script.srt` for segment timing

#### Scenario: Video generation is blocked before subtitle success
- **WHEN** the user attempts to start video generation for a job that does not have a successful `script.srt`
- **THEN** the system rejects the request with a clear error
- **THEN** the system does not start segment generation

### Requirement: Video generation progress and outputs are available in the web UI
The system SHALL expose progress for segment generation and final video concatenation, and SHALL provide downloadable outputs for both the segment set and the final concatenated video.

#### Scenario: Video generation reports segment and concat progress
- **WHEN** a video-generation job is running
- **THEN** the system exposes progress states covering segment generation and final concat
- **THEN** each status response includes current stage, percent, and message

#### Scenario: Segment bundle and final video are downloadable after success
- **WHEN** video generation completes successfully
- **THEN** the system stores generated segment files and final video output in the job workspace
- **THEN** the system exposes a download action for all generated segments as a packaged artifact
- **THEN** the system exposes a download action for the final concatenated video
