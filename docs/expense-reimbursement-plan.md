# 出差旅费报销管理工具 — 开发规划文档

> 本文档用于指导 Claude Code 完成项目的完整开发。请按照文档中的阶段顺序逐步实现，**每个阶段完成后必须停止，输出验收结果，等待用户确认后再进入下一阶段**。
> 从 2026-06-04 起，本文件是唯一维护的开发文档；根目录临时开发计划和工作记录已合并进本文档，不再单独维护。

---

## 一、项目概述

### 背景
用户需要一个本地单机运行的出差旅费报销管理工具，用于录入出差信息、管理发票、生成符合公司模板的报销 PDF 文件。

### 核心目标
- 替代手动填写纸质报销单的流程
- 自动统计发票张数和金额
- 自动填充 PDF 模板并生成可打印文件
- 提供历史报销数据的统计看板

### 使用场景
- **用户**：单用户，个人本地使用
- **分发方式**：整个工具文件夹复制给同事，单机运行
- **启动方式**：优先封装为 EXE（单目录模式）；或作为本地 Web 应用在浏览器中操作
- **备份方式**：直接复制工具文件夹，无需内置备份功能

---

## 二、技术栈

### 前端
- **框架**：React 18 + Vite
- **UI 组件库**：MUI (Material UI) v5
- **状态管理**：Zustand
- **路由**：React Router v6
- **图表**：Recharts
- **HTTP 请求**：Axios

### 后端
- **框架**：FastAPI (Python 3.11+)
- **数据库**：SQLite + SQLAlchemy 2.0
- **数据校验**：Pydantic v2
- **金额计算**：Python `decimal.Decimal`（禁止使用 float）
- **PDF 处理**：pypdf（读取模板域）+ reportlab（填充内容）+ PyMuPDF（发票 PDF 文本提取、第一页内存渲染预览图）
- **电子发票解析**：
  - PDF 发票：PyMuPDF 读取并内存渲染第一页图片，优先使用 OpenCV WeChatQRCode 识别二维码，失败后用 PyMuPDF 文本提取 + 正则兜底
  - XML / OFD 发票不再支持，上传时直接提示不支持

### 打包
- **EXE 封装**：PyInstaller 单目录模式（`--onedir`），启动快，不触发杀毒误报

---

## 三、系统架构

### 3.1 分层架构

```
Frontend → Router → Service → Database
```

**职责定义：**
- **Router**：接收请求、参数校验（Pydantic Schema）、调用 Service、返回统一格式 Response
- **Service**：业务逻辑、金额计算、状态流转、数据聚合，并直接通过 SQLAlchemy Session 访问数据库
- **Database**：SQLite 本地数据库，由 SQLAlchemy Model 映射
- **禁止**：Router 直接操作数据库
- **不设置 Repository 层**：本项目为单用户本地工具，Service 直连数据库即可，避免过度设计和样板代码

### 3.2 项目目录结构

```
reimbursement-tool/
├── frontend/                      # React + Vite 前端
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx          # 总览看板
│   │   │   ├── ReportList.jsx         # 报销单列表
│   │   │   ├── ReportEdit.jsx         # 新增/编辑报销单
│   │   │   └── ReportPrint.jsx        # 打印预览
│   │   ├── components/
│   │   ├── store/                     # Zustand 状态
│   │   └── api/                       # Axios 封装
│   └── package.json
│
├── backend/                       # FastAPI 后端
│   ├── main.py                        # 应用入口
│   ├── database/
│   │   ├── connection.py              # SQLite 连接配置
│   │   └── session.py                 # Session 管理
│   ├── models/                        # SQLAlchemy 数据模型
│   │   ├── report.py
│   │   ├── trip.py
│   │   ├── expense_item.py
│   │   └── invoice.py
│   ├── schemas/                       # Pydantic 请求/响应 Schema
│   │   ├── report.py
│   │   ├── invoice.py
│   │   └── common.py                  # 统一响应格式
│   ├── routers/                       # API 路由
│   │   ├── reports.py
│   │   ├── invoices.py
│   │   ├── settings.py
│   │   └── stats.py
│   ├── services/                      # 业务逻辑
│   │   ├── report_service.py
│   │   ├── invoice_service.py
│   │   ├── pdf_generator.py           # PDF 填充逻辑
│   │   ├── invoice_parser.py          # 电子发票解析
│   │   └── amount_converter.py        # 金额转中文大写
│   ├── templates/
│   │   └── expense_template.pdf       # PDF 模板文件（用户提供）
│   └── uploads/                       # 发票文件存储根目录
│       └── {report_id}/               # 按报销单 ID 分目录
│
├── data/
│   └── expense.db                     # SQLite 数据库文件
│
└── build/                         # PyInstaller 打包输出
```

