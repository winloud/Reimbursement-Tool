# 源码开发服务重启

本仓库源码开发环境重启前后端，统一使用根目录的一键脚本：

```powershell
.\restart-dev.cmd
```

脚本行为：

- 停止旧的后端 `127.0.0.1:8000` 和前端 `127.0.0.1:5174` 开发服务。
- 在同一个控制台窗口中启动后端和前端。
- 后端启动命令：`python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`
- 前端启动命令：`npm run dev -- --host 127.0.0.1 --port 5174`
- 前端会自动设置 `VITE_API_BASE_URL=http://127.0.0.1:8000`。
- 输入 `status` 可查看前后端进程状态。
- 输入 `q`、`quit`、`exit` 或 `stop` 后回车，会同时关闭前后端服务。
- 直接关闭脚本窗口，也会关闭前后端服务。
- 再次运行脚本时，会先关闭上一次遗留的控制窗口和服务。

仅检查脚本和依赖，不实际重启服务：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\restart-dev.ps1 -CheckOnly
```

后续需要重启开发服务时，不再手动分别启动 `uvicorn` 和 `vite`，直接运行 `.\restart-dev.cmd`。
