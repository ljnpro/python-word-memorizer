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
npm run build-win     # 构建前端并打包 Windows 安装包
```

## 打包与发布
- 打包后的 macOS DMG 位于 `dist/`，示例：`LumenWords-0.3.0-arm64.dmg`。
- Windows 构建会生成 NSIS 安装包和便携版 EXE（`dist/LumenWords-*.exe`）。
- GitHub Actions workflow `Build Windows Release` 会在推送 `v*` 标签或手动触发时自动构建 Windows 产物，并在有标签时附加到对应的 Release。建议在仓库中配置 `WINDOWS_RELEASE_PAT` 机密（带有 `repo` 权限的 PAT），用于在 Actions 中签出和发布 Release。

## 配置
- Electron 主入口：`electron-main.js`
- 预加载（暴露持久化 API）：`preload.js`
- React 应用：`src/App.js` / `src/App.css`
- 构建配置：`electron-builder.yml`