---

## 四、数据库设计

> **重要**：所有金额字段在 Python 层使用 `Decimal(18,2)`，禁止使用 `float`，避免财务计算精度误差。SQLAlchemy 字段类型使用 `Numeric(18, 2)`。

### 表：`settings`（系统配置，单行）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 固定为 1 |
| department | TEXT | 部门（记忆上次填写） |
| employee_name | TEXT | 出差人姓名（记忆上次填写） |
| daily_subsidy | NUMERIC(18,2) | 途中补贴日标准金额（元/天） |
| updated_at | DATETIME | 最后更新时间 |

### 表：`expense_reports`（报销单）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| status | TEXT | 状态：`draft` / `printed` / `reimbursed` |
| report_date | DATE | 报销日期 |
| department | TEXT | 部门 |
| employee_name | TEXT | 出差人 |
| purpose | TEXT | 出差事由 |
| daily_subsidy | NUMERIC(18,2) | 本次使用的日补贴金额（可与预设不同） |
| subsidy_days | INTEGER | 补贴天数（自动推算） |
| subsidy_total | NUMERIC(18,2) | 途中补贴合计（自动计算） |
| advance_date_month | INTEGER | 预支旅费月 |
| advance_date_day | INTEGER | 预支旅费日 |
| advance_amount | NUMERIC(18,2) | 预支旅费金额 |
| total_amount | NUMERIC(18,2) | 报销总金额（自动计算） |
| shortfall | NUMERIC(18,2) | 补领不足金额（自动计算） |
| surplus | NUMERIC(18,2) | 归还多余金额（自动计算） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 最后修改时间 |
| deleted_at | DATETIME | 软删除时间戳（NULL 表示未删除） |

### 表：`trips`（行程）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| report_id | INTEGER FK | 关联报销单 |
| sort_order | INTEGER | 行程顺序（从 1 开始） |
| depart_month | INTEGER | 出发月 |
| depart_day | INTEGER | 出发日 |
| depart_hour | INTEGER | 出发时（24小时制） |
| depart_place | TEXT | 出发地点 |
| arrive_month | INTEGER | 到达月 |
| arrive_day | INTEGER | 到达日 |
| arrive_hour | INTEGER | 到达时（24小时制） |
| arrive_place | TEXT | 到达地点 |
| transport | TEXT | 交通工具 |

### 表：`expense_items`（费用项目，每个报销单对应固定的费用类别行）

> **设计说明**：`expense_items` 不存储冗余的张数和金额，这两个值通过关联 `invoices` 表实时聚合计算，确保数据一致性。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| report_id | INTEGER FK | 关联报销单 |
| category | TEXT | 费用类别（枚举见下方） |
| remark | TEXT | 备注（可为空） |
| created_at | DATETIME | 创建时间 |

**category 枚举值：**
- `transport_fare`：车船费（关联具体行程，通过 `invoices.trip_id` 区分）
- `luggage`：行李费
- `city_transport`：市内车费
- `accommodation`：住宿费
- `postal`：邮电费
- `no_sleeper_subsidy`：不买卧铺补贴
- `toll`：过路费
- `fuel_subsidy`：油补

### 表：`invoices`（发票）

