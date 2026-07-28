from __future__ import annotations

import shutil
import subprocess
import os
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "release_publish.ps1"
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")


def run(
    command: list[str],
    cwd: Path,
    *,
    check: bool = True,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def create_release_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "scripts").mkdir(parents=True, exist_ok=True)
    (repo / "scripts" / "release_publish.ps1").write_bytes(SCRIPT.read_bytes())
    write(
        repo / "scripts" / "prepare_release.ps1",
        "param([string]$Version,[string]$ReleaseDate,[switch]$SkipTests,[switch]$RunFrontendBuild)\n",
    )
    write(
        repo / "scripts" / "validate_release_asset.ps1",
        """param([string]$Version,[string]$ReleaseDate,[string]$OutputJson,[string]$ExpectedCommit,[switch]$MetadataOnly,[switch]$DownloadReleaseAssetForValidation)
@{ release_url = "https://example.invalid/releases/tag/v$Version" } | ConvertTo-Json | Set-Content -LiteralPath $OutputJson -Encoding UTF8
""",
    )
    write(
        repo / "scripts" / "collect_release_metrics.ps1",
        """param([long]$RunId,[string]$OutputJson,[string]$OutputMarkdown)
@{ url = "https://example.invalid/actions/runs/$RunId"; duration_seconds = 1 } | ConvertTo-Json | Set-Content -LiteralPath $OutputJson -Encoding UTF8
"ok" | Set-Content -LiteralPath $OutputMarkdown -Encoding UTF8
""",
    )
    write(
        repo / "CHANGELOG.md",
        """# 更新日志

## Unreleased

### Changed

- 改进发布治理。

## v1.2.4 - 2026-07-13

- 历史版本。
""",
    )
    write(
        repo / "README.md",
        """# 报销管理 V1.2.4 发布说明

发布日期：2026-07-13

报销管理 V1.2.4 是测试版本。

报销管理-v1.2.4-20260713.zip
V1.2.4 使用便携式安装根目录
versions\\1.2.4\\
从旧版 ZIP 迁移到 V1.2.4 时
解压 V1.2.4 ZIP
V1.2.4 主包默认不包含兼容运行时。
""",
    )
    write(repo / "backend" / "app_metadata.py", 'DEFAULT_APP_VERSION = "1.2.4"\n')
    write(repo / "frontend" / "package.json", '{"name":"demo","version":"1.2.4"}\n')
    write(
        repo / "frontend" / "package-lock.json",
        '{"name":"demo","version":"1.2.4","lockfileVersion":3,"packages":{"":{"version":"1.2.4"}}}\n',
    )
    write(
        repo / "docs" / "README.md",
        "# 文档\n\n- 当前源码版本：v1.2.4\n- 公开稳定版本：[GitHub Releases](https://example.invalid/releases/latest)\n- 当前开发状态：[releases/active-plan.md](releases/active-plan.md)\n",
    )
    write(
        repo / "docs" / "releases" / "active-plan.md",
        """# 当前开发计划

> 只记录当前目标、范围、验收条件和阻塞。

## 状态
- 版本号：TBD
- 计划状态：规划中
- 预计版本类型：TBD

## 目标
- [x] 改进发布流程。

## 范围

- 本轮包含：改进发布流程。
- 本轮不包含：远端部署。

## 验收条件
- [x] 发布预检通过。

## 阻塞
- 无。
""",
    )

    run(["git", "init", "-b", "main"], repo)
    run(["git", "config", "user.name", "Release Test"], repo)
    run(["git", "config", "user.email", "release-test@example.invalid"], repo)
    run(["git", "add", "."], repo)
    run(["git", "commit", "-m", "initial"], repo)
    return repo


def invoke_release(
    repo: Path,
    *extra: str,
    check: bool = True,
    env: dict[str, str] | None = None,
    version: str = "1.3.0",
) -> subprocess.CompletedProcess[str]:
    if POWERSHELL is None:
        pytest.skip("PowerShell is required for release state-machine tests")
    return run(
        [
            POWERSHELL,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(repo / "scripts" / "release_publish.ps1"),
            "-Version",
            version,
            "-ReleaseDate",
            "20260714",
            "-SkipTests",
            *extra,
        ],
        repo,
        check=check,
        env=env,
    )


