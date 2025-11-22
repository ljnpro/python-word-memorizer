# python-word-memorizer
# WordMemorizer（Python 版背单词软件）需求文档

## 1. 项目概述

- 运行方式：在本地通过 Python 启动一个 Web 应用，在浏览器中使用（例如访问 http://localhost:8000）
- 目标平台：macOS（但实现上尽量做到跨平台，Windows / Linux 也能跑）
- 主要技术栈（建议）：
  - Python 3.10+
  - Web 框架：FastAPI（如有更合适的轻量方案可由开发者选择，例如 Flask）
  - 前端：简单的 HTML + CSS + 少量 JavaScript（可使用模板引擎，如 Jinja2）
  - 数据库：SQLite（通过 ORM，例如 SQLAlchemy）
- 核心目标：
  - 通过间隔重复（Spaced Repetition）方法帮助用户记忆单词
  - 专注于“背单词”这个核心场景，界面简单、易用
  - 所有数据默认保存在本地 SQLite 数据库，支持导入/导出

---

## 2. 功能需求

### 2.1 单词数据管理

1. 导入单词
   - 支持从 CSV 文件导入：
     - 必要字段：`word`, `meaning`
     - 可选字段：`phonetic`, `example`, `tags`
   - 导入时，如数据库已有相同 `word`：
     - 提供一个策略（例如：跳过已有记录），并在 UI 上提示导入结果统计（导入成功多少条、跳过多少条）

2. 导出单词
   - 支持将当前数据库中的所有单词导出为 CSV 文件
   - 字段与导入格式一致，便于备份与迁移

3. 单词浏览 / 编辑
   - 提供一个“单词列表”页面，可以：
     - 按字母、创建时间、熟悉度排序
     - 搜索单词（按 `word` 或 `meaning` 进行模糊搜索）
   - 点击某个单词可以查看详情：
     - 显示全部字段：word / phonetic / meaning / example / tags / familiarityScore / nextReviewDate 等
     - 支持编辑 meaning / example / tags
     - 支持删除该单词

---

### 2.2 复习功能（核心）

1. 今日复习任务生成
   - 每天根据间隔重复算法生成“今日待复习单词”列表
   - 列表由两部分组成：
     - 需要复习的老单词（`nextReviewDate <= 今天`）
     - 新单词：当天第一次学习的单词（数量不超过每日上限，如 20 个）
   - 在数据库中为每日任务记录必要信息，便于统计

2. 复习界面（卡片式）
   - 页面一次展示一个单词卡片，包含：
     - 单词 `word`
     - 音标 `phonetic`（如有）
     - 释义 `meaning`（可以设置成默认隐藏，点击“显示释义”按钮后展开）
     - 例句 `example`（如有）
   - 用户操作：
     - 按钮：“认识”“不认识”
     - 可以额外提供键盘快捷键（例如通过 JavaScript 监听按键）：
       - J 或 Enter：认识
       - F：不认识
   - 显示当前进度（例如：第 3 / 25 个）

3. 复习结果影响（简化版间隔重复）
   - 每个单词维护以下状态字段：
     - `familiarityScore`（熟悉度，整数 0–5）
     - `createdAt`
     - `lastReviewDate`
     - `nextReviewDate`
   - 建议规则（可由实现方微调）：
     - 初始导入时：`familiarityScore = 0`，`nextReviewDate` = 今天
     - 用户点击“认识”：
       - `familiarityScore += 1`（最大不超过 5）
       - 根据新熟悉度设定下次复习间隔，例如：
         - 0 -> 1：1 天后
         - 1 -> 2：2 天后
         - 2 -> 3：4 天后
         - 3 -> 4：7 天后
         - 4 -> 5：14 天后
         - 5：30 天后
       - 更新 `lastReviewDate` 和 `nextReviewDate`
     - 用户点击“不认识”：
       - `familiarityScore -= 1`（最小不低于 0）
       - `nextReviewDate` 设置为明天（或当天稍后），具体策略可在代码中注释说明

4. 复习完成体验
   - 当今日待复习单词全部完成后：
     - 显示“今日复习已完成”的页面
     - 显示今日复习统计：复习总数、新学单词数、认识/不认识比例等

---

### 2.3 生词本

1. 生词定义
   - 将 `familiarityScore <= 某个阈值`（例如 2）的单词视为“生词”
2. 生词本页面
   - 展示所有生词列表：
     - 支持搜索（按 word / meaning）
     - 支持按熟悉度、最近复习时间排序
   - 支持勾选若干生词并“加入今日加练”，让这些单词在当天复习中额外出现

---

### 2.4 统计与数据可视化

