# 发票二维码识别路线对照测试

- 样本目录：`test example/`
- PDF 样本数：240
- 输入处理：PyMuPDF 渲染首页，zoom=2，RGB 图像给 zxing-cpp，BGR 图像给 OpenCV
- OpenCV 路线：WeChatQRCode 模型 + QRCodeDetector multi/single
- zxing 路线：zxing-cpp QRCode

## 汇总

- 渲染成功：240/240
- zxing-cpp 二维码解码成功：240/240 (100.00%)
- OpenCV 二维码解码成功：240/240 (100.00%)
- 二维码 payload 完全一致：240/240 (100.00%)
- 最终解析结果一致：240/240 (100.00%)
- 处理异常：0

> 最终解析结果一致仅表示两条路线在“二维码 + 同一文本兜底逻辑”下得出的发票号、日期、金额一致；不是人工标注准确率。
