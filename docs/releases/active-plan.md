# 当前开发计划

## 状态
- 版本号：v1.3.0
- 计划状态：规划中
- 预计版本类型：minor

## 目标
- [x] feat: 所有费用类别增加纸质发票填报入口，可手动添加发票金额和张数，不用考虑纸质发票的上传和保存。
- [x] feat: 报销单费用汇总增加“调整途中补贴”入口，支持“自动计算”和“人工核定补贴总额”两种方式；人工核定不考虑补贴天数，PDF 仅填写补贴总额。
- [ ] feat: 上传重复发票预警
- [ ] 发票信息确认窗口打开原始文件按钮，可调用本地默认PDF浏览器。（适用本地版，服务器版仍保留浏览器打开）
- [x] feat：根据实际的报销流程，增加报销单状态：草稿-已核对（新增状态）-已提交（原名：已打印）-已报销（报销打款，流程结案）。允许批量修改状态。报销单录入页面的状态修改功能要同步做改动。
- [x] fix bug: 已报销状态下，进入报销单后，预览和下载都是灰度，改为允许预览和下载。
- [x] fix bug: PDF输出时其他费用-项目一列，限制最大字号9.7pt

## 范围
本次做：
- 纸质发票的手工金额与张数填报。
- 途中补贴支持保留自动计算，或直接人工核定最终总额；人工核定时不录入、不展示也不输出补贴天数。
- 报销单增加“已核对”状态，将原“已打印”显示名调整为“已提交”，并在列表和录入页支持完整状态流转；列表支持批量修改状态。
- 上传重复发票预警。
- 本地版发票信息确认窗口使用系统默认 PDF 浏览器打开原始文件，服务器版保留浏览器打开方式。

本次不做：
- 不按出发/到达时间、短时外出次数、餐次或工作餐安排建立额外的自动判断规则。
- 不支持人工填写或折算补贴天数，人工核定只修改最终补贴总额。
- 未明确版本号和发布前验证前，不主动同步或部署 Linux 服务器；后续修改先在本地完成测试。

## 报销单状态流程

### 产品规则
- 用户可见流程为“草稿 → 已核对 → 已提交 → 已报销”；已报销表示打款完成、流程结案，不允许回退。
- 手工状态操作按相邻节点流转：草稿可标记为已核对；已核对可提交或退回草稿；已提交可标记为已报销或退回已核对。
- 原内部状态值 `printed` 继续保留，仅将用户可见名称由“已打印”调整为“已提交”；既有记录无需转换即可显示为已提交。
- PDF 预览、单张下载和批量下载均为纯输出操作，不修改报销单状态或报销日期；状态由用户手工流转，为后续自动化 workflow 保留清晰边界。

### 批量操作与数据兼容
- 列表中的可流转状态徽标可直接打开相邻状态操作；单一状态的批量选择直接显示主要下一步，混合状态选择按目标展示可更新与跳过数量。只更新符合状态机规则的记录，同状态、非法跨级、已报销、已删除或不存在的记录逐条提示并跳过。
- 流转到“已报销”前必须二次确认，确认框默认聚焦“取消”；已报销状态保持只读，不提供回退操作。
- 批量回退只创建一次安全快照；快照失败时整批中止，不产生部分回退。
- 新增状态值会使旧版本无法完整识别新版数据，SQLite 数据域版本由 v3 升级至 v4；升级保留全部旧数据，继续兼容 v1-v3 数据包导入。
- 数据域版本 `v4` 与应用版本号相互独立：本功能是兼容旧记录的新增能力，应用版本仍按 minor 发布为 `v1.3.0`，不升级到 `v2.0.0`。

### 验收与测试
- 列表页可按草稿、已核对、已提交、已报销筛选，并以对应状态徽标显示；六个页签在窄屏可滚动，不造成页面横向溢出。
- 录入页针对四种状态显示正确的前进/退回操作；已报销不提供状态修改操作。
- 批量修改正确处理合法流转、同状态跳过、非法跨级跳过、结案状态跳过、缺失记录跳过和批量回退快照。
- 导出和重新导入可保留已核对状态；数据库完整性检查将已核对识别为合法状态。

## 途中补贴调整方案

