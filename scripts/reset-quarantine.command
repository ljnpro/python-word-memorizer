#!/bin/bash
# 双击运行，自动移除应用隔离标记，解决“已损坏/无法打开”提示。

APP_PATH="/Applications/LumenWords.app"

echo "正在移除隔离属性: $APP_PATH"
if xattr -cr "$APP_PATH"; then
  echo "完成。若仍有提示，可重启后再次尝试。"
else
  echo "操作失败，请检查路径或权限。"
fi
echo "按回车退出..."
read -r _
