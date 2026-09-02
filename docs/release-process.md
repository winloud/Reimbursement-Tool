# 发布流程

本文档记录正式发布的快速路径。GitHub Actions 和 GitHub Release 是公开发布状态的权威来源；仓库中的计划文档记录开发内容、冻结状态和必要的人工验证，不重复保存可从 GitHub 查询的机器状态。

## 核心约束

- 正式版本只从已合并并推送的 `main` 发布。
- `docs/releases/active-plan.md` 必须在创建正式 tag 前冻结，冻结计划状态统一为“内容已冻结”。
- 已推送的正式 `vX.Y.Z` tag 永不移动、删除或 force-push。
- 发布失败保留 release commit 和 tag，从同一 tag 续跑；源码需要修改时发布新的 patch 版本。
- 正常发布成功后不再自动修改文档或进行第二次 push。重要安装、升级、数据迁移等人工验证可按需作为普通 docs commit 补充。

## 双 Target 构建入口

- ZIP：`scripts/build_release.ps1`、`scripts/validate_zip_release.ps1`、`scripts/release_publish_zip.ps1`，远端任务为手动触发的 `Publish ZIP Release`。
- Tauri：`scripts/build_tauri_release.ps1`、`scripts/validate_tauri_release.ps1`、`scripts/release_publish.ps1`，远端任务为 `Publish Release`。
- 本地正式构建统一从 `scripts/build_target.ps1` 进入；两条内部构建器与 validator 保持独立。
- 两条链共享同一个版本、发布日期和 Git commit，运行数据、桌面壳、更新器及构建输出保持隔离。

```powershell
# Tauri 正式构建还必须先配置下文的签名私钥与密码。
powershell -File scripts\build_target.ps1 -Target Zip -Version 2.0.0 -ReleaseDate 20260902
powershell -File scripts\build_target.ps1 -Target Tauri -Version 2.0.0 -ReleaseDate 20260902
powershell -File scripts\build_target.ps1 -Target All -Version 2.0.0 -ReleaseDate 20260902
```

统一入口参数语义：

- `-Target Zip|Tauri|All`：选择构建目标；`All` 在同一 HEAD 依次执行两条链。
- `-Version X.Y.Z`：必填，传给两条构建器和 validator。
- `-ReleaseDate yyyymmdd`：可选，缺省为当天；两种产物使用同一日期。
- `-BuildOrder ZipFirst|TauriFirst`：只影响 `All` 的执行顺序，默认 `ZipFirst`，不改变产物内容。
- `-OutputRoot <path>`：可选，默认仓库 `artifacts`；所有目标和中间目录都隔离在该根下。
- `-PlanOnly`：只输出解析后的目标、顺序、版本、日期、commit 和输出根，不构建或删除产物。

`build_target.ps1` 是正式构建入口，不是 preview 模式。ZIP preview 继续使用 `build_release.ps1 -PreviewBuild`；Tauri 的无签名直接构建只用于本地安装或流水线验证，不能作为正式 release。

最终产物分别写入 `artifacts/zip`、`artifacts/tauri/online`、`artifacts/tauri/offline` 和
`artifacts/tauri/updater`；临时 PyInstaller 输出位于 `artifacts/.build`。正式入口拒绝 tracked
文件有修改的 worktree，并在构建后调用对应 Target validator。ZIP preview 仍使用下方原入口，
不会生成或触发 Tauri updater feed。

ZIP 本地预览示例：

```powershell
powershell -File scripts\build_release.ps1 -PreviewBuild -Version 1.4.2 -PreviewSerial 001 -ReleaseDate 20260901
# 正式 X.Y.Z 本地包使用 validate_zip_release.ps1 校验；预览包由 build_release.ps1 内置结构及测试检查。
```

## Tauri NSIS Target

Tauri 桌面发行使用 NSIS 安装包 + GitHub Releases updater feed（见 ADR 0011），与便携 ZIP Target 并行。底层构建脚本为 `scripts/build_tauri_release.ps1`：

```powershell
# 本地无签名构建（仅安装/流水线验证，不是正式 release）
powershell -File scripts\build_tauri_release.ps1 -Version 2.0.0 -ReleaseDate yyyymmdd

# 正式构建通过统一入口，私钥/密码由受控环境变量注入
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "path\to\.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
powershell -File scripts\build_target.ps1 -Target Tauri -Version 2.0.0 -ReleaseDate yyyymmdd
```

流程：前端构建 → PyInstaller onedir（`reimbursement_sidecar.spec`）→ 复制到 `src-tauri/resources/reimbursement-sidecar` → `cargo tauri build` 产出 NSIS → `tauri signer sign` 签名更新包 → `generate_updater_feed.ps1` 产出 `latest.json` + `data-compat.json`。

更新包与 feed 上传到 GitHub Release（tag 对应），`tauri.conf.json` 的 `plugins.updater.endpoints` 指向正式 `latest.json`，客户端自动验签安装。生产私钥必须与应用内公钥匹配，保存在 CI secret 或受控构建环境中，绝不写入仓库。缺少生产签名私钥时，统一正式入口和正式发布 workflow 都必须明确失败，不允许降级为未签名正式发布。

