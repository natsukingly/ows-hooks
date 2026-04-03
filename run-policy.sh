#!/usr/bin/env bash
# OWS executable policy wrapper
# OWS passes PolicyContext via stdin and receives PolicyResult via stdout
DIR="$(cd "$(dirname "$0")" && pwd)"
export ERC8004_MOCK=true
exec node "$DIR/dist/main.js"
