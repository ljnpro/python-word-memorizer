#!/bin/bash
# 解除 macOS “应用已损坏”提示的辅助脚本
# 用法：双击或在终端执行本脚本，将应用名替换为实际安装路径（默认 /Applications/LumenWords.app）

APP_PATH="/Applications/LumenWords.app"

echo "正在移除隔离属性: $APP_PATH"
xattr -cr "$APP_PATH" && echo "完成。若仍有提示，可重启后再次尝试。" || echo "操作失败，请检查路径或权限。"
