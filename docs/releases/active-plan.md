# 当前开发计划

## 状态
- 版本号：v1.3.0
- 计划状态：规划中
- 预计版本类型：minor

## 目标
- [ ] feat: 所有费用类别增加纸质发票填报入口，可手动添加发票金额和张数，不用考虑纸质发票的上传和保存。
- [ ] feat: 需要适配短时外出不足以领取1天的途中补贴的情形。我不希望通过时间来判断，是否允许用户直接修改出差总天数和总补贴金额？
- [ ] feat: 上传重复发票预警
- [ ] 发票信息确认窗口打开原始文件按钮，可调用本地默认PDF浏览器。（适用本地版，服务器版仍保留浏览器打开）

## 范围
本次做：
- 纸质发票的手工金额与张数填报。
- 允许直接调整短时外出的出差总天数和总补贴金额。
- 上传重复发票预警。
- 本地版发票信息确认窗口使用系统默认 PDF 浏览器打开原始文件，服务器版保留浏览器打开方式。

本次不做：
- 未明确版本号和发布前验证前，不主动同步或部署 Linux 服务器；后续修改先在本地完成测试。

## 版本号判断
- 如果只是修复问题：patch
- 如果增加用户可见功能：minor
- 如果数据结构或使用方式有不兼容变化：major

---

## 完成记录

### 重要改动
- fix(ui): 全站内容区由 1440 / 1680 / 1920 的阶梯式最大宽度改为连续插值，保留 1920px 上限与居中 gutter。窗口化与全屏状态不再因跨过 2560px CSS 视口断点而使行程卡片突然缩窄。

### 验证记录
- 前端生产构建：`frontend` 下执行 `npm run build` 成功（Vite 6.4.2，1706 modules）。
- 宽度公式检查：390、1440、1919、1920、2540、2560 CSS px 视口下，内容区宽度均不超过可用主区域和 1920px；1919→1920 为自然增加 1px，2540→2560 平滑增加约 8px，无阶梯跳变。
- 本地预览包：`scripts/build_release.ps1 -PreviewBuild -Version 1.3.0 -PreviewSerial 001 -ReleaseDate 20260725 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release/报销管理-v1.3.0-preview-20260725-001.zip`（45.05 MB）。
- 预览包内容校验：263 个 ZIP 条目，启动器、版本目录和两个清单均存在；清单版本均为 `1.3.0-preview-20260725-001`，未包含 data、uploads、logs、browser-profile、vendor、window-state.json 等运行态内容；SHA-256 为 `8BC86419C6075C6E2DE40114C8BCC3D16B65EAB4673DAE6EC3E4D006E644630B`。
- 定向后端发布/升级测试：`tests/test_phase6_release.py tests/test_zip_upgrade_script.py`，9 passed（7 个既有弃用警告）；前端工具测试：`node --test src/**/*.test.js`，72 passed。
- 完整 pytest 未通过：现有 `.release-venv` 未安装 `PyYAML`，`tests/test_publish_release_workflow.py` 在收集阶段报 `ModuleNotFoundError: yaml`；该测试依赖不属于预览包运行依赖，未修改环境或依赖清单。
- `git diff --check` 通过。

### 已同步到 CHANGELOG
- 已在 `Unreleased` 的 `Fixed` 中记录全屏与窗口化内容区宽度跳变修复。
