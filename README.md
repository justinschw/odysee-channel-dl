# Odysee Channel Downloader

Small Node.js utility to fetch and download videos from an Odysee channel in batches.

Features
- Page through a channel's videos and download each item.
- Optional audio extraction to MP3.
- Uses `yt-dlp` (via `yt-dlp-wrap`) for downloads and conversions.

Requirements
- Node.js (v18+ recommended)
- `yt-dlp` and `ffmpeg` available if you rely on yt-dlp post-processing (the Dockerfile installs them)

Installation

1. Install dependencies:

```bash
npm install
```

2. (Optional) Install `yt-dlp` and `ffmpeg` system-wide or provide paths via env/flags.

Usage

You can run the script with CLI flags or environment variables.

Required parameters
- `CHANNEL_NAME` / `--channel-name` — channel identifier (e.g. `@MidnightBroadcast`)
- `OUTPUT_DIR` / `--output-dir` — directory to save files

Optional parameters
- `OLDEST_DATE` / `--oldest-date` — stop once videos older than this date are reached. Format: `MM/DD/YYYY` (e.g. `12/01/2022`).
- `PAGE_SIZE` / `--page-size` — number of results per page (default: 50)
- `AUDIO_ONLY` / `--audio-only` — set to `true` to extract audio as m4a instead of downloading MP4 (uses yt-dlp/ffmpeg)
- `YTDLP_PATH` / `--ytdlp-path` — path or directory to the `yt-dlp` executable to use

Examples

CLI example (PowerShell):

```powershell
node downloadChannel.js --channel-name "@MidnightBroadcast" --output-dir "C:\Video\mnb" --oldest-date "12/01/2022" --mp3 --ytdlp-path "C:\path\to\yt-dlp.exe"
```

Env example (PowerShell):

```powershell
$env:CHANNEL_NAME='@MidnightBroadcast'
$env:OUTPUT_DIR='C:\Video\mnb'
$env:OLDEST_DATE='12/01/2022'
$env:MP3='true'
$env:YTDLP_PATH='C:\path\to\yt-dlp.exe'
node downloadChannel.js
```

Docker

Build the image:

```bash
docker build -t odysee-downloader .
```

Run (mount host folder to `/data` inside container):

```bash
docker run --rm -it -v C:\Video\mnb:/data -e CHANNEL_NAME='@MidnightBroadcast' -e OUTPUT_DIR=/data -e OLDEST_DATE='12/01/2022' -e MP3='true' odysee-downloader
```
