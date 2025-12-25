FROM node:20-bullseye-slim

# Install dependencies: ffmpeg and yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3-pip \
  && pip3 install yt-dlp \
  && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package.json package-lock.json* ./

# Install node modules
RUN npm install --production || true

# Copy application code
COPY . .

# Ensure node modules installed (fallback if above failed)
RUN npm install --production || true

USER node

# Default environment variables (can be overridden at runtime)
ENV CHANNEL_NAME=""
ENV OUTPUT_DIR="/data"
ENV OLDEST_DATE=""
ENV PAGE_SIZE="50"
ENV AUDIO_ONLY="false"
ENV FFMPEG_PATH="/usr/bin/ffmpeg"
ENV YTDLP_PATH="/usr/local/bin/yt-dlp"
ENV POLL_INTERVAL=""

VOLUME ["/data"]

# Copy and use a small runner script that optionally polls on an interval.
COPY --chown=node:node run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh

ENTRYPOINT ["/usr/local/bin/run.sh"]
