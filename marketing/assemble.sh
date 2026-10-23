#!/usr/bin/env bash
# Cuts the recorded clips (marketing/record.mjs) to the voiceover and burns in captions.
# Inputs in marketing/out/: 01-hook … 06-endcard-bg .mp4 and voiceover.mp3 (ElevenLabs).
# Output: marketing/out/apollonius-30s-9x16.mp4 (1080×1920, 30 fps, H.264 + AAC).
set -euo pipefail
cd "$(dirname "$0")"
OUT=out
VO_DELAY_MS=300
TOTAL=25.5

# Edit decision list: input index, source start, source end, speed.
# Timeline: 0–4.17 hook · 4.17–9.6 solve · 9.6–14.8 snap + other apex · 14.8–17.8 hints ·
#           17.8–20.0 earned tool · 20.0–25.5 end card.
SEGMENTS=(
  "0 0.00 4.17 1"
  "1 0.57 3.30 1"
  "1 3.30 5.60 2.5"
  "1 5.60 7.40 1"
  "2 1.20 3.60 1"
  "2 6.80 8.00 1"
  "2 10.80 12.40 1"
  "3 0.80 5.30 1.5"
  "4 0.40 1.40 1"
  "4 3.30 4.50 1"
  "5 1.00 5.63 1"
)

filter=""
labels=""
for i in "${!SEGMENTS[@]}"; do
  read -r input start end speed <<<"${SEGMENTS[$i]}"
  filter+="[${input}:v]trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${speed},fps=30,format=yuv420p[s${i}];"
  labels+="[s${i}]"
done
filter+="${labels}concat=n=${#SEGMENTS[@]}:v=1:a=0,tpad=stop_mode=clone:stop_duration=2,"
filter+="trim=duration=${TOTAL},ass=captions.ass,fade=t=out:st=$(echo "$TOTAL - 0.6" | bc):d=0.6[v];"
filter+="[6:a]adelay=${VO_DELAY_MS}|${VO_DELAY_MS},apad,atrim=duration=${TOTAL},"
filter+="loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=$(echo "$TOTAL - 0.8" | bc):d=0.8[a]"

ffmpeg -hide_banner -loglevel error -y \
  -i "$OUT/01-hook.mp4" -i "$OUT/02-solve.mp4" -i "$OUT/03-snap.mp4" \
  -i "$OUT/04-hints.mp4" -i "$OUT/05-tool.mp4" -i "$OUT/06-endcard-bg.mp4" \
  -i "$OUT/voiceover.mp3" \
  -filter_complex "$filter" -map "[v]" -map "[a]" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart \
  "$OUT/apollonius-30s-9x16.mp4"

echo "wrote $OUT/apollonius-30s-9x16.mp4"