def create_gh_stub(tmp_path: Path, repo: Path) -> tuple[dict[str, str], Path]:
    stub_dir = tmp_path / "gh-stub"
    stub_dir.mkdir()
    state_path = stub_dir / "state.txt"
    state_path.write_text("success", encoding="utf-8")
    write(
        stub_dir / "gh_stub.py",
        """import json
import os
import subprocess
import sys
from pathlib import Path

args = sys.argv[1:]
state_path = Path(os.environ["GH_STUB_STATE"])
state = state_path.read_text(encoding="utf-8").strip()
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()

if args[:2] == ["run", "list"]:
    conclusion = "failure" if state == "failure" else "success"
    print(json.dumps([
        {
            "databaseId": 42,
            "displayTitle": "Publish Release v1.3.0",
            "headBranch": "v1.3.0",
            "headSha": commit,
            "event": "push",
            "status": "completed",
            "conclusion": conclusion,
            "url": "https://example.invalid/actions/runs/42",
            "createdAt": "2099-01-01T00:00:00Z",
        },
        {
            "databaseId": 99,
            "displayTitle": "Publish Release v9.9.9",
            "headBranch": "main",
            "headSha": commit,
            "event": "workflow_dispatch",
            "status": "completed",
            "conclusion": "success",
            "url": "https://example.invalid/actions/runs/99",
            "createdAt": "2100-01-01T00:00:00Z",
        },
    ]))
elif args[:2] == ["run", "rerun"]:
    state_path.write_text("success", encoding="utf-8")
elif args[:2] == ["run", "watch"]:
    sys.exit(0)
elif args[:2] == ["workflow", "run"]:
    state_path.write_text("success", encoding="utf-8")
else:
    sys.exit(0)
""",
    )
    write(stub_dir / "gh.cmd", '@python "%~dp0gh_stub.py" %*\n')
    env = os.environ.copy()
    env["PATH"] = str(stub_dir) + os.pathsep + env["PATH"]
    env["GH_STUB_STATE"] = str(state_path)
    return env, state_path


def test_prepare_is_idempotent_and_creates_no_commit_or_tag(tmp_path: Path):
    repo = create_release_repo(tmp_path)

    first = invoke_release(repo)
    first_diff = run(["git", "diff", "--binary"], repo).stdout
    second = invoke_release(repo)
    second_diff = run(["git", "diff", "--binary"], repo).stdout

    assert "without creating a commit or tag" in first.stdout
    assert "without creating a commit or tag" in second.stdout
    assert first_diff == second_diff
    assert run(["git", "rev-list", "--count", "HEAD"], repo).stdout.strip() == "1"
    assert run(["git", "tag", "--list"], repo).stdout.strip() == ""
    frozen = (repo / "docs" / "releases" / "v1.3.0-plan.md").read_text(encoding="utf-8")
    assert "- 计划状态：内容已冻结" in frozen
    active = (repo / "docs" / "releases" / "active-plan.md").read_text(encoding="utf-8")
    assert "## 验收条件" in active
    assert "## 阻塞" in active
    assert "## 完成记录" not in active
    assert "已同步到 CHANGELOG" not in active
    docs_readme = (repo / "docs" / "README.md").read_text(encoding="utf-8")
    assert "- 当前源码版本：v1.3.0" in docs_readme


def test_publish_refuses_existing_tag_before_creating_release_commit(tmp_path: Path):
    repo = create_release_repo(tmp_path)
    remote = tmp_path / "origin.git"
    run(["git", "init", "--bare", str(remote)], tmp_path)
    run(["git", "remote", "add", "origin", str(remote)], repo)
    run(["git", "push", "-u", "origin", "main"], repo)
    run(["git", "tag", "-a", "v1.3.0", "-m", "conflicting tag"], repo)
    run(["git", "push", "origin", "v1.3.0"], repo)
    run(["git", "tag", "-d", "v1.3.0"], repo)

    invoke_release(repo)
    result = invoke_release(repo, "-Publish", check=False)

    assert result.returncode != 0
    assert "immutable version" in (result.stdout + result.stderr)
    assert run(["git", "rev-list", "--count", "HEAD"], repo).stdout.strip() == "1"
    assert run(["git", "tag", "--list"], repo).stdout.strip() == ""