> **设计说明**：发票直接通过 `expense_category` 归属费用类别，通过 `trip_id` 关联行程（车船费专用）。删除发票时优先执行软删除：设置 `deleted_at`，物理文件暂保留，确认或超过保留期后再清理。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| report_id | INTEGER FK | 关联报销单 |
| trip_id | INTEGER FK | 关联行程（车船费专用，其他类别为 NULL） |
| expense_category | TEXT | 费用类别（与 expense_items.category 枚举一致） |
| file_path | TEXT | 文件存储相对路径（`uploads/{report_id}/{expense_category}_invoice_{uuid}.{ext}`） |
| file_type | TEXT | 文件类型：`pdf` / `image` |
| invoice_no | TEXT | 发票号码（解析获取，可为空） |
| invoice_date | DATE | 发票日期（解析获取，可为空） |
| amount | NUMERIC(18,2) | 金额（解析自动填入，用户可修改） |
| amount_confirmed | BOOLEAN | 用户是否已确认金额，默认 false |
| created_at | DATETIME | 上传时间 |
| deleted_at | DATETIME | 软删除时间戳（NULL 表示未删除） |

---

## 五、API 接口设计

### 5.1 统一响应格式

所有接口返回统一的 JSON 结构：

```json
// 成功（单条数据）
{ "success": true, "message": "", "data": {} }

// 成功（列表分页）
{
  "success": true,
  "message": "",
  "data": {
    "items": [],
    "total": 100,
    "page": 1,
    "page_size": 20
  }
}

// 失败
{ "success": false, "message": "报销单不存在", "data": null }
```

在 `schemas/common.py` 中定义通用 Response 泛型类，所有 Router 使用此格式返回。

### 5.2 系统配置
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings` | 获取系统配置 |
| PUT | `/api/settings` | 更新系统配置 |

### 5.3 报销单
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reports` | 获取报销单列表（支持分页、状态筛选） |
| POST | `/api/reports` | 新增报销单 |
| GET | `/api/reports/{id}` | 获取报销单详情（含行程、费用项、发票） |
| PUT | `/api/reports/{id}` | 更新报销单 |
| DELETE | `/api/reports/{id}` | 删除报销单（仅草稿状态可删，执行软删除） |
| PATCH | `/api/reports/{id}/status` | 更新报销单状态 |
| GET | `/api/reports/{id}/pdf` | 生成并下载报销单 PDF |

### 5.4 发票
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/invoices/upload` | 上传发票文件，返回解析结果 |
| GET | `/api/invoices/{id}/file` | 获取发票原文件（用于预览） |
| GET | `/api/invoices/{id}/parse` | 只读重新解析发票文件，返回解析字段、预览图和解析诊断信息 |
| PUT | `/api/invoices/{id}` | 更新发票金额（用户确认后） |
| DELETE | `/api/invoices/{id}` | 删除发票（软删除记录，物理文件暂保留） |

### 5.5 统计看板
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats/summary` | 汇总数据（本月/今年金额和单数、总出差天数） |
| GET | `/api/stats/category` | 费用类别分布 |
| GET | `/api/stats/calendar?year={year}` | 出差日历数据 |

---

## 六、状态机

```
draft ⇄ printed ──→ reimbursed
```

**允许的状态转换：**
- `draft → printed`
- `printed → reimbursed`
- `printed → draft`（允许回退重新编辑）

**禁止的状态转换：**
- `reimbursed → *`（已报销状态完全锁定）

**状态与操作权限：**
- `draft`：可编辑、可删除、可生成PDF
- `printed`：可编辑、可生成PDF、不可删除
- `reimbursed`：只读，所有修改操作拒绝

---

## 七、前端页面设计

### 7.0 全局布局与宽屏适配要求

- 所有页面主内容必须设置最大宽度并在可用主区域内居中，禁止在宽屏显示器上随视口无限拉伸。
- Sidebar 布局下，主内容区在桌面端保留稳定外侧 gutter，卡片不得贴近浏览器滚动条或视口边缘。
- 表单、列表、看板、打印预览等页面都应使用统一的内容宽度上限；确需更宽时必须说明原因并单独限制内部控件宽度。
- 录入工作台中的基础信息卡片保持主录入列满宽；行程卡片和其他费用卡片等重复卡片在桌面端优先采用两列网格。

### 7.1 总览看板（Dashboard）

**顶部统计卡片（4个）：**
- 本月报销金额
- 本月报销单数
- 今年报销金额
- 今年报销单数

**中部图表（左右布局）：**
- 左：费用类别分布饼图（各类占比）
- 右：近6个月报销金额趋势折线图

