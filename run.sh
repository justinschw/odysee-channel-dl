#!/usr/bin/env bash
set -euo pipefail

# run.sh - wrapper entrypoint for the odysee downloader
# If POLL_INTERVAL is set (e.g. "24h", "30m", "3600s" or plain seconds), the script
# will run the download once immediately and then sleep for that interval in a loop.
# If POLL_INTERVAL is empty, it just runs once and exits.

LOG() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

parse_seconds() {
  local s="$1"
  if [[ -z "$s" ]]; then
    echo 0
    return
  fi
  if [[ "$s" =~ ^([0-9]+)$ ]]; then
    echo "$s"
    return
  fi
  if [[ "$s" =~ ^([0-9]+)s$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  if [[ "$s" =~ ^([0-9]+)m$ ]]; then
    echo $((${BASH_REMATCH[1]} * 60))
    return
  fi
  if [[ "$s" =~ ^([0-9]+)h$ ]]; then
    echo $((${BASH_REMATCH[1]} * 3600))
    return
  fi
  if [[ "$s" =~ ^([0-9]+)d$ ]]; then
    echo $((${BASH_REMATCH[1]} * 86400))
    return
  fi
  # fallback: try to parse as integer
  echo 0
}

# If any arguments are passed to the container, forward them to node script
NODE_CMD=(node downloadChannel.js "$@")

# Make sure node modules are available
if ! command -v node >/dev/null 2>&1; then
  LOG "node not found in PATH"
  exit 1
fi

INTERVAL_RAW="${POLL_INTERVAL:-}"
INTERVAL_SEC=$(parse_seconds "$INTERVAL_RAW")

if [[ "$INTERVAL_SEC" -le 0 ]]; then
  LOG "POLL_INTERVAL not set or zero; running once and exiting"
  exec "${NODE_CMD[@]}"
fi

LOG "Starting periodic run loop; interval=${INTERVAL_SEC}s"

while true; do
  LOG "Starting run"
  # Run the downloader; capture exit code but continue loop
  "${NODE_CMD[@]}" || LOG "downloadChannel.js exited with status $?"
  LOG "Run complete, sleeping for ${INTERVAL_SEC}s"
  sleep "$INTERVAL_SEC"
done
