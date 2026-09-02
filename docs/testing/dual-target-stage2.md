# 双 Target 阶段 2 验证边界

## 自动验证范围

- 共享后端、前端、Rust 和发布工具测试。
- ZIP 便携路径、版本推断、session-free API、更新/版本切换路由及 ZIP manifest 校验。
- Tauri sidecar health、会话令牌、AppLocalData 注入优先级、原生下载相关 Rust 测试及 Tauri 静态配置。
- ZIP 预览包构建和产物结构校验。
- 两套构建输出目录与发布校验入口互不覆盖。

## 需要保留的人工复验

阶段 2 不重复完整 Tauri A 阶段验收，但合并后仍建议人工复验：

1. Tauri 首次启动及已有 AppLocalData 启动。
2. 报销 PDF、批量 ZIP、备份和诊断包的原生保存对话框：成功、取消、覆盖同名文件。
3. 关闭窗口后 sidecar 是否被回收。
4. ZIP 根 launcher 启动、维护页上传更新 ZIP、切换版本并重启。
5. ZIP 与 Tauri 分别使用各自数据目录；如同时运行，不应操作同一个数据库。

Tauri B 阶段的签名更新、离线安装、真实迁移和回滚仍不属于阶段 2 完成依据。