**底部：**
- 出差日历视图（蓝色标出出差天数，显示今年累计出差天数）
- 最近报销单列表（最近5条，可快速跳转编辑）

### 7.2 报销单列表（ReportList）

**列表字段：** 出发日期 / 出差事由 / 出差天数 / 报销总金额 / 状态 / 操作

**功能：**
- 默认按出发日期倒序排列
- 状态筛选 Tab（全部 / 草稿 / 已打印 / 已报销）
- 右上角「新增报销单」按钮

### 7.3 新增/编辑报销单（ReportEdit）

**单页录入工作台，不使用 Step 1 → 2 → 3 分步骤表单。**

新增报销单进入 `/reports/new` 后应立即调用 `POST /api/reports` 创建 draft，并使用 `replace` 跳转到 `/reports/{id}/edit`。这样用户不需要先点击“保存草稿”，就可以直接编辑行程和上传发票。草稿创建时自动带入系统配置中的部门、出差人、途中补贴日标准。

编辑页采用原型式左侧主录入区 + 右侧 sticky 汇总栏：
- 基础信息：报销日期、部门、出差人、出差事由、途中补贴日标准、预支旅费月/日/金额，字段修改后自动保存
- 行程列表：每张行程卡包含出发/到达（月、日、时、地点）、交通工具、车船费发票区域；桌面端使用两列卡片网格
- 其他费用：行李费 / 市内车费 / 住宿费 / 邮电费 / 不买卧铺补贴 / 过路费 / 油补，各自独立上传发票；桌面端使用两列卡片网格
- 右侧汇总：各类费用、途中补贴、报销总金额、补领不足、归还多余
- 底部/顶部操作：状态流转、生成 PDF、返回列表

自动保存规则：
- 基础信息、预支信息、行程、其他费用备注均进入本地 state 后 debounce 调用 `PUT /api/reports/{id}`
- 页面显示保存状态：`保存中...` / `已自动保存` / `保存失败，请重试`
- `reimbursed` 状态完全只读，输入、拖拽、复制、交换、上传、删除、金额确认均禁用

空草稿离开规则：
- 空草稿定义：无出差事由、无行程、无发票，且基础字段仍为初始默认值
- 从编辑页返回列表或切换 Sidebar 时，如果 draft 仍为空，弹窗提供“删除空草稿并离开 / 保留草稿并离开 / 取消”
- 浏览器刷新或关闭不强制删除；未确认删除的草稿都保留

行程卡片交互：
- 展开/折叠：折叠时显示摘要，如 `6/1 08 深圳 -> 6/1 11 成都 · 高铁 · 发票 1 张 ¥123.45`
- 拖拽排序：拖拽中提供高亮或占位反馈，排序后自动保存
- 复制行程：复制当前卡片并插入到当前行程后，清空 id，自动保存后获得新 trip id
- 交换出发/到达：在当前卡片内交换月、日、时、地点
- 生成返程：复制当前行程并交换出发/到达，交通工具沿用，插入到当前行程后
- 新增行程保存成功前，车船费上传按钮禁用并提示需等待自动保存完成

发票上传和确认：
- 车船费在行程卡片内上传；其他费用在对应费用卡片内上传
- 支持按钮上传、multiple 批量上传、拖放上传
- 上传完成后打开 InvoiceViewer 让用户确认解析金额；批量上传按队列逐张确认；上传接口返回的发票必须保持 `amount_confirmed = false`，不能因自动解析出金额而直接标记已确认
- 上传过程本身不渲染 PDF iframe 预览；上传完成进入金额确认弹窗后，应默认展示后端生成的图片预览
- 发票列表展示金额、确认状态、文件类型、发票号、查看、删除
- 上传格式以 PDF 为主，图片保留手动录入金额；XML / OFD 不再支持
- 不支持改类别/改行程；归类错误需删除后重新上传


