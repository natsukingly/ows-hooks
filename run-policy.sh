#!/usr/bin/env bash
# OWS executable policy ラッパー
# OWS が stdin で PolicyContext を渡し、stdout で PolicyResult を受け取る
DIR="$(cd "$(dirname "$0")" && pwd)"
export ERC8004_MOCK=true
exec node "$DIR/dist/main.js"