### 产品规则
- 默认继续使用“自动计算”：按现有行程区间计算补贴天数，再乘以途中补贴日标准；现有报销单默认保持该方式。
- 费用汇总的“途中补贴”区块增加“调整途中补贴”入口，打开后只提供“自动计算”和“人工核定补贴总额”两个选项。
- 选择“人工核定补贴总额”时，仅填写一个不小于 `0.00`、保留两位小数的金额；进入人工核定时默认带入当前自动计算总额，用户可直接修改。
- 人工核定总额是最终生效值，不再参与“补贴天数 × 日标准”计算；后续修改行程、日标准、发票或其他费用时不得覆盖该值。
- 切回“自动计算”时清除人工核定值，并立即按当前行程和日标准恢复自动计算。
- 人工核定状态下，编辑页途中补贴区显示“人工核定”标识和最终总额，不显示补贴天数；自动计算状态显示“自动计算”标识、补贴天数和总额。

### PDF、列表与统计
- 自动计算状态的 PDF 保持现状，同时填写补贴天数和补贴金额。
- 人工核定状态的 PDF 将补贴天数字段留空，只填写人工核定的补贴总额。
- 报销单管理列表的“补贴天数”列对人工核定记录显示“人工核定”，不得显示 `0 天` 或自动推算天数。
- 使用补贴天数范围筛选时，人工核定记录没有可比较的补贴天数，应从筛选结果中排除。
- 报销总额、补领不足、归还多余、看板费用分布和趋势统计统一使用最终生效的补贴总额。

### 数据与后端
- 在报销单增加可空的人工核定补贴总额字段；`NULL` 表示自动计算，包含 `0.00` 在内的数值表示人工核定，避免把“人工核定为零”误判为自动状态。
- 现有 `subsidy_total` 继续保存最终生效值；自动状态按现有规则重算，人工状态取人工核定值。人工状态下 `subsidy_days` 置为 `0`，但所有展示和 PDF 必须根据人工状态隐藏天数，而不是展示为零天。
- 修改统一重算逻辑和程序启动时的历史报销单重算逻辑，确保人工核定值不会被覆盖；切回自动状态后仍能从行程重新得出天数和金额。
- SQLite 数据结构由 v2 升级至 v3；旧数据库迁移后人工核定字段默认为 `NULL`，原有报销单行为不变，旧版本不得回退操作升级后的数据库。
- 数据导出包保存人工核定字段；继续兼容既有 v1/v2 导入包，缺少该字段时按自动计算处理。覆盖导入、合并导入和导入后重算流程均需同步适配。

### 前端与交互
- “调整途中补贴”使用明确提交的弹窗或对话框，避免在汇总卡内直接裸露金额输入框；关闭或取消不改变当前状态。
- 人工核定金额允许 `0.00`，使用金额输入校验，并与现有自动保存状态保持一致。
- 人工核定时，在日标准或行程区域提示“当前使用人工核定总额，修改行程或日标准不会改变补贴总额”。
- 前端汇总预览、保存载荷和后端返回值使用同一模式判定，避免保存前后报销总额跳变。

### 验收与测试
- 自动计算回归：补贴天数、补贴总额、PDF、列表和统计结果与现有规则一致。
- 人工核定：支持普通金额和 `0.00`；保存、刷新、重启程序以及修改行程、日标准、发票后金额保持不变。
- 模式切换：自动转人工时正确带入当前总额；人工转自动时清除人工值并按最新行程、日标准重算。
- PDF：人工核定时补贴天数字段为空、补贴总额正确；自动计算时两个字段均保持现状。
- 列表与筛选：人工核定记录显示“人工核定”，不被补贴天数范围筛选误命中；金额筛选继续使用最终报销总额。
- 数据兼容：数据库迁移、v1/v2 旧包导入、新版导出后再导入、覆盖/合并导入均保留正确模式和金额。
- 完成后运行补贴算法、报销单 CRUD、PDF、统计、数据迁移/导入导出相关后端测试，前端工具测试和生产构建，并把结果记录到本计划。

## 版本号判断
- 如果只是修复问题：patch
- 如果增加用户可见功能：minor
- 如果数据结构或使用方式有不兼容变化：major

---

## 完成记录