### 7.4 发票查看弹窗（InvoiceViewer）
- 原型风格弹窗，左侧展示关键字段和金额确认，右侧展示 PDF/image 预览
- 提供“解析依据”按钮，弹窗展示本次解析最终采用方式、是否识别成功、最终解析字段，以及二维码/文本正则等候选方式的尝试结果
- PDF：优先使用后端 PyMuPDF 已渲染的图片预览或只读重解析接口生成图片预览，不再在弹窗内嵌 PDF iframe
- 图片：图片查看器
- 未识别 PDF 和图片发票都允许手动输入金额并确认
- 确认后刷新报销单详情和右侧汇总

> 注：OCR 图片识别为第二代功能，第一代图片发票金额由用户手动输入。

---

## 八、PDF 生成逻辑

### 8.1 模板说明
- 模板文件：`backend/templates/expense_template.pdf`
- 纸张尺寸：210mm × 105mm（A5 横向）
- 模板已预设 AcroForm 填写域

### 8.2 分页规则
- 每页最多填写 7 条行程
- 超过 7 条自动增加页数（复制模板页）
- 每页表头重复：报销日期、部门、出差人、出差事由
- **仅最后一页**填写：合计行、报销总金额、预支旅费、补领/归还、签名区

### 8.3 字段填充映射

**每页表头：**
`report_date_year` / `report_date_month` / `report_date_day` / `department` / `employee_name` / `purpose`

**行程行（字段名含行号后缀 `_1` 到 `_7`，张数和金额均由发票实时聚合后填入）：**
`depart_month_{n}` / `depart_day_{n}` / `depart_hour_{n}` / `depart_place_{n}` / `arrive_month_{n}` / `arrive_day_{n}` / `arrive_hour_{n}` / `arrive_place_{n}` / `transport_{n}` / `invoice_count_{n}` / `transport_fare_{n}`

**途中补贴：** `subsidy_days` / `subsidy_amount`

**其他费用（仅最后一页，张数和金额均由发票实时聚合后填入）：**
`luggage_count` / `luggage_amount` / `city_transport_count` / `city_transport_amount` / `accommodation_count` / `accommodation_amount` / `postal_count` / `postal_amount` / `no_sleeper_count` / `no_sleeper_amount` / `toll_count` / `toll_amount` / `fuel_subsidy_count` / `fuel_subsidy_amount`

**合计（仅最后一页）：**
`total_amount` / `total_amount_cn` / `advance_month` / `advance_day` / `advance_amount` / `shortfall` / `surplus`

### 8.4 金额计算公式
```
报销总金额 = 车船费合计 + 途中补贴 + 行李费 + 市内车费 + 住宿费 + 邮电费 + 不买卧铺补贴 + 过路费 + 油补

补贴天数 = 最后一条行程到达日 - 第一条行程出发日 + 1（自然天数，支持跨月、跨年）
途中补贴 = 补贴天数 × 日补贴标准

补领不足 = max(0, 报销总金额 - 预支金额)
归还多余 = max(0, 预支金额 - 报销总金额)
```

> 所有计算使用 `Decimal` 类型，最终结果 `quantize(Decimal('0.01'))` 四舍五入到两位小数。

### 8.5 中文大写转换
支持：零壹贰叁肆伍陆柒捌玖拾佰仟万亿元角分整

---

## 九、电子发票解析逻辑

### 9.1 PDF 数电发票
- 使用 PyMuPDF 打开 PDF，只处理第一页：同时提取文本，并将页面在内存中渲染为图片；渲染图片用于二维码识别和前端预览，不写入硬盘
- 优先使用 `opencv-contrib-python-headless` 提供的 `cv2.wechat_qrcode_WeChatQRCode` 识别二维码；模型文件放在 `backend/models/wechat_qrcode/`，包括 `detect.prototxt`、`detect.caffemodel`、`sr.prototxt`、`sr.caffemodel`
- Windows 路径包含中文时，OpenCV WeChatQRCode 对绝对模型路径不稳定；后端应优先传入相对模型路径，确保模型可初始化
- 如果 WeChatQRCode 不可用、模型文件缺失或识别失败，再尝试 OpenCV 标准 `QRCodeDetector`，仍失败则进入文本兜底
- 二维码内容可解析发票号码、开票日期、价税合计金额时，优先采用二维码结果
- 无二维码或二维码无法识别时，使用 PyMuPDF 提取文本并通过正则解析：
  - 发票号码：`发票号码` / `发票号` / `号码`
  - 开票日期：`开票日期`
  - 金额：优先提取 `价税合计（小写）` 或 `税价合计（小写）`
