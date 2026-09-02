# 源码开发与桌面 Target 启动

后端不会猜测发行 Target。所有直接导入 `backend.main` 或运行 `uvicorn backend.main:app` 的进程都必须先显式设置 `REIMBURSEMENT_DISTRIBUTION_TARGET=zip|tauri`；缺失、空字符串和非法值都会启动失败。

## ZIP / Web 源码开发

本仓库源码开发环境重启前后端，统一使用根目录的一键脚本：

```powershell
.\restart-dev.cmd
```

脚本行为：

- 停止旧的后端 `127.0.0.1:8000` 和前端 `127.0.0.1:5174` 开发服务。
- 在同一个控制台窗口中启动后端和前端。
- 脚本为后端子进程显式注入 `REIMBURSEMENT_DISTRIBUTION_TARGET=zip`，不会依赖后端默认值。
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

需要手动运行后端时，必须在同一个 PowerShell 会话显式指定 ZIP Target：

```powershell
$env:REIMBURSEMENT_DISTRIBUTION_TARGET = "zip"
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## Tauri 源码开发

进入 `src-tauri` 后可直接启动；debug fallback 会基于 Rust 编译期的 `CARGO_MANIFEST_DIR` 自动定位仓库根目录的 `sidecar_app.py`：

```powershell
Set-Location .\src-tauri
cargo tauri dev
```

`cargo tauri dev` 会按 `tauri.conf.json` 的 `beforeDevCommand` 启动共享 Vite 前端。不要另外启动 ZIP 开发后端；Tauri 壳负责 sidecar、随机端口、session token 和 AppLocalData 初始化生命周期。

需要改用其他 Python 或 sidecar 命令时，仍可显式设置最高优先级 override：

```powershell
$env:REIMBURSEMENT_SIDECAR_CMD = "python ..\sidecar_app.py --port 0"
cargo tauri dev
```
