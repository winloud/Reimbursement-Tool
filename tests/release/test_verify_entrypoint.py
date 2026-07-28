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

    assert '[ValidateSet("Backend", "Frontend", "Release", "All")]' in script
    assert '-ArgumentList @("-m", "pytest", "-q", "tests/release")' in script
    assert '-ArgumentList @("test")' in script
    assert '-ArgumentList @("run", "build")' in script
    assert "System.Management.Automation.Language.Parser" in script
    assert '@("diff", "--check", "HEAD", "--")' in script
    assert "test_release_publish_state_machine.py" not in script
    assert "diff --name-only" not in script
    assert "status --porcelain" not in script


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