- 同时提取 `价税合计（大写）`，将中文大写金额转为 Decimal，与小写金额交叉验证；不一致时保留校验状态，仍允许用户在确认弹窗中修正金额
- FastAPI 上传成功后返回解析字段和后端刚渲染出的发票预览图 data URL；React 使用 MUI 标准组件展示该图片。历史发票或无预览图时继续使用原文件预览接口兜底
- 上传响应必须同时返回解析诊断信息：最终采用方式、识别成功状态、最终字段结果、各解析方式尝试结果，用于前端“解析依据”弹窗核对；历史发票缺少诊断信息时，前端通过只读重解析接口即时获取

### 9.2 不再支持 XML / OFD
XML / OFD 发票上传时直接返回不支持提示，不再维护解析逻辑。

### 9.3 图片发票
第一代：用户手动输入金额，`amount_confirmed = false` 直到用户点击确认。
第二代：接入 OCR API 自动识别。

---

## 十、文件存储规范

- 发票文件按报销单分目录存储：`uploads/{report_id}/{expense_category}_invoice_{uuid}.{ext}`，例如 `uploads/1/transport_fare_invoice_xxx.pdf`
- 删除策略采用**软删除优先**：删除发票或报销单时，先标记数据库记录为已删除（`deleted_at` 时间戳），物理文件保留；用户确认或超过保留期（30天）后再物理删除，避免误删发票图片无法找回
- 删除报销单时，**同步软删除该报销单下所有发票记录**

---

## 十一、测试规范

测试文件放在 `tests/` 目录，每个 Phase 完成后执行对应测试。

**必须覆盖的测试项：**

| 模块 | 测试点 |
|------|--------|
| 金额转中文大写 | 整数、小数、零元整、万元以上、亿元以上 |
| 补贴天数计算 | 同月、跨月、跨年、单天 |
| 发票解析 | PDF 二维码优先、PDF 文本提取、价税合计大小写金额交叉验证 |
| 状态机流转 | 合法转换全覆盖、非法转换应抛出异常 |
| 金额计算 | Decimal 精度验证，禁止 float 误差 |

---

## 十二、开发阶段规划

> **AI Agent 执行规则：**
> 1. 严格按 Phase 顺序执行，禁止跨 Phase 开发
> 2. 每个 Phase 开始前，输出本阶段**变更文件列表**
> 3. 每个 Phase 完成后，执行对应测试，输出**验收结果**（已完成 / 未完成 / 待确认）
> 4. 输出验收结果后**必须停止**，等待用户确认再继续
> 5. 已确认的 API 路径、数据库结构禁止修改
> 6. 禁止引入文档未列出的第三方框架
> 7. 后端保持 Router → Service → Database 分层，禁止新增 Repository 层
> 8. 前端必须使用 MUI v5，禁止替换为 Ant Design 或其他 UI 组件库
> 9. 前端所有页面必须做宽屏适配：主内容限宽居中、保留外侧 gutter，卡片和表单控件不得随窗口无限拉伸；宽屏下必须检查卡片边框、内边距、列间距和标题/控件对齐是否统一

---

### 当前进度快照（2026-06-04）

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 1 | 已完成 | 前后端基础、数据库、健康检查已具备 |
| Phase 2 | 已完成 | 报销单 CRUD、状态机、列表基础能力已具备 |
| Phase 3 | 已验收通过 | 报销单录入界面已通过用户验收；行程、费用、发票上传、金额确认、实时汇总、重复发票拦截、PDF 图片预览和解析依据已完成 |
| Phase 4 | 待开始 | PDF 模板填充、中文大写金额、生成下载接口待开发 |
| Phase 5 | 待开始 | 统计看板接口和页面待开发 |
| Phase 6 | 待开始 | 前端静态集成、自动打开浏览器、PyInstaller 打包和端到端验证待开发 |

