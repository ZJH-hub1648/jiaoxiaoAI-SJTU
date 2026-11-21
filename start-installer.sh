#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js 22 或更高版本。请先从 https://nodejs.org/ 安装。"
  exit 1
fi
exec node installer/server.mjs
