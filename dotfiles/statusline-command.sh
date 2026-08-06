#!/bin/bash

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // "Claude"')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
effort=$(echo "$input" | jq -r '.effort.level // empty')

# Colors (bold, with a dim separator so the fields stand out)
RESET='\033[0m'
CTX_GREEN='\033[1;32m'
CTX_YELLOW='\033[1;33m'
CTX_RED='\033[1;31m'
MODEL_COLOR='\033[1;36m'
EFFORT_COLOR='\033[1;35m'

# Middot separator (·) is vertically centered, unlike a period
SEP=" \033[1;37m·\033[0m "

parts=()

if [ -n "$used" ]; then
  pct=$(printf "%.0f" "$used")
  if [ "$pct" -ge 80 ]; then
    ctx_color="$CTX_RED"
  elif [ "$pct" -ge 50 ]; then
    ctx_color="$CTX_YELLOW"
  else
    ctx_color="$CTX_GREEN"
  fi
  parts+=("${ctx_color}${pct}%${RESET}")
fi

if [ -n "$model" ] && [ "$model" != "null" ]; then
  parts+=("${MODEL_COLOR}${model}${RESET}")
fi

if [ -n "$effort" ] && [ "$effort" != "null" ]; then
  parts+=("${EFFORT_COLOR}${effort}${RESET}")
fi

output=""
for i in "${!parts[@]}"; do
  if [ "$i" -gt 0 ]; then
    output="${output}${SEP}"
  fi
  output="${output}${parts[$i]}"
done

printf "%b\n" "$output"