Phase 3 当前验证基线：
- 后端：`python -m pytest`，31 passed
- 前端构建：`npm run build`，通过；Vite chunk size 警告不影响功能
- 前端工具函数：`node --test frontend/src/pages/reportEditUtils.test.js`，4 passed
- WeChatQRCode：四个模型文件放在 `backend/models/wechat_qrcode/` 后可初始化；PDF 发票优先二维码识别，失败后文本正则兜底
- 发票预览：金额确认弹窗和查看发票弹窗都默认展示图片预览；上传过程本身不做 PDF iframe 预览

---

### Phase 1：项目初始化
**验收标准：前后端均可启动，数据库自动创建，API 联通正常**

- [ ] 初始化 React + Vite + MUI 前端项目
- [ ] 初始化 FastAPI 后端，建立分层目录结构
- [ ] 配置 SQLite + SQLAlchemy，自动创建全部数据表
- [ ] 实现 `schemas/common.py` 统一响应格式
- [ ] 配置 CORS
- [ ] 前端配置 Axios，指向 `http://localhost:8000`
- [ ] 编写健康检查接口 `GET /api/health`，前端调用验证联通

---

### Phase 2：报销单 CRUD + 列表页
**验收标准：可新增、编辑、删除报销单，列表页正常展示和分页**

- [ ] `GET/PUT /api/settings` 接口 + Service
- [ ] 报销单全部 CRUD 接口 + Service（含状态机校验）
- [ ] 报销单列表页（ReportList），含状态 Tab 筛选
- [ ] 新增/编辑报销单 Step 1（基本信息）
- [ ] 单元测试：状态机合法/非法转换

---

### Phase 3：行程录入 + 发票上传（前端重做）
**验收标准：进入新增页即创建草稿，单页完成基础信息、行程、PDF 发票上传、金额确认和实时汇总；PDF 优先通过二维码和文本提取识别金额，图片发票可手动输入金额**

> Phase 3 已有后端基础能力，但前端未还原原型。重做时优先完成前端工作台，再补后端文件名小改和 PDF 发票识别增强。

**Phase 3A：前端工作台（当前优先）**
- [ ] App 壳层从顶部 AppBar 改为 Sidebar + 主内容区，保留 `/`、`/reports`、`/reports/new`、`/reports/:id/edit` 路由
- [ ] `/reports/new` 页面加载后自动创建 draft，并 `replace` 到 `/reports/{id}/edit`
- [ ] `ReportEdit` 重写为单页录入工作台：基础信息、行程列表、其他费用、右侧 sticky 汇总同屏展示
- [ ] `ReportEdit` 宽屏布局必须有明确最大宽度；基本信息保持整行卡片，行程卡片和其他费用卡片桌面 2 列排列，单张行程卡内部按字段长度紧凑排布
- [ ] 编辑页卡片统一使用一致的边框、圆角、内边距和区块间距；中等宽度不得因为右侧汇总栏挤压导致行程/费用卡片内容拥挤或错位
- [ ] 基础信息、预支信息、行程自动保存，并显示保存状态
- [ ] 空草稿离开时弹窗确认删除、保留或取消；未确认删除的草稿一律保留
- [ ] 行程卡支持新增、删除、拖拽排序、复制、折叠摘要、交换出发/到达、生成返程
- [ ] 交通工具字段提供可选项：飞机、高铁/动车、网约车、自驾，同时允许用户自由输入特殊交通工具
- [ ] 车船费和其他费用均支持卡片内上传、multiple 批量上传、拖放上传和上传状态显示
- [ ] 同一报销单内重复上传相同发票文件，或解析出已存在的相同发票号时，必须拦截并提示用户删除重复发票后再上传
- [ ] 发票上传后进入 InvoiceViewer 确认金额；批量上传按队列逐张确认
- [ ] `reimbursed` 状态下所有编辑、上传、删除、金额确认操作均禁用
- [ ] 前端工具函数测试覆盖空草稿判断、payload 生成、行程操作、实时汇总

