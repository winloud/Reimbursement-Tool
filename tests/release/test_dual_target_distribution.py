from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_zip_and_tauri_share_one_formal_release_entrypoint():
    release_publish = (ROOT / "scripts" / "release_publish.ps1").read_text(encoding="utf-8-sig")
    zip_validator = (ROOT / "scripts" / "validate_zip_release.ps1").read_text(encoding="utf-8-sig")

    assert 'gh workflow run "Publish Release"' in release_publish
    assert "validate_release_asset.ps1" in release_publish
    assert not (ROOT / "scripts" / "release_publish_zip.ps1").exists()
    assert "ZipPath" in zip_validator
    assert "portable-release.json" in zip_validator


def test_one_workflow_publishes_both_distribution_targets():
    workflow_path = ROOT / ".github" / "workflows" / "publish-release.yml"
    workflow_text = workflow_path.read_text(encoding="utf-8")
    workflow = yaml.load(workflow_text, Loader=yaml.BaseLoader)

    assert workflow["name"] == "Publish Release"
    assert workflow["jobs"]["release"]["name"] == "Build ZIP and Tauri packages, then publish GitHub Release"
    assert 'Target = "All"' in workflow_text
    assert not (ROOT / ".github" / "workflows" / "publish-zip-release.yml").exists()


def test_zip_preview_workflow_uses_a_distinct_artifact_name():
    workflow = (ROOT / ".github" / "workflows" / "build-zip-preview.yml").read_text(encoding="utf-8")

    assert "Build ZIP Preview Artifact" in workflow
    assert "reimbursement-tool-zip-v$version-$previewId" in workflow
    assert "build_release.ps1" in workflow


def test_stage2_keeps_target_specific_validators():
    assert (ROOT / "scripts" / "validate_zip_release.ps1").is_file()
    assert (ROOT / "scripts" / "validate_tauri_release.ps1").is_file()
    assert (ROOT / "scripts" / "validate_release_asset.ps1").is_file()