### 重要改动
- feat(report): 报销单列表将状态徽标改为就地流转入口；同状态批量选择直接展示主要下一步，混合状态选择展示各目标的可更新/跳过数量，结案操作保留二次确认。
- fix(report): PDF 预览、单张下载和批量下载不再联动状态或报销日期，下载一次即可触发文件保存，状态完全由用户手工修改。
- fix(release): Windows 本地包的 `portable-release.json` 与 `current-version.json` 改为从后端数据结构常量读取兼容版本，避免应用已升级至 v4 时打包清单仍错误标记为 v1。
- fix(report): 报销单录入页将 PDF 预览、下载权限与“已报销不可编辑”解耦；草稿、已核对、已提交、已报销均可使用 PDF 操作，未确认发票和燃油补助发票不足的既有校验保持不变。
- fix(pdf): PDF“其他费用-项目”列最大字号由 10.2pt 限制为 9.7pt，较长项目名称继续沿用现有宽度自适应缩小逻辑。
- feat(report): 报销流程扩展为“草稿、已核对、已提交、已报销”；原内部 `printed` 值保持兼容并统一显示为“已提交”，录入页按相邻节点提供前进和退回操作，已报销继续作为不可回退的结案状态。
- feat(report): 报销单管理列表新增“已核对”页签和批量状态修改；合法记录统一更新，非法跨级、同状态、已结案或缺失记录逐条跳过，批量回退只创建一次安全快照。
- feat(data): 新增 `checked` 状态并将 SQLite 数据域与导出包结构升级至 v4；既有 `printed` 记录无需迁移，继续兼容 v1-v3 数据包导入。
- feat(report): 行程车船费、固定费用和自定义费用均可按需展开“添加纸质发票”输入区；默认卡片仅显示按钮，已录入后收起为金额/张数摘要。纸质发票不保存附件，直接与已确认电子发票共同计入汇总、PDF、统计、筛选和燃油补助发票缺口。
- feat(report): 报销单管理列表在“报销总金额”后显示“发票总数”，合并统计未删除电子发票与已登记纸质发票。
- feat(data): 新增纸质发票金额与张数字段，SQLite 数据结构升级至 v2；v2 导出包保留纸票数据，仍可导入 v1 包并以零值补齐。旧版本不得回退操作 v2 数据库，避免忽略纸票数据。
- feat(report): 费用汇总新增“调整途中补贴”弹窗，可在自动计算和人工核定最终总额之间切换；汇总区始终显示当前计算方式标签；人工模式支持 `0.00`，修改行程、日标准、发票或其他费用时保持核定金额，列表以“人工核定”替代补贴天数。
- feat(pdf): 人工核定途中补贴时，PDF 补贴天数字段留空，仅填写最终补贴总额；自动计算模式保持原有天数和金额输出。
- feat(data): 报销单和数据包新增可空的人工核定补贴总额，SQLite 与导出结构升级至 v3；继续兼容 v1/v2 数据包，并拒绝负值、非有限值和非法人工金额。
- fix(ui): 全站内容区由 1440 / 1680 / 1920 的阶梯式最大宽度改为连续插值，保留 1920px 上限与居中 gutter。窗口化与全屏状态不再因跨过 2560px CSS 视口断点而使行程卡片突然缩窄。
- fix(desktop): Chrome/Edge app-mode 捕获窗口状态时跳过最小化窗口；读取历史状态时自动丢弃 DPI 虚拟化后的最小化哨兵坐标，避免下次启动复用 `-21333/-21333` 等无效位置。