1. 基础统计
   - 累计学习天数（至少有一次复习记录的天数）
   - 累计已掌握单词数（`familiarityScore >= 某个阈值`，例如 3 或 4）
   - 今日：
     - 今日应复习单词数
     - 今日已完成单词数
     - 今日新学单词数

2. 趋势图（基础版本）
   - 近 7 天 / 30 天每天复习单词数的折线图或柱状图
   - 简易实现即可（可以用前端 JS + 简单图表库，或自己画 SVG）

---

### 2.5 设置

1. 学习参数设置
   - 每日新词上限（默认 20）
   - 每日最大复习单词数（默认 100）
   - 熟悉度阈值（例如 >=3 视为掌握）
2. 数据相关
   - 导入按钮：选择 CSV 文件上传
   - 导出按钮：下载 CSV 文件
   - 清空所有数据按钮（需二次确认）

---

## 3. 非功能需求

1. 运行环境
   - Python 3.10+
   - 依赖通过 `requirements.txt` 或 `pyproject.toml` 管理
   - 能在 macOS 上通过命令行运行，例如：
     - `python -m app.main` 或
     - `uvicorn app.main:app --reload`
   - 项目根目录提供 `README.md`，说明安装与运行步骤

2. 性能
   - 在单词量 2–3 万时，常规操作（搜索、切换页面、进入复习）仍应保持较流畅
   - 重要接口（例如拉取今日复习列表）应在几百毫秒内完成

3. 可维护性
   - 建议采用类似下述项目结构（可根据需要微调）：
     - `app/`
       - `main.py`        // 程序入口，创建 FastAPI/Flask 应用
       - `models.py`      // ORM 模型定义
       - `schemas.py`     // Pydantic 模型 / 请求响应数据结构
       - `database.py`    // 数据库连接、Session 管理
       - `services/`      // 业务逻辑（导入导出、复习算法等）
       - `routers/`       // 路由拆分（words、review、stats 等）
       - `templates/`     // HTML 模板
       - `static/`        // CSS / JS / 图片等静态资源
     - `tests/`
   - 关键逻辑（间隔重复算法、导入导出、统计计算）需要有清晰的注释
   - 为核心算法编写基本单元测试（例如熟悉度和下一次复习日期的计算）

4. 隐私与安全
   - 默认不进行任何网络同步，所有数据存本地 SQLite 文件
   - 如后续增加云同步功能，需要单独配置与开关

---

## 4. 数据模型设计（初稿）

### 4.1 Word（单词实体）

- `id: int`（自增主键）
- `word: str`                        // 单词本身
- `phonetic: str | None`             // 音标（可选）
- `meaning: str`                     // 释义
- `example: str | None`              // 例句（可选）
- `tags: str`                        // 标签（可以用逗号分隔字符串存储，或单独建表）
- `familiarityScore: int`            // 熟悉度（0–5）
- `createdAt: datetime`
- `lastReviewDate: date | None`
- `nextReviewDate: date | None`

### 4.2 DailyStats（每日统计，可选）

- `id: int`
- `date: date`
- `reviewedCount: int`               // 当天复习单词数
- `newWordsCount: int`               // 当天新学单词数

（如实现复杂，可以在第一版中先不建 DailyStats 表，而是按需要从复习记录中计算。）

---

## 5. API 与前端大致结构（建议）

### 5.1 后端 API（示例）

- `GET /`：跳转或渲染首页（今日复习）
- `GET /review/today`：获取今天要复习的单词列表
- `POST /review/answer`：提交“认识/不认识”的结果，更新熟悉度与 nextReviewDate
- `GET /words`：获取单词列表（支持分页/搜索）
- `GET /words/{id}`：获取单个单词详情
- `POST /words`：创建新单词
- `PUT /words/{id}`：更新单词
- `DELETE /words/{id}`：删除单词
- `POST /import`：上传 CSV 并导入
- `GET /export`：导出 CSV
- `GET /stats/overview`：获取统计数据

（具体路径与命名可以略作调整，保持清晰一致即可。）

### 5.2 前端页面

- 顶部或侧边导航栏：
  - 今日复习
  - 生词本
  - 单词列表
  - 统计
  - 设置
- 每个菜单对应一个页面，通过路由或前端模板切换实现

---

## 6. 迭代建议

1. 第一阶段（MVP）
   - 完成数据模型（Word + SQLite）
   - 完成“今日复习”基本流程（拉取今日任务 + 卡片式复习 + 认识/不认识）
   - 完成基础单词列表页面 + 简单导入 CSV
2. 第二阶段
   - 增强生词本、统计与可视化
   - 完善导出功能和设置页
3. 第三阶段
   - 优化 UI 体验
   - 视情况加入登录、多用户、本地打包成独立应用等高级特性（例如使用 PyInstaller 打包）
