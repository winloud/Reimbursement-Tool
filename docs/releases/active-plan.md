# 当前开发计划

## 状态
- 版本号：v1.2.3
- 计划状态：开发中
- 预计版本类型：minor（出差补贴「起/止」模型行为变化，用户可见、影响报销金额；含 UI 调整与一次性历史数据清洗）

## 目标
- [x] 新增发布失败回滚功能，在 GitHub Actions 失败时提供交互式回滚选项（已合并 main）。
- [x] 各页面内容宽度对齐 + 响应式适配（14"/15.6"/27"/32" 显示器）。
- [x] 报销单列表对非法行程脏数据容错，避免单条脏数据导致整页 500。
- [ ] 重新设计出差补贴「起/止」标记模型：默认整段 + 例外手动切分。
- [ ] 去掉行程卡片折叠功能。

## 范围
本次做：
1. 发布失败回滚（已完成，已在 main）。
2. 页面宽度统一 + 响应式分级（已完成）。
3. 列表脏数据容错 + 回归测试（已完成）。
4. 出差补贴「起/止」模型重设计（进行中）—— 详见下方专章。
5. 去掉行程卡片折叠（随第 4 项一起）。

本次不做：
- 未明确版本号和发布前验证前，不主动同步或部署 Linux 服务器；后续修改先在本地完成测试。

## 版本号判断
- 如果只是修复问题：patch
- 如果增加用户可见功能：minor
- 如果数据结构或使用方式有不兼容变化：major
- 本次：起/止补贴算法行为变化属用户可见，定 **minor**；数据库字段未变（仅一次性清洗历史标记值），不构成 major。

---

## 专章：出差补贴「起/止」模型重设计

### 背景与缺陷
报销单录入页用每段两个「起/止」开关标记补贴区间，现有实现有真实缺陷：
1. **「全有或全无」模式切换**：任一段有标记就整单转手动、其余段自动推断全失效。
2. **「生成返程」继承标记 → 补贴算错**：`makeReturnTripAfter` 保留源段起/止，单段往返被算成两个独立单天区间，漏算中间天（实例 report 153：北京→上海 6/26、上海→北京 6/28 算成 2 天，应为 3 天）。
3. **靠地名字符串相等认「家」**：北京 vs 北京市/北京南站 就失效。
4. **三处并行逻辑**（前端 reportEditUtils、后端 report_service、stats_service）易不一致。
5. 行程卡片**折叠**功能无必要。

### 新模型（领域负责人拍板）
- **默认（绝大多数报销）**：补贴 = **第 1 段出发日 → 最后 1 段到达日**，覆盖中间所有自然日。不需任何标记，不看地名。（依据：现代交通一次行程多为当天/隔天，首段到达时间不重要；用首段出发 + 末段到达算时长。）
- **第 1 段隐含「起」、最后 1 段隐含「止」**——单次往返零操作即正确。
- **起/止只在例外时手动用**：一个出差事由中途回家或去别的项目地点、要把中间某段挖掉不算补贴时，标「止」(这段出差结束) +「起」(下段出差重启) 切分；区间之间的间隙不计补贴。回家与去别处用同一套手动切分，无特殊逻辑。
- 无模式切换、不看地名。

补贴天数算法（统一，替代现有「has_manual_markers 两分支 + 地名推断」）：
```
effective_start(i) = (i == 0) or trip[i].subsidy_start
effective_end(i)   = (i == last) or trip[i].subsidy_end
按顺序配对成 [depart, arrive] 区间 → 相邻合并 → 自然日含首尾(+1)累加
校验：连续起 / 孤止 / 止早于起 → 友好报错
```

### 实现步骤
1. **后端 `backend/services/report_service.py`**：重写 `calculate_subsidy_days`（去 `has_manual_markers` 分支）；`build_subsidy_intervals` 注入 effective 首末并保留 4 类校验；删除 `derive_default_subsidy_markers`；建议把「隐含首末 + 配对」抽成单一共享函数。
2. **后端 `backend/services/stats_service.py`**：`report_trip_intervals` 复用同一共享函数，根除三处不一致。
3. **前端 `frontend/src/pages/reportEditUtils.js`**：重写 `calculateSubsidyDays` 与后端规则逐字对齐；删除 `applyDefaultSubsidyMarkers` 及其调用点（`addTrip`/`loadForEdit`）；`cloneTripAfter`/`makeReturnTripAfter` 清空生成段的 `subsidy_start/end`。
4. **UI `frontend/src/pages/ReportEdit.jsx`**：第 1 段「起」、最后 1 段「止」隐含锁定高亮（标“出差开始/结束·自动”，不可点），中间段「止」「起」可点切分；头部摘要仅在切分处显示起止；去掉折叠（`collapsed`/`toggleTripCollapsed`/图标/`!trip.collapsed` 包裹）并从 `normalizeTrip` 移除 collapsed。
5. **历史数据清洗（一次性）**：`n>1` 时清掉第 1 段 `subsidy_end`、清掉最后 1 段 `subsidy_start`（冗余/bug 产物），中间段保留；单段清显式标记（隐含补回）。效果：153 式修正为 3 天，多段往返天数不变。仿 `backend/database/connection.py` 的 migrate 方式，执行前自动备份。
6. **测试**：`tests/test_phase3.py` 与 `frontend/src/pages/reportEditUtils.test.js` 同步更新预期，新增「默认整段=首末」「中途切分排除在家间隙」「返程不继承标记」用例；删/改 `derive_default_subsidy_markers`/`applyDefaultSubsidyMarkers` 相关断言。

### 验证
- 后端：`.release-venv/Scripts/python.exe -m pytest tests/test_phase3.py tests/test_report_crud.py -q`
- 前端：reportEditUtils 单测 + `npm run build`
- 手动（dev server）：report 153 显示 3 天且首起末止中间无标记；新建单次往返零操作正确；多段中途回家标切分排除间隙；历史单天数不回归。

### 风险
- 三处逻辑一致性：务必抽共享函数、前后端规则逐字对齐。
- 历史数据迁移：必须备份 + 用真实历史单验证天数不回归。
- PDF 不依赖起止（仅用 subsidy_days/total），不受影响。

---

## 完成记录

### 重要改动
- 发布总控脚本新增 `Invoke-RollbackPrompt`，GitHub Actions workflow 失败后提供交互式回滚选项（已在 main）。
- 各页面内容宽度统一由 App 外层容器控制，响应式分级（笔记本 ~1440 / 27" ~1680 / 32" ~1920）；报销单录入「基本信息」卡片字段区由 MUI Grid 改为 CSS Grid 消除右侧留白不对称。（commit `4ad65c5`）
- 报销单列表排序/筛选路径对 `TripDateError` 容错，单条脏数据不再让整页 500；新增回归测试。（commit `2c0e2bf`）

### 验证记录
- [x] PowerShell 语法检查：`release_publish.ps1` 的 `Invoke-RollbackPrompt` 可解析。
- [x] 前端 `npm run build` 通过（宽度对齐 + 基本信息卡片）。
- [x] 后端 `pytest`（report_crud/trash/batch/status_machine）40 passed，含列表容错回归测试。
- [ ] 起/止模型重设计的前后端测试与手动验证（待实现后补）。

### 已同步到 CHANGELOG
- 已在 Unreleased 记录发布失败回滚功能。
- 待补：页面宽度对齐、列表脏数据容错、出差补贴起止模型重设计。