def test_publish_creates_one_release_commit_and_is_idempotent(tmp_path: Path):
    repo = create_release_repo(tmp_path)
    remote = tmp_path / "origin.git"
    run(["git", "init", "--bare", str(remote)], tmp_path)
    run(["git", "remote", "add", "origin", str(remote)], repo)
    run(["git", "push", "-u", "origin", "main"], repo)
    env, _ = create_gh_stub(tmp_path, repo)

    first = invoke_release(repo, "-Publish", env=env)
    head = run(["git", "rev-parse", "HEAD"], repo).stdout.strip()
    tag = run(["git", "rev-list", "-n", "1", "v1.3.0"], repo).stdout.strip()
    remote_tag = run(["git", "ls-remote", str(remote), "refs/tags/v1.3.0^{}"], repo).stdout.split()[0]

    assert "without moving the tag or creating a post-release docs commit" in first.stdout
    assert "actions/runs/42" in first.stdout
    assert head == tag == remote_tag
    assert run(["git", "log", "-1", "--format=%s"], repo).stdout.strip() == "chore(release): publish v1.3.0"
    assert run(["git", "rev-list", "--count", "HEAD"], repo).stdout.strip() == "2"

    second = invoke_release(repo, "-Publish", env=env)
    assert "without moving the tag" in second.stdout
    assert run(["git", "rev-parse", "HEAD"], repo).stdout.strip() == head
    assert run(["git", "rev-list", "-n", "1", "v1.3.0"], repo).stdout.strip() == tag
    assert run(["git", "rev-list", "--count", "HEAD"], repo).stdout.strip() == "2"

    remote_main = run(["git", "rev-parse", "origin/main"], repo).stdout.strip()
    write(repo / "local-only.txt", "must not be pushed while repairing an existing release\n")
    run(["git", "add", "local-only.txt"], repo)
    run(["git", "commit", "-m", "local only"], repo)
    local_ahead = invoke_release(repo, "-Publish", env=env)
    assert "current branch will not be pushed" in local_ahead.stdout
    assert run(["git", "rev-parse", "origin/main"], repo).stdout.strip() == remote_main
    assert run(["git", "rev-parse", "HEAD"], repo).stdout.strip() != remote_main
    assert run(["git", "rev-list", "-n", "1", "v1.3.0"], repo).stdout.strip() == tag
    assert run(["git", "rev-list", "--count", "HEAD"], repo).stdout.strip() == "3"


def test_failed_workflow_is_rerun_without_moving_tag(tmp_path: Path):
    repo = create_release_repo(tmp_path)
    remote = tmp_path / "origin.git"
    run(["git", "init", "--bare", str(remote)], tmp_path)
    run(["git", "remote", "add", "origin", str(remote)], repo)
    run(["git", "push", "-u", "origin", "main"], repo)
    env, state_path = create_gh_stub(tmp_path, repo)
    state_path.write_text("failure", encoding="utf-8")
    failed = invoke_release(repo, "-Publish", env=env, check=False)
    original_tag = run(["git", "rev-list", "-n", "1", "v1.3.0"], repo).stdout.strip()
    original_head = run(["git", "rev-parse", "HEAD"], repo).stdout.strip()

    assert failed.returncode != 0
    assert "immutable tag were preserved" in (failed.stdout + failed.stderr)
    assert state_path.read_text(encoding="utf-8") == "failure"

    resumed = invoke_release(repo, "-Publish", env=env)

    assert "Dispatching the current main workflow" in resumed.stdout
    assert state_path.read_text(encoding="utf-8") == "success"
    assert run(["git", "rev-list", "-n", "1", "v1.3.0"], repo).stdout.strip() == original_tag
    assert run(["git", "rev-parse", "HEAD"], repo).stdout.strip() == original_head


def test_release_version_uses_strict_semver_before_preparation(tmp_path: Path):
    repo = create_release_repo(tmp_path)

    result = invoke_release(repo, version="01.3.0", check=False)

    assert result.returncode != 0
    assert "Version must use X.Y.Z format" in (result.stdout + result.stderr)
    assert run(["git", "status", "--porcelain"], repo).stdout.strip() == ""
    assert run(["git", "tag", "--list"], repo).stdout.strip() == ""


def test_script_contains_no_destructive_tag_or_reset_paths():
    script = SCRIPT.read_text(encoding="utf-8-sig")

    assert "RepublishExistingTag" not in script
    assert "git reset --hard" not in script
    assert "git push --delete" not in script
    assert "git push --force" not in script
    assert '"tag", "-f"' not in script
    assert "docs(release): record $TagName verification" not in script
