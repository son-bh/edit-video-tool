## 1. Web Server Setup

- [x] 1.1 Add the minimal web dependencies and npm script needed to run a template-based Node server
- [x] 1.2 Create the web server entrypoint, view engine setup, static asset handling, and base route
- [x] 1.3 Define a job workspace root and directory layout for uploaded inputs and generated outputs

## 2. Job Orchestration and Progress

- [x] 2.1 Add an in-memory job store that tracks job id, stage, percent, message, outputs, and failure state
- [x] 2.2 Add orchestration helpers that run subtitle generation outside the request/response path and update job progress
- [x] 2.3 Add orchestration helpers that run segment generation, final concat, and segment packaging while updating job progress
- [x] 2.4 Add progress hooks or adapter logging so existing generation modules can report stage-aware progress to the UI layer

## 3. Subtitle UI Flow

- [x] 3.1 Add upload routes and validation for one audio or video file and one `script.json` file
- [x] 3.2 Add the subtitle-generation start route that stores uploads in the job workspace and launches the subtitle job
- [x] 3.3 Add a status endpoint that returns subtitle job progress, completion state, and error details
- [x] 3.4 Add a subtitle download endpoint for the generated `script.srt`
- [x] 3.4.1 Add a subtitle download endpoint for the generated `script.whisper.srt`
- [x] 3.5 Build the template and browser script for subtitle upload, start action, progress display, success state, and error state
- [x] 3.6 Add 1 input to upload script.whisper.srt if the user have script file. It will skip create script from audio and run subtitle-generation with script.json and script.whisper.srt

## 4. Video UI Flow

- [x] 4.1 Add upload routes and validation for multiple source video files tied to an existing successful subtitle job
- [x] 4.2 Add the video-generation start route that runs segment generation and final concat for the job
- [x] 4.3 Add a status endpoint that returns video-generation progress, completion state, and error details
- [x] 4.4 Add download endpoints for the packaged segment output and final concatenated video
- [x] 4.5 Build the template and browser script for video upload, start action, progress display, and completed download actions

## 5. Integration, Packaging, and Documentation

- [x] 5.1 Ensure the existing CLI entrypoints remain unchanged and usable after adding the web server
- [x] 5.2 Package generated segment files into a browser-downloadable archive artifact
- [x] 5.3 Update README and workflow docs with web UI startup, configuration, working-directory behavior, and download flow

## 6. Verification

- [x] 6.1 Add automated tests for route validation, job orchestration, and progress/status responses
- [x] 6.2 Add automated tests for download routes and failure cases around invalid uploads or missing prerequisite outputs
- [x] 6.3 Manually verify the end-to-end browser flow for subtitle generation, segment generation, segment download, and final video download
