## MODIFIED Requirements

### Requirement: User can start subtitle generation from the web UI
The system SHALL provide a browser flow that accepts one audio or video media file and one script file, validates the inputs, and starts the existing subtitle-generation workflow without requiring CLI usage. This flow SHALL only be available to an authenticated user, and the uploaded files for each job SHALL be stored under that user's workspace path.

#### Scenario: Valid subtitle generation inputs start a job
- **WHEN** an authenticated user uploads one supported audio or video file and one valid script file, then starts subtitle generation
- **THEN** the system starts a subtitle-generation job
- **THEN** the system stores the uploaded files in a job workspace scoped to that authenticated user
- **THEN** the system returns a job identifier and initial processing state to the UI

#### Scenario: Invalid subtitle generation inputs are rejected
- **WHEN** an authenticated user submits subtitle generation without both required files, or the script file is invalid
- **THEN** the system rejects the request with a clear validation error
- **THEN** the system does not start a subtitle-generation job

### Requirement: User can download generated subtitle outputs
The system SHALL make generated subtitle outputs available for browser download after a subtitle-generation job completes successfully. Download access SHALL be limited to authenticated requests for jobs owned by the current user.

#### Scenario: Final subtitle file becomes downloadable after success
- **WHEN** an authenticated user requests the final subtitle output for that user's successful job
- **THEN** the system stores `script.whisper.srt` and `script.srt` in the user's job workspace
- **THEN** the system exposes a download action for the final `script.srt`

#### Scenario: User cannot download another user's subtitle output
- **WHEN** an authenticated user requests subtitle output for a job outside that user's workspace scope
- **THEN** the system rejects the request with a clear access error

### Requirement: User can start video generation after subtitle generation succeeds
The system SHALL provide a browser flow for uploading multiple source videos after subtitle generation has completed successfully for the current user's job, and SHALL run the existing segment-generation and final-concat workflows for that job.

#### Scenario: Valid video uploads start segment generation
- **WHEN** an authenticated user uploads one or more supported source video files for that user's job that already has a successful `script.srt`
- **THEN** the system starts video processing for that job
- **THEN** the system uses the generated `script.srt` for segment timing

#### Scenario: Video generation is blocked before subtitle success
- **WHEN** an authenticated user attempts to start video generation for a job that does not have a successful `script.srt`
- **THEN** the system rejects the request with a clear error
- **THEN** the system does not start segment generation

### Requirement: Video generation progress and outputs are available in the web UI
The system SHALL expose progress for segment generation and final video concatenation, and SHALL provide downloadable outputs for both the segment set and the final concatenated video. Status and download access SHALL be limited to the authenticated user who owns the job.

#### Scenario: Video generation reports segment and concat progress
- **WHEN** an authenticated user requests status for that user's running video-generation job
- **THEN** the system exposes progress states covering segment generation and final concat
- **THEN** each status response includes current stage, percent, and message

#### Scenario: Segment bundle and final video are downloadable after success
- **WHEN** an authenticated user requests outputs for that user's completed video-generation job
- **THEN** the system stores generated segment files and final video output in the user's job workspace
- **THEN** the system exposes a download action for all generated segments as a packaged artifact
- **THEN** the system exposes a download action for the final concatenated video
