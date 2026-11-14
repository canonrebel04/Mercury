#!/bin/bash
# Wrapper for the /opt/mercury tree installed by mercury-browser-bin.
# Copyright (c) 2024 The Chromium Authors, Mozilla, and Alex313031.

export MERCURY_WRAPPER="$(readlink -f "$0")"
MERCURY_BIN="${MERCURY_BIN:-/opt/mercury/mercury}"

# Optional flags file: one line of arguments, not glob-expanded.
MERCURY_USER_FLAGS=()
if [[ -f ${XDG_CONFIG_HOME:-$HOME/.config}/mercury/mercury-flags.conf ]]; then
  read -r -a MERCURY_USER_FLAGS < <(tr '\n' ' ' < "${XDG_CONFIG_HOME:-$HOME/.config}/mercury/mercury-flags.conf")
elif [[ -f $HOME/.mercury/mercury-flags.conf ]]; then
  read -r -a MERCURY_USER_FLAGS < <(tr '\n' ' ' < "$HOME/.mercury/mercury-flags.conf")
fi

if [[ ${1:-} == --temp-profile ]]; then
  shift
  TEMP_PROFILE="$(mktemp -d)"
  echo "Note: Using temporary profile: $TEMP_PROFILE"
  exec "$MERCURY_BIN" --profile "$TEMP_PROFILE" "${MERCURY_USER_FLAGS[@]}" "$@"
fi

exec "$MERCURY_BIN" "${MERCURY_USER_FLAGS[@]}" "$@"
