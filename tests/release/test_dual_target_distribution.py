from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_zip_release_entrypoints_are_parallel_to_tauri():
    zip_publish = (ROOT / "scripts" / "release_publish_zip.ps1").read_text(encoding="utf-8-sig")
    zip_validator = (ROOT / "scripts" / "validate_zip_release.ps1").read_text(encoding="utf-8-sig")

    assert "prepare_zip_release.ps1" in zip_publish
    assert "validate_zip_release.ps1" in zip_publish
    assert 'gh workflow run "Publish ZIP Release"' in zip_publish
    assert "ZipPath" in zip_validator
    assert "portable-release.json" in zip_validator


def test_zip_release_workflow_is_manual_during_pipeline_transition():
    workflow_path = ROOT / ".github" / "workflows" / "publish-zip-release.yml"
    workflow = yaml.load(workflow_path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)

    assert workflow["name"] == "Publish ZIP Release"
    assert "workflow_dispatch" in workflow["on"]
    assert "push" not in workflow["on"]
    assert workflow["jobs"]["release"]["name"] == "Build ZIP and publish GitHub Release"


def test_zip_preview_workflow_uses_a_distinct_artifact_name():
    workflow = (ROOT / ".github" / "workflows" / "build-zip-preview.yml").read_text(encoding="utf-8")

    assert "Build ZIP Preview Artifact" in workflow
    assert "reimbursement-tool-zip-v$version-$previewId" in workflow
    assert "build_release.ps1" in workflow


def test_stage2_keeps_target_specific_validators():
    assert (ROOT / "scripts" / "validate_zip_release.ps1").is_file()
    assert (ROOT / "scripts" / "validate_tauri_release.ps1").is_file()
    assert (ROOT / "scripts" / "validate_release_asset.ps1").is_file()