**Phase 3B：后端和回归补齐**
- [ ] 保留现有发票上传接口和报销单更新接口，不新增改类别 API
- [ ] `backend/services/invoice_service.py` 保存文件名改为 `{expense_category}_invoice_{uuid}.{ext}`
- [ ] 放弃 XML / OFD 发票上传和解析支持，上传时返回清晰提示
- [ ] PDF 识别使用 PyMuPDF 内存渲染第一页图片，优先通过 OpenCV WeChatQRCode 识别二维码，并将同一张渲染图片随上传响应返回给前端预览
- [ ] 二维码不可用时使用 PyMuPDF 文本提取 + 正则提取发票号、开票日期、价税合计小写金额
- [ ] PDF 识别提取价税合计大写金额，与小写金额做交叉验证

---

### Phase 4：PDF 生成
**验收标准：生成 PDF 可下载，多页分割正确，所有金额精确到两位小数，中文大写正确**

- [ ] `amount_converter.py`：金额转中文大写，含单元测试
- [ ] `pdf_generator.py`：PDF 模板填充，多页逻辑
- [ ] `GET /api/reports/{id}/pdf` 接口
- [ ] 前端「生成PDF」按钮 + 浏览器下载触发
- [ ] 单元测试：中文大写转换全场景，Decimal 精度验证

---

### Phase 5：统计看板
**验收标准：看板数据正确，图表渲染正常，出差日历标注准确**

- [ ] `GET /api/stats/summary` 接口
- [ ] `GET /api/stats/category` 接口
- [ ] `GET /api/stats/calendar` 接口
- [ ] Dashboard 页面：统计卡片 + 费用分布饼图 + 月度趋势折线图 + 出差日历视图

---

### Phase 6：收尾 + 打包
**验收标准：EXE 可双击启动，自动打开浏览器，完整流程端到端测试通过**

- [ ] 前端生产构建（`npm run build`）
- [ ] FastAPI 集成前端静态文件（Vite build 输出目录）
- [ ] FastAPI 启动时自动打开浏览器
- [ ] PyInstaller `--onedir` 打包
- [ ] 端到端测试：新增 → 行程录入 → 发票上传 → 生成PDF → 状态流转 → 看板统计

---

## 十三、重要业务规则

1. **状态限制**：`reimbursed` 状态完全锁定，所有写操作返回 403
2. **删除限制**：只有 `draft` 状态的报销单可以删除
3. **金额精度**：全链路使用 `Decimal(18,2)`，禁止 `float`；前端显示和 PDF 输出保留两位小数
4. **发票确认**：所有新上传发票初始必须为 `amount_confirmed = false`，即使已自动解析出金额也必须等待用户确认；`amount_confirmed = false` 的发票不计入汇总金额
5. **重复发票拦截**：同一报销单内相同发票文件或相同发票号不得重复入库；系统应提示删除重复发票后再上传
6. **交通工具录入**：交通工具提供常用选项，同时允许用户自由填写特殊交通工具
7. **补贴天数**：取所有行程最早出发日与最晚到达日，计算自然天数差 + 1，需正确处理跨月、跨年
8. **部门/出差人记忆**：新增报销单时自动从 `settings` 读取上次值填入
9. **PDF 模板缺失**：模板文件不存在时，接口返回清晰错误信息（非 500）
10. **文件删除联动**：删除发票或报销单时，软删除记录（设置 `deleted_at`），物理文件保留 30 天后清理

---

## 十四、待确认事项（开发前需用户提供）

- [ ] **PDF 模板文件**：将 `expense_template.pdf` 放入 `backend/templates/` 目录
- [ ] **PDF 域名称确认**：运行以下脚本打印模板中实际字段名，与第八章映射表核对：
  ```python
  import pypdf
  reader = pypdf.PdfReader("backend/templates/expense_template.pdf")
  fields = reader.get_fields()
  for name, field in fields.items():
      print(f"字段名: {name}, 类型: {field.get('/FT')}")
  ```
- [ ] **日补贴金额**：确认公司标准日补贴金额（元/天），初始化时写入 `settings` 表

---

\expense-tool-prototype-v1.1.jsx 是原型，基本满足UI交互要求了。

> 改进备忘
> 1. 其他费用，目前是固定的7类，做成用户自己可以增加类别，比如宴请。没有发票的类别可以在输出PDF时隐藏。
> 2. 导出PDF时，除了报销单，将发票也按A5横向尺寸一并导出。
> 


*文档版本：v2.0 | 最后更新：2026-05-31*