### updater 签名密钥

**这对密钥一旦随 v2.0.0 发布就不能再换**：客户端用安装包里内嵌的公钥验签，换了公钥会让所有
老版本拒绝后续更新包，只能让用户手动重装。首次发布前务必确认私钥已妥善保存。

生成（只做一次，在本机终端执行，密码自己想一个并记牢）：

```powershell
cd src-tauri
cargo tauri signer generate -w "$env:USERPROFILE\.tauri\reimbursement.key"
```

产物两个文件：

- `%USERPROFILE%\.tauri\reimbursement.key` —— **私钥，绝不入仓库、不发聊天、不进云同步**
- `%USERPROFILE%\.tauri\reimbursement.key.pub` —— 公钥

把公钥文件的**全部内容**（它本身已经是一串 base64）填进 `src-tauri/tauri.conf.json` 的
`plugins.updater.pubkey`，然后提交。

保存要求（三处缺一不可，丢任意两处就再也签不出更新包）：

1. 私钥文件离线备份（U 盘或密码管理器附件），和密码分开存放。
2. 密码存进密码管理器。
3. GitHub 仓库 Settings → Secrets and variables → Actions 添加两条：
   - `TAURI_SIGNING_PRIVATE_KEY`：私钥文件内容的 base64
     （`[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.tauri\reimbursement.key"))`）
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：上面那个密码

测试私钥只能用于构建、签名和 feed 工具链验证，不能签署正式产物。正式发布必须使用与 `tauri.conf.json` 内公钥匹配的生产私钥。本地构建正式包时通过环境变量注入，脚本不持有私钥：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\reimbursement.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "你的密码"
powershell -File scripts\build_target.ps1 -Target Tauri -Version X.Y.Z -ReleaseDate yyyymmdd
```

直接运行底层 `build_tauri_release.ps1` 时，未设私钥可生成仅供本地安装验证的无签名包；正式入口会传入 `-RequireSignature`，缺少或无法使用私钥即失败，不存在测试密钥或未签名 fallback。

便携 ZIP 流程继续保留 `build_release.ps1`、`upgrade_zip_release.ps1`、`versions/` 和 `portable-release.json`；其校验入口为 `validate_zip_release.ps1`。Tauri 的 `validate_release_asset.ps1` 继续校验已发布 Release 上的 NSIS、更新签名和 updater feed。OpenCV 可选运行时包由独立脚本 `scripts/build_opencv_runtime.ps1` 构建。

## 当前计划生命周期

- `docs/releases/active-plan.md` 只保留当前目标、范围、验收条件和阻塞，不累计完成流水、历史测试次数、预览包哈希或 CHANGELOG 内容副本。
- 当前开发版本、计划状态和预计版本类型只在 `active-plan.md` 维护；其他文档只链接该文件，不复制当前值。
- 面向用户的完成结果写入 `CHANGELOG.md`；长期有价值的人工验证或技术路线分别写入 `docs/testing/` 和 `docs/decisions/`。
- 正式发布准备会把当前计划冻结为版本计划，并由 `scripts/release_publish.ps1` 重建同样的精简模板。
- 正式版本号只向发布总控传入一次；脚本负责同步源码和文档中的必要版本镜像，并在发布前校验一致性。

## 标准发布顺序

1. 在开发分支完成开发、测试和文档记录。
2. 将开发分支合并到 `main`，推送并确认 `origin/main` 包含本次源码。
3. 在最新 `main` 上运行发布总控的准备模式，检查版本文件和预检结果。
4. 检查准备模式产生的 diff；确认后运行同一脚本的 `-Publish` 模式。
5. 脚本创建或识别 release commit/tag，推送必要状态，等待或续跑 workflow，并校验 GitHub Release。

```powershell
git checkout main
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_publish.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd
git diff
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_publish.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -Publish
```

准备模式可重复运行，不创建 commit 或 tag。正式发布只需要一次 `-Publish` 调用；如果进程中断，再次运行相同命令会根据已有 release commit、本地/远端 tag、workflow 和 Release 状态继续执行。

## 发布总控接口

- `-Version X.Y.Z`：必填，正式版本号。
- `-ReleaseDate yyyymmdd`：可选；未传时按中国时区当天生成。日期必须与 `CHANGELOG.md` 对应版本标题一致。
- `-VersionType patch|minor|major|TBD`：可选，默认 `patch`，写入冻结发布计划。
- 不带 `-Publish`：准备版本文件、冻结 active plan、创建下一轮 active plan 并运行预检；不提交、不创建 tag、不 push。
- `-Publish`：从当前状态安全续跑，直至 workflow 和 GitHub Release 校验完成。
- `-AllowUntracked`：可选；只忽略未跟踪文件，已跟踪文件变更仍按发布状态规则检查。
- `-DownloadReleaseAssetForValidation`：可选；默认不下载 NSIS 安装包，只下载小型 `release-manifest.json`、`SHA256SUMS.txt`、`latest.json` 和 `data-compat.json` 做完整性校验；需要模拟最终用户下载时再启用远端安装包深校验。
- `-ReleaseBranch main`：可选，默认 `main`；仅在仓库正式发布分支更名时调整。
- `-SkipTests`：只用于临时烟测或测试已由其他可信流程完成的场景；正式发布默认不使用。

`-RepublishExistingTag` 和总控脚本中的 `-CompareRunId` 已移除：正式 tag 不允许重定向；耗时比较继续使用独立 metrics 工具。

## 状态识别与续跑

发布总控按以下状态处理：

- 尚未准备：更新版本元数据、冻结 CHANGELOG 和版本计划，重建 active plan，运行预检。
- 已准备但未提交：复用现有准备结果并完成预检；`-Publish` 时创建 release commit。
- 已有 release commit 或本地 tag：验证 tag 与预期 commit 一致后继续，不重复创建。
- 已有远端 tag：验证远端 tag SHA 与本地发布 commit 一致；不一致立即停止，不做 force-push。
- workflow 运行中：等待现有 run，不重复触发。
- workflow 失败或未找到：先把 workflow 修复提交并推送到 `main`，再由当前 `main` 上的 workflow 定义通过 `workflow_dispatch` 检出同一不可变 tag 重跑。
- GitHub Release 已成功：验证 Release notes、资产、manifest 和 checksum 后直接返回成功。

失败时不执行 `reset --hard`、自动删除 tag 或其他破坏性回滚。修复仅涉及 workflow 时从原 tag 重跑；修复涉及源码时更新 `CHANGELOG.md` 并发布新的 patch 版本。

## GitHub Release 工作流

`Publish Release` 支持两种入口：

- 推送严格匹配 `vX.Y.Z` 的 tag。
- 手工触发并传入既有 `tag`，用于从原 tag commit 重建或修复 Release 资产。

工作流必须确认 tag commit 属于 `origin/main`，从 `CHANGELOG.md` 对应版本标题读取发布日期，并为同一 tag 设置并发锁和超时。新 Release 先作为 draft 创建；测试、桌面壳检查、NSIS 构建、本地产物校验、`release-manifest.json` 和 `SHA256SUMS.txt` 全部成功后再公开。重跑已有 Release 只覆盖本次目标资产，不删除额外资产。

OpenCV runtime 可以复用旧 Release 的同版本资产，但复用前必须校验下载文件的 SHA256 和 ZIP 内容；校验失败时重新构建，不能只依赖文件名和非零大小。

## 独立验证工具

合并与发布前固定运行：

- `scripts/verify.ps1 -Profile All`：后端 pytest、前端测试与生产构建、Tauri 配置/权限静态检查、Rust 单测与 clippy，以及 release 静态检查。
- `scripts/verify.ps1 -Profile Release`：release 工具 pytest 与发布脚本/workflow 静态契约；它不生成大型 ZIP 或 NSIS 产物。

发布治理脚本和状态机可先用固定档位定向验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify.ps1 -Profile Release
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify.ps1 -Profile Desktop
```

