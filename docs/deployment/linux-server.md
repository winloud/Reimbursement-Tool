# Linux 服务器部署说明

本文记录将当前工具作为 Linux Web 服务运行的环境要求、部署步骤和已知限制。当前 Linux 服务器部署仍属于验证路线；正式改变核心发布路线前，需要另行确认技术决策。

## 一、适用范围

适用于把源码部署到 Ubuntu Server 上，通过 `systemd` 常驻运行 FastAPI 后端，并由 Nginx 提供 HTTP 入口。

当前验证方式：

- 前端：在服务器上执行 `npm ci` 和 `npm run build`，生成 `frontend/dist/`。
- 后端：使用 Python 3.13 虚拟环境运行 `uvicorn backend.main:app`。
- 数据库：继续使用 SQLite。
- 附件：继续使用本地文件目录。
- 访问方式：Nginx 80 端口反向代理到后端 `127.0.0.1:8000`。

不适用于：

- 多用户高并发生产部署。
- 公网无认证访问。
- 替代当前 Windows PyInstaller 桌面发布路线。

## 二、环境要求

推荐环境：

- Ubuntu Server 26.04 LTS x86_64。
- CPU：2 核以上，推荐 4 核。
- 内存：4 GB 以上，推荐 8 GB。
- 磁盘：40 GB 以上，推荐 60 GB 以上。
- 网络：可访问 Ubuntu APT 源、PyPI 或 PyPI 镜像、npm registry 或 npm 镜像。
- 用户：具备 `sudo` 权限的普通用户。

需要注意：

- Ubuntu 26.04 默认 Python 是 3.14，不建议直接用于本项目后端运行。
- 服务器必须安装中文字体，否则 PDF 填充和预览可能出现中文显示异常。
- 其他费用的项目名按报销单模板规则固定使用楷体，Linux 上必须部署 `simkai.ttf`。
- 当前项目仍缺少登录认证能力，不建议直接暴露到公网。

## 三、安装系统依赖

更新系统源：

```bash
sudo apt update
sudo apt upgrade -y
```

安装基础依赖：

```bash
sudo apt install -y \
  python3 python3-venv python3-pip python3-dev \
  build-essential git curl ca-certificates unzip rsync sqlite3 \
  nginx nodejs npm fonts-noto-cjk fontconfig pkg-config
```

如果需要从源码编译带 Rust 扩展的 Python 包，可安装：

```bash
sudo apt install -y rustc cargo
```

建议配置国内镜像：

```bash
npm config set registry https://registry.npmmirror.com
mkdir -p ~/.config/pip
cat > ~/.config/pip/pip.conf <<'EOF'
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
timeout = 120
EOF
```

验证中文字体：

```bash
fc-match "Noto Sans CJK SC"
```

## 四、Python 3.13 要求

在 Ubuntu 26.04 上，不要使用系统默认 `Python 3.14` 运行后端。

原因：

- 项目当前固定依赖 `pydantic==2.10.4`。
- 该版本依赖 `pydantic-core==2.27.2`。
- `pydantic-core==2.27.2` 使用的 PyO3 版本最高支持 Python 3.13。
- 在 Python 3.14 下安装会尝试源码构建，并失败于 PyO3 版本检查。

推荐使用 `uv` 安装独立 Python 3.13：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.profile
uv python install 3.13
```

创建项目虚拟环境：

```bash
cd /opt/reimbursement-tool
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r backend/requirements.txt
```

验证后端依赖：

```bash
/opt/reimbursement-tool/.venv/bin/python - <<'PY'
import sys
import fastapi, sqlalchemy, pydantic, fitz, reportlab, zxingcpp
print(sys.version)
print("backend deps ok")
PY
```

## 五、目录结构

推荐部署目录：

```text
/opt/reimbursement-tool/
  backend/
  frontend/
  data/
    expense.db
  fonts/
    msyh.ttc
    simfang.ttf
    simhei.ttf
    simkai.ttf
    simsun.ttc
  logs/
  .venv/