### 验证记录
- 最终本地预览包（含单行状态更新后的选择清理）：`scripts/build_release.ps1 -PreviewBuild -Version 1.3.0 -PreviewSerial 003 -ReleaseDate 20260726 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release/报销管理-v1.3.0-preview-20260726-003.zip`（45.97 MB）；`002` 按不覆盖、不删除既有 ZIP 的发布规则保留为中间验证产物。
- preview-20260726-003 内容校验：264 个 ZIP 条目，启动器、版本目录和清单均存在；应用版本为 `1.3.0-preview-20260726-003`，数据结构为 v4、支持 v1-v4；未包含 data、uploads、logs、browser-profile、vendor、window-state.json、测试目录或既有 release 产物；SHA-256 为 `7FEF66A8425F12D4C4EB524B974262F016F02814A443E66ABE972452E18A1FFC`。
- 本地预览包（PDF 与状态解耦、列表状态交互简化）：`scripts/build_release.ps1 -PreviewBuild -Version 1.3.0 -PreviewSerial 002 -ReleaseDate 20260726 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release/报销管理-v1.3.0-preview-20260726-002.zip`（45.97 MB）。
- preview-20260726-002 内容校验：264 个 ZIP 条目，启动器、版本目录和清单均存在；应用版本为 `1.3.0-preview-20260726-002`，数据结构为 v4、支持 v1-v4；未包含 data、uploads、logs、browser-profile、vendor、window-state.json、测试目录或既有 release 产物；SHA-256 为 `AD1BD1CE873F0E43F7AD7A3378B955ADCD60A950335EFFF6368D2DC71B444E69`。
- PDF 与状态解耦完整回归：`python -m pytest -q`，331 passed、2 skipped（7 个既有弃用警告）；前端 `node --test src/**/*.test.js`，83 passed；`npm run build` 成功（Vite 6.4.2，1710 modules，仅有既有大 chunk 提示）。
- 状态交互浏览器验收：单张状态徽标仅展示合法相邻流转；同状态批量选择直达主要下一步，混合选择正确显示可更新/跳过数量；“已报销”结案确认在过渡结束后默认聚焦“取消”；草稿下载后状态仍为 `draft`、报销日期仍为空。桌面与 390×844 下无页面级横向溢出，控制台仅有既有 React Router v7 future flag 提示。
- 本地预览包（PDF 操作、字号及 v4 清单修复）：`scripts/build_release.ps1 -PreviewBuild -Version 1.3.0 -PreviewSerial 001 -ReleaseDate 20260726 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release/报销管理-v1.3.0-preview-20260726-001.zip`（45.22 MB）。
- preview-20260726-001 内容校验：264 个 ZIP 条目，启动器、版本目录和清单均存在；应用版本为 `1.3.0-preview-20260726-001`，数据结构为 v4、支持 v1-v4；未包含 data、uploads、logs、browser-profile、vendor、window-state.json、测试目录或既有 release 产物；SHA-256 为 `22AB110AA94ED709EB313505926F98086C60842A81240822AF5EB14C5B6D9D21`。
- 发布清单定向回归：`python -m pytest tests/test_phase6_release.py tests/test_zip_upgrade_script.py -q`，9 passed（7 个既有弃用警告）；`build_release.ps1` PowerShell 语法检查通过。
- PDF 操作浏览器验收：草稿、已核对、已提交、已报销四种录入页的“预览”“下载”按钮均可用；已报销页面仍保持字段只读，浏览器控制台无错误。
- PDF 状态与字号定向回归：`python -m pytest tests/test_phase4.py -q`，30 passed（5 个既有弃用警告）；覆盖已核对、已报销状态下预览和下载成功且状态/日期不变，并断言“其他费用-项目”列最大字号为 9.7pt。
- 本轮完整回归：`python -m pytest -q`，331 passed、2 skipped（7 个既有弃用警告）；前端 `node --test src/**/*.test.js`，81 passed；`npm run build` 成功（Vite 6.4.2，1710 modules，仅有既有大 chunk 提示）。
- 报销状态完整后端回归：`python -m pytest -q`，329 passed、2 skipped（7 个既有弃用警告）。
- 报销状态定向后端回归：`tests/test_status_machine.py tests/test_report_batch.py tests/test_report_crud.py tests/test_report_trash.py tests/test_phase3.py tests/test_phase5_2.py`，126 passed（5 个既有弃用警告）；覆盖四段状态机、批量更新/跳过、批量回退快照、v4 导出及已核对状态导入。
- 数据结构与维护定向回归：`tests/test_maintenance_service.py tests/test_settings_fonts.py`，41 passed。
- 报销状态前端工具测试：`frontend` 下执行 `node --test src/**/*.test.js`，80 passed；`npm run build` 成功（Vite 6.4.2，1710 modules，仅有既有大 chunk 提示）。
- 报销状态浏览器验收：列表显示草稿、已核对、已提交、已报销四种徽标；批量目标状态和操作按钮可用；录入页四种状态分别显示正确操作。桌面工具条无挤压，390×844 下工具条自然换行、状态页签可滚动且页面无横向溢出；控制台仅有既有 React Router v7 future flag 提示。
- 途中补贴完整后端回归：`python -m pytest -q`，319 passed、2 skipped（7 个既有弃用警告）。
- 途中补贴前端工具测试：`frontend` 下执行 `node --test src/**/*.test.js`，78 passed；`npm run build` 成功（Vite 6.4.2，1709 modules，仅有既有大 chunk 提示）。
- 途中补贴浏览器验收：自动计算显示“自动计算”标签和 2 天 / ¥160.00；取消人工输入不提交；人工 ¥80.00 自动保存且刷新后保留；人工 `0.00` 有效；列表显示“人工核定”。390×844 视口下弹窗无截断、溢出或控件重叠，控制台无错误；自动计算标签经用户验收确认。
- 途中补贴 PDF 验收：相关测试 35 passed；真实模板中人工核定天数字段为空、总额正确，未出现裁切或重叠。
- 报销单列表发票总数：`tests/test_report_crud.py`，19 passed；前端生产构建 `npm run build` 成功（Vite 6.4.2，1709 modules）。
- 纸质发票定向后端回归：`tests/test_report_crud.py tests/test_phase3.py tests/test_phase4.py tests/test_phase5_2.py tests/test_settings_fonts.py tests/test_maintenance_service.py`，145 passed（5 个既有弃用警告）。
- 数据结构兼容与发布回归：`tests/test_desktop_dependencies.py tests/test_phase6_release.py tests/test_zip_upgrade_script.py tests/test_release_publish_state_machine.py tests/test_changelog_release_metadata.py tests/test_changelog_release_notes.py`，44 passed（7 个既有弃用警告）。
- 前端工具测试：`frontend` 下执行 `node --test src/**/*.test.js`，73 passed；前端生产构建 `npm run build` 成功（Vite 6.4.2，1709 modules）。
- test(deps): 新增 `backend/requirements-dev.txt`，集中管理完整 pytest 所需的运行依赖、`pytest` 与 `PyYAML`；预览和正式发布工作流统一从该清单安装，运行时与打包依赖保持分离。
- 前端生产构建：`frontend` 下执行 `npm run build` 成功（Vite 6.4.2，1706 modules）。
- 宽度公式检查：390、1440、1919、1920、2540、2560 CSS px 视口下，内容区宽度均不超过可用主区域和 1920px；1919→1920 为自然增加 1px，2540→2560 平滑增加约 8px，无阶梯跳变。
- 本地预览包：`scripts/build_release.ps1 -PreviewBuild -Version 1.3.0 -PreviewSerial 001 -ReleaseDate 20260725 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release/报销管理-v1.3.0-preview-20260725-001.zip`（45.05 MB）。
- 预览包内容校验：263 个 ZIP 条目，启动器、版本目录和两个清单均存在；清单版本均为 `1.3.0-preview-20260725-001`，未包含 data、uploads、logs、browser-profile、vendor、window-state.json 等运行态内容；SHA-256 为 `8BC86419C6075C6E2DE40114C8BCC3D16B65EAB4673DAE6EC3E4D006E644630B`。
- 本地预览包（含窗口状态修复）：`scripts/build_release.ps1 -PreviewBuild -Version 1.3.0 -PreviewSerial 002 -ReleaseDate 20260725 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release/报销管理-v1.3.0-preview-20260725-002.zip`（45.05 MB）。
- preview-002 内容校验：263 个 ZIP 条目，启动器、版本目录和两个清单均存在；清单版本均为 `1.3.0-preview-20260725-002`，未包含 data、uploads、logs、browser-profile、vendor、window-state.json 等运行态内容；SHA-256 为 `66D5863D5FBBC5735540B8BFE3BDCAF17D1BDCD543062C2DE419253BC6731D6B`。
- 定向后端发布/升级测试：`tests/test_phase6_release.py tests/test_zip_upgrade_script.py`，9 passed（7 个既有弃用警告）；前端工具测试：`node --test src/**/*.test.js`，72 passed。
- 桌面窗口状态回归：`python -m pytest tests/test_desktop_dependencies.py -q`，13 passed（7 个既有弃用警告）；覆盖历史 `-21333/-21333` 状态清理和最小化 Chrome/Edge 窗口不再写入状态。
- preview-002 打包前组合回归：`tests/test_desktop_dependencies.py tests/test_phase6_release.py tests/test_zip_upgrade_script.py`，22 passed（7 个既有弃用警告）；前端 `node --test src/**/*.test.js`，72 passed。
- `.release-venv` 已通过 `backend/requirements-dev.txt` 安装 `PyYAML 6.0.3`；完整 `pytest -q` 通过，304 passed、2 skipped（7 个既有弃用警告）。
- `git diff --check` 通过。

### 已同步到 CHANGELOG
- 已在 `Unreleased / Changed` 中记录 PDF 输出与状态流转解耦，以及列表单张/批量状态操作简化。
- 已在 `Unreleased / Fixed` 中记录本地发布包数据兼容清单与应用数据结构版本不同步的问题。
- 已在 `Unreleased / Fixed` 中记录四种报销状态均可预览和下载 PDF，以及“其他费用-项目”列最大字号限制为 9.7pt。
- 已在 `Unreleased` 的 `Added` / `Changed` 中记录四段报销状态、批量修改状态，以及“已打印”更名为“已提交”的兼容策略。
- 已在 `Unreleased` 的 `Added` 中记录途中补贴自动计算 / 人工核定总额，以及人工模式 PDF 仅输出最终总额。
- 已在 `Unreleased` 的 `Fixed` 中记录全屏与窗口化内容区宽度跳变、最小化窗口错误保存坐标修复。
