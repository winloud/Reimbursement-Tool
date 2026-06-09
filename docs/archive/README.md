# 历史归档

本目录保存不参与 V1.0 运行、测试、打包的历史资料。

- `create_form_fields_v1_0_1.py`：早期用于给报销单 PDF 模板叠加 AcroForm 填表域的维护脚本。当前运行时代码只读取已经完成的 `backend/templates/报销单.pdf` 模板，不调用该脚本。
- `HealthCheck.jsx`：早期前端健康检查组件。当前前端入口和路由不再导入该组件，桌面启动器通过 `/api/health` 做服务就绪检查。
- `expense-tool-prototype.jsx`：早期 React 原型稿，用于保留界面与交互探索记录。当前前端源码位于 `frontend/src/`，不引用该原型文件。
- `wechat_qrcode/`：早期 OpenCV WeChatQRCode 模型文件。V1.0 主包默认使用 `zxing-cpp`，这些模型不进入主 ZIP；仅在构建可选 `opencv-wechat-runtime-opencv-<opencv_package_version>-win_amd64.zip` 兼容运行时包时复用。
