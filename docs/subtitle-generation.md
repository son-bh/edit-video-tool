# Subtitle Generation

Generate a final SRT file from a JSON script and an audio/video file.

The JSON file is the source of truth for subtitle text. Whisper is used to create timing from the audio, then the tool maps Whisper subtitle segments back to the JSON items. The final subtitle text is copied exactly from JSON.

## Current Scope

- Runtime: Node.js 20 or newer.
- JSON input: an array of objects with non-empty `text` string fields.
- Current limit: 100 JSON items.
- Audio input: any audio/video format that `ffmpeg` can decode, such as MP3, MP4, M4A, MOV, AAC, and WAV.
- Raw transcript output: Whisper-generated SRT.
- Final output: JSON-mapped SRT.
- Default `ffmpeg`: `C:\ffmpeg\bin\ffmpeg.exe`.
- Default Python Whisper: `C:\Users\sonbh\AppData\Local\Python\pythoncore-3.14-64\Scripts\whisper.exe`.

Override tool paths with `--ffmpeg`, `FFMPEG_PATH`, `--whisper-command`, or `WHISPER_COMMAND_PATH`.

## Flow

The normal command runs two steps:

1. Create a raw Whisper subtitle file from the audio.
2. Read the raw Whisper subtitle file, accumulate Whisper segments until their normalized text matches the current JSON item, then copy the accumulated start/end time onto the exact JSON text.

If the current accumulated Whisper text does not match the current JSON item, the mapper continues accumulating Whisper segments. If it still cannot match, generation fails with a mismatch error instead of guessing.

## Commands

Run tests:

```bash
node --test
```

Run the full flow in one command:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en
```

This creates:

- `assets/script/script.whisper.srt`: raw Whisper subtitle file
- `assets/script/script.srt`: final JSON-mapped subtitle file

Create only the raw Whisper subtitle file:

```bash
npm run generate-subtitles -- --audio assets/audio/audio.MP3 --transcribe-only --transcript-out assets/script/script.whisper.srt --language en
```

Map an existing Whisper subtitle file without transcribing again:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-in assets/script/script.whisper.srt --language en
```

Use a faster Python Whisper model on CPU:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en --whisper-model tiny.en
```

Use a custom `ffmpeg` path:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en --ffmpeg C:\path\to\ffmpeg.exe
```

Use a custom Python Whisper command:

```bash
npm run generate-subtitles -- --json assets/script/script.json --audio assets/audio/audio.MP3 --out assets/script/script.srt --transcript-out assets/script/script.whisper.srt --language en --whisper-command C:\path\to\whisper.exe
```

## Video Segment Generation

After `script.srt` exists, generate one video segment per subtitle cue:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments
```

The command:

1. Parses each SRT cue start/end timestamp.
2. Calculates cue duration from `end - start`.
3. Reads source videos from the video folder in deterministic filename order.
4. Maps cue 1 to video 1, cue 2 to video 2, and so on.
5. Uses `ffmpeg` to create `segment-001.mp4`, `segment-002.mp4`, etc.

Duration behavior:

- If cue duration equals the selected source video duration within tolerance, the video is copied with `ffmpeg`.
- If cue duration is shorter than the source video duration, the source video is cut from `0` to the cue duration.
- If cue duration is longer than the source video duration, the source video is repeated and concatenated. For example, a 24-second cue with a 10-second source video becomes `10 + 10 + 4`.

By default, generation fails if there are more SRT cues than source videos:

```text
Missing source video for subtitle cue N
```

To intentionally reuse videos from the beginning, pass `--loop-videos`:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments --loop-videos
```

Use a custom tolerance for output duration validation:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments --duration-tolerance 0.5
```

Use a custom `ffprobe` path:

```bash
npm run generate-video-segments -- --srt assets/script/script.srt --videos assets/videos --segments-out assets/segments --ffprobe C:\path\to\ffprobe.exe
```

## Final Video Concat

After all segment videos are generated, concatenate them into one final video:

```bash
npm run generate-video-segments -- --concat-segments assets/segments --final-out assets/final/final.mp4
```

This command:

1. Reads all segment videos from the segment folder in deterministic filename order.
2. Builds an ffmpeg concat list.
3. Concatenates the segment files into one final output video.
4. Probes the output duration to confirm the final file was created successfully.

Use a custom `ffmpeg` or `ffprobe` path if needed:

```bash
npm run generate-video-segments -- --concat-segments assets/segments --final-out assets/final/final.mp4 --ffmpeg C:\ffmpeg\bin\ffmpeg.exe --ffprobe C:\ffmpeg\bin\ffprobe.exe
```

## JSON Format

```json
[
  { "text": "Something" },
  { "text": "Something 2" }
]
```

## Error Behavior

The tool rejects generation when:

- the JSON file is malformed or not an array
- an item is missing a non-empty `text` string
- the JSON list contains more than 100 items
- the audio file is missing or unreadable
- `ffmpeg` cannot decode the audio/video file
- Python Whisper cannot create the raw subtitle file
- accumulated Whisper subtitle text cannot be matched to the current JSON item
- generated timestamps are invalid or unexpectedly overlap

Successful output contains exactly one SRT cue per JSON item, in JSON order, with cue text exactly equal to the corresponding JSON `text` value.
