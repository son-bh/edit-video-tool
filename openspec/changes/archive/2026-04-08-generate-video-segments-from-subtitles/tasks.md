## 1. Parsing and Planning

- [x] 1.1 Add a video segment generation module with SRT cue parsing or shared reuse of existing SRT parsing helpers
- [x] 1.2 Implement cue duration calculation from SRT start and end timestamps
- [x] 1.3 Implement deterministic source video discovery from an input folder
- [x] 1.4 Implement cue-to-video mapping by index with clear errors for missing videos
- [x] 1.5 Implement segment plan creation for equal, shorter, longer, and multi-repeat duration cases

## 2. ffmpeg Execution

- [x] 2.1 Reuse or centralize ffmpeg path resolution with the existing default `C:\ffmpeg\bin\ffmpeg.exe`
- [x] 2.2 Implement ffmpeg cutting for cue durations shorter than the selected source video duration
- [x] 2.3 Implement ffmpeg copy or pass-through behavior for cue durations equal to the selected source video duration
- [x] 2.4 Implement ffmpeg concat behavior for cue durations longer than the selected source video duration
- [x] 2.5 Add temporary file handling for repeated/cut parts and concat list files
- [x] 2.6 Add Winston logs for operation type, input video, output video, requested duration, and ffmpeg failure context

## 3. Validation and Errors

- [x] 3.1 Validate missing or malformed SRT files with clear errors
- [x] 3.2 Validate missing, empty, or unreadable source video folders with clear errors
- [x] 3.3 Probe or verify source video and output segment durations
- [x] 3.4 Reject output duration mismatches beyond an acceptable tolerance
- [x] 3.5 Ensure generated output count equals the SRT cue count

## 4. CLI and Documentation

- [x] 4.1 Add CLI arguments for SRT input path, video input folder, and segment output folder
- [x] 4.2 Define and document behavior when there are more subtitle cues than videos
- [x] 4.3 Update docs with full command examples for video segment generation
- [x] 4.4 Keep existing subtitle generation commands working unchanged

## 5. Tests and Verification

- [x] 5.1 Add unit tests for SRT duration parsing
- [x] 5.2 Add unit tests for deterministic video selection and missing-video errors
- [x] 5.3 Add unit tests for segment planning with 10s, less-than-10s, greater-than-10s, and greater-than-20s durations
- [x] 5.4 Add tests or command stubs for ffmpeg cut/concat command construction
- [x] 5.5 Run the full automated test suite and document the command result
