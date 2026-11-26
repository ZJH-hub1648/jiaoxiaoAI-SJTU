#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  echo "Please install Node.js 22.13 or newer first."
  exit 1
fi
if [ ! -f node_modules/pdfjs-dist/build/pdf.mjs ]; then
  echo "Please run npm ci in the repository root first."
  exit 1
fi
exec node 'Paper reading assistance/server.mjs' "$@"
