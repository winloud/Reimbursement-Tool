# ADR 0001：发票二维码识别路线

## 状态

已采纳。

## 背景

发票 PDF 解析需要稳定识别二维码 payload，并从 payload 或文本兜底中提取发票号、日期和金额。早期路线依赖 OpenCV WeChatQRCode，但这会显著增加主发布包体积，并引入 NumPy、模型文件和中文路径兼容问题。

## 决策

- 默认发票二维码识别引擎使用 `zxing-cpp`。
- `OpenCV + NumPy + WeChatQRCode` 保留为个性化设置中的可选兼容模式。
- 主发布 ZIP 默认不包含 OpenCV、NumPy、WeChatQRCode 模型。
- OpenCV 兼容模式通过 EXE 同目录本地 runtime ZIP 安装到运行目录。
- OpenCV runtime 文件名版本号取 OpenCV 包版本，不取报销工具版本。

## 依据

`test example/` 中 240 个 PDF 发票样本已做两条路线对照测试：

- zxing QR 识别成功：`240/240`
- OpenCV QR 识别成功：`240/240`
- payload 一致：`240/240`
- 最终解析结果一致：`240/240`
- 错误数：`0`

测试记录见 [../testing/invoice_qr_route_comparison_2026-06-09.md](../testing/invoice_qr_route_comparison_2026-06-09.md)。

## 后果

正向影响：

- 主发布包体积更小。
- 默认运行依赖更少。
- 发票二维码识别路线有样本回归依据。
- OpenCV 仍可作为兼容选项保留给特殊环境。

代价：

- 个性化切换到 OpenCV 时，需要用户把 runtime ZIP 放到 EXE 同级目录。
- OpenCV runtime 包需要单独构建和验证。
- 后端需要在 OpenCV 不可用时记录诊断并回退 zxing，避免解析流程中断。
