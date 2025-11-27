# LumenWords (桌面记单词 / 翻译 / 测验)

基于 Electron + React 的桌面词典与记忆工具，支持：
- 单词释义查询、句子翻译与低频词提取
- 批量导入单词自动抓取释义
- 单词本统计、复习清单、四选一测验（正确率/连对统计）
- 进度持久化（本地文件 + localStorage 双保险）

## 开发与运行
```bash
npm install
npm run electron      # 开发模式（3000 端口）
npm run build         # 构建前端
npm run build-mac     # 构建前端并打包 DMG（macOS，需允许 hdiutil）
```

## 打包产物
打包后 DMG 位于 `dist/`，示例：`LumenWords-0.3.0-arm64.dmg`。

## 配置
- Electron 主入口：`electron-main.js`
- 预加载（暴露持久化 API）：`preload.js`
- React 应用：`src/App.js` / `src/App.css`
- 构建配置：`electron-builder.yml`