```

说明：

- `/opt/reimbursement-tool`：源码和构建产物。
- `/opt/reimbursement-tool/.venv`：Python 3.13 虚拟环境。
- `/opt/reimbursement-tool/data/expense.db`：SQLite 数据库。
- `/opt/reimbursement-tool/fonts/`：服务器本地部署字体，不提交 Git。
- `/opt/reimbursement-tool/backend/uploads/`：源码运行模式下的上传附件目录。
- `/opt/reimbursement-tool/frontend/dist/`：前端生产构建产物。

当前代码在源码运行模式下，上传目录由 `backend/runtime_paths.py` 解析到 `backend/uploads/`；Windows 冻结发布模式才会使用应用根目录下的 `uploads/`。

部署源码时，优先使用 Git 追踪文件或发布源码包，不要把以下运行态目录带入部署包：

```text
data/
uploads/
logs/
release/
dist/
build/
test example/
backend/uploads/
```

## 六、部署源码

示例：在本机通过 Git 归档传到服务器。

```bash
sudo rm -rf /opt/reimbursement-tool
sudo mkdir -p /opt/reimbursement-tool
sudo chown "$USER:$USER" /opt/reimbursement-tool
```

在开发机执行：

```bash
git archive --format=tar HEAD | ssh user@server "tar -xf - -C /opt/reimbursement-tool"
```

在服务器创建运行态目录：

```bash
mkdir -p /opt/reimbursement-tool/data
mkdir -p /opt/reimbursement-tool/backend/uploads
mkdir -p /opt/reimbursement-tool/fonts
mkdir -p /opt/reimbursement-tool/logs
```

## 七、部署中文字体

Linux 服务器需要可用中文字体，否则个性化设置中的 PDF 字体列表为空，保存默认报销信息时会因为默认 `system:simsun` 不存在而返回 `PDF 填充字体不存在`。

报销单 PDF 还有一个固定规则：其他费用的项目名使用楷体，不随“PDF 填充字体”设置变化。因此 Linux 服务器除默认填充字体外，也必须提供 `simkai.ttf`。

当前支持以下稳定字体 key：

| key | 显示名 | 推荐文件 |
| --- | --- | --- |
| `system:msyh` | 微软雅黑 | `msyh.ttc` |
| `system:simsun` | 宋体 | `simsun.ttc` 或 `simsun.ttf` |
| `system:simfang` | 仿宋 | `simfang.ttf` |
| `system:simkai` | 楷体 | `simkai.ttf` |
| `system:simhei` | 黑体 | `simhei.ttf` |

字体文件可以来自已授权的 Windows 系统字体或公司统一字体资产，复制到服务器：

```bash
mkdir -p /opt/reimbursement-tool/fonts
```

从 Windows 开发机复制示例：

```powershell
scp C:\Windows\Fonts\msyh.ttc `
    C:\Windows\Fonts\simsun.ttc `
    C:\Windows\Fonts\simfang.ttf `
    C:\Windows\Fonts\simkai.ttf `
    C:\Windows\Fonts\simhei.ttf `
    user@server:/opt/reimbursement-tool/fonts/
```

不要把这些字体文件提交到 Git。代码会同时检查 Windows 系统字体、项目字体目录和 `/opt/reimbursement-tool/fonts/`。

## 八、构建前端

```bash
cd /opt/reimbursement-tool/frontend
npm ci --no-audit --no-fund
npm run build
test -f dist/index.html
```

构建成功后，FastAPI 会通过 `backend.main.mount_frontend()` 提供 `frontend/dist/` 中的前端文件。

## 九、systemd 服务

创建 `/etc/systemd/system/reimbursement-tool.service`：

```ini
[Unit]
Description=Reimbursement Tool FastAPI App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=winloud
Group=winloud
WorkingDirectory=/opt/reimbursement-tool
Environment=PYTHONUNBUFFERED=1
Environment=REIMBURSEMENT_DISTRIBUTION_TARGET=zip
ExecStart=/opt/reimbursement-tool/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

根据实际服务器用户名调整 `User=` 和 `Group=`。

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now reimbursement-tool.service
sudo systemctl status reimbursement-tool.service
```

常用运维命令：

```bash
sudo systemctl restart reimbursement-tool.service
sudo journalctl -u reimbursement-tool.service -f
```

## 十、Nginx 配置

创建 `/etc/nginx/sites-available/reimbursement-tool`：

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -sf /etc/nginx/sites-available/reimbursement-tool /etc/nginx/sites-enabled/reimbursement-tool
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 十一、验证命令

