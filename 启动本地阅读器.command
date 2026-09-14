#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "请先安装 Node.js 22.13 或更新版本，然后重新双击本文件。"
  read -r -p "按回车退出…"
  exit 1
fi
if [ ! -d node_modules ]; then
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci || { read -r -p "依赖安装失败，按回车退出…"; exit 1; }
fi
node scripts/local-start.mjs
if [ $? -ne 0 ]; then read -r -p "启动失败，请查看上方信息，按回车退出…"; fi
