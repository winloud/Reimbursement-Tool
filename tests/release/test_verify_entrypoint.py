from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_frontend_exposes_one_canonical_test_command():
    package = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))

    assert package["scripts"]["test"] == "node --test src/**/*.test.js"
    prepare_release = (ROOT / "scripts" / "prepare_release.ps1").read_text(encoding="utf-8-sig")
    assert '-ArgumentList @("test")' in prepare_release
    assert 'ArgumentList @("--test"' not in prepare_release
    assert "src/**/*.test.js" not in prepare_release
    for workflow_name in ("build-preview.yml", "publish-release.yml"):
        workflow = (ROOT / ".github" / "workflows" / workflow_name).read_text(encoding="utf-8")
        assert "run: npm test" in workflow
        assert "node --test" not in workflow


def test_verify_entrypoint_has_only_explicit_profiles():
    script = (ROOT / "scripts" / "verify.ps1").read_text(encoding="utf-8-sig")

    assert '[ValidateSet("Backend", "Frontend", "Release", "Desktop", "All")]' in script
    assert '-ArgumentList @("-m", "pytest", "-q", "tests/release")' in script
    assert '-ArgumentList @("test")' in script
    assert '-ArgumentList @("run", "build")' in script
    assert "System.Management.Automation.Language.Parser" in script
    assert '@("diff", "--check", "HEAD", "--")' in script
    assert "test_release_publish_state_machine.py" not in script
    assert "diff --name-only" not in script
    assert "status --porcelain" not in script


def test_desktop_profile_runs_rust_tests_clippy_and_config_checks():
    script = (ROOT / "scripts" / "verify.ps1").read_text(encoding="utf-8-sig")

    assert '-ArgumentList @("test", "--lib")' in script
    assert '-ArgumentList @("clippy", "--all-targets", "--", "-D", "warnings")' in script
    assert "com.winloud.reimbursementtool" in script
    assert "currentUser" in script
    assert "resources/reimbursement-sidecar" in script
    assert "plugins.updater" in script or "$config.plugins.updater" in script
    # All 档位必须包含 Desktop，避免桌面壳回归只在专档位里被发现。
    all_branch = script.split('"All" {', 1)[1]
    assert "Invoke-DesktopVerification" in all_branch


def test_powershell_scripts_with_non_ascii_carry_a_utf8_bom():
    """Windows PowerShell 5.1 把无 BOM 的 UTF-8 脚本按 ANSI 代码页解码。

    中文 Windows 上这会把脚本里的中文注释和字符串解成 GBK 乱码，轻则注释被吃掉一行，
    重则字符串常量匹配不上（例如 README 版本校验）。带非 ASCII 内容的脚本必须写 BOM。
    """
    offenders = []
    for script in sorted((ROOT / "scripts").glob("*.ps1")):
        data = script.read_bytes()
        if data.startswith(b"\xef\xbb\xbf"):
            continue
        if any(ord(ch) > 127 for ch in data.decode("utf-8")):
            offenders.append(script.name)
    assert offenders == [], f"these scripts need a UTF-8 BOM: {offenders}"


def test_current_development_state_is_not_copied_to_index_docs():
    docs_readme = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")
    product_overview = (ROOT / "docs" / "product-overview.md").read_text(encoding="utf-8")
    active_plan = (ROOT / "docs" / "releases" / "active-plan.md").read_text(encoding="utf-8")
    release_script = (ROOT / "scripts" / "release_publish.ps1").read_text(encoding="utf-8-sig")

    assert "当前开发状态：[releases/active-plan.md]" in docs_readme
    assert "当前开发版：" not in docs_readme
    assert "当前开发范围与状态：[当前开发计划]" in product_overview
    assert "当前源码版本：" not in product_overview
    assert "版本索引" not in product_overview
    assert "测试依据索引" not in product_overview
    assert "下一阶段方向" not in product_overview
    assert "expense-reimbursement-plan.md" not in release_script
    assert "product-overview.md" not in release_script
    assert "- 版本号：" in active_plan
    assert "- 计划状态：" in active_plan
    assert "- 预计版本类型：" in active_plan