发布后按需复验 Release 资产；`-MetadataOnly` 不下载 NSIS 安装包，但会下载 manifest、checksum 和 updater feed 四个小型完整性资产：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_release_asset.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -MetadataOnly
```

校验本地 NSIS 构建产物与 feed：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_tauri_release.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd
```

需要模拟用户从 GitHub 下载安装包时，省略 `-MetadataOnly` 进行远端深校验。耗时采集和比较保持为独立命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\collect_release_metrics.ps1 -RunId <run-id> -CompareRunId <baseline-run-id> -Format Markdown
```

这些结果默认只在终端或 GitHub 中查看；只有能长期帮助安装、升级或迁移判断的人工验证才写回文档。

## 手工发布路径

发布总控不可用时：

1. 将 `Unreleased` 内容冻结到 `## vX.Y.Z - YYYY-MM-DD`。
2. 更新 README、后端和前端版本元数据。
3. 将 active plan 冻结为 `vX.Y.Z-plan.md`，状态写“内容已冻结”，并创建下一轮 active plan。
4. 运行 `scripts/prepare_release.ps1` 和必要测试。
5. 提交 release commit。
6. 仅在确认 release commit 已位于并推送到 `main` 后，创建一次 annotated tag 并推送。
7. 等待 tag workflow，或用 workflow 的手工 `tag` 输入从同一 tag 续跑。

```powershell
git add CHANGELOG.md README.md backend/app_metadata.py frontend/package.json frontend/package-lock.json docs
git commit -m "chore(release): publish vX.Y.Z"
git push origin main
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

如果 tag 已存在，必须先验证其 SHA；不要移动或覆盖。Release 成功后无需再补一次机器状态提交。

## 本地正式安装包

GitHub tag workflow 的资产是正式交付物。本地只有在验证本机 sidecar 打包、NSIS 安装行为、updater 升级路径或 GitHub Actions 暂不可用时才生成正式安装包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_tauri_release.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd
```

本地产物留在 `src-tauri\target\release\bundle\nsis` 和 `dist-feed\`，不提交 Git。