检查服务：

```bash
systemctl is-active reimbursement-tool.service
systemctl is-active nginx
```

检查 API：

```bash
curl -fsS http://127.0.0.1:8000/api/health
curl -fsS http://127.0.0.1/api/health
```

检查前端首页：

```bash
curl -fsS http://127.0.0.1/ | grep -E "<title>|/assets/"
```

检查字体列表：

```bash
curl -fsS http://127.0.0.1/api/settings/fonts
```

检查设置保存：

```bash
curl -fsS -X PUT http://127.0.0.1/api/settings \
  -H "Content-Type: application/json" \
  --data '{"department":"测试部门","employee_name":"测试人员","daily_subsidy":100,"pdf_fill_font_key":"system:simsun","double_print_vat_special_invoices":true,"invoice_qr_engine":"zxing"}'
```

检查静态资源：

```bash
asset=$(find /opt/reimbursement-tool/frontend/dist/assets -name "index-*.js" -printf "%f\n" | head -n 1)
curl -fsS -r 0-79 "http://127.0.0.1/assets/$asset"
```

检查数据库：

```bash
ls -lh /opt/reimbursement-tool/data/expense.db
```

从 Windows 或局域网其他机器验证：

```powershell
Invoke-WebRequest -Uri http://<server-ip>/api/health -UseBasicParsing
```

注意：服务器 IP 由当前网络环境分配，家里、公司或不同桥接网卡下可能不同。部署、同步、验证时必须先由用户当次确认 `<server-ip>`，不要把历史验证 IP 写入脚本或作为默认目标。

## 十二、已知问题

- Ubuntu 26.04 默认 Python 3.14 与当前 `pydantic==2.10.4` 依赖链不兼容；部署时必须使用 Python 3.13，或后续升级项目依赖并重新验证。
- 当前项目缺少用户认证和权限控制，不建议公网开放。
- 当前仍使用 SQLite；少量内部使用可以验证，多人高并发场景建议评估 PostgreSQL。
- 源码运行模式上传目录为 `backend/uploads/`，与 Windows 冻结发布模式的 `uploads/` 不完全一致。
- Linux 上需要把中文字体部署到 `/opt/reimbursement-tool/fonts/`；字体文件是服务器本地资产，不提交 Git。
- PDF 生成效果仍需结合实际报销单样本做视觉验证，尤其是宋体、黑体、微软雅黑、楷体、仿宋的填充效果。
- Nginx 配置当前只提供 HTTP；正式部署应配置 HTTPS、域名和证书。
- 当前部署流程是手工步骤；后续可沉淀为脚本或 Ansible/systemd 模板。

## 十三、2026-06-19 VMware 验证记录

验证环境：

- Ubuntu Server 26.04 LTS。
- 虚拟机 IP：当次网络环境下 DHCP 分配，记录时已省略具体地址；后续以用户当次确认的 `<server-ip>` 为准，不作为默认 server IP。
- 源码目录：`/opt/reimbursement-tool`。
- Python 运行环境：`/opt/reimbursement-tool/.venv`，Python `3.13.14`。
- 系统 Python：`3.14.4`，未用于后端运行。
- Node.js：`v22.22.1`。
- npm：`9.2.0`。
- Nginx：`1.28.3`。
- 服务器本地字体目录：`/opt/reimbursement-tool/fonts/`。

验证结果：

- 后端依赖安装和导入成功。
- `npm ci` 成功。
- `npm run build` 成功。
- `reimbursement-tool.service` 运行状态为 `active`。
- `nginx` 运行状态为 `active`。
- `http://127.0.0.1/api/health` 返回正常。
- `http://<server-ip>/api/health` 从 Windows 访问返回正常；`<server-ip>` 为当次确认地址，不写入脚本或默认配置。
- 前端首页和静态 JS 可访问。
- SQLite 数据库已创建：`/opt/reimbursement-tool/data/expense.db`。
- 字体列表返回微软雅黑、宋体、仿宋、楷体、黑体。
- 个性化设置保存成功，`pdf_fill_font_key=system:simsun`。
- 报销单 PDF 生成结果包含嵌入字体 `/AAAAAA+KaiTi`，其他费用项目名使用服务器部署的 `simkai.ttf`。
