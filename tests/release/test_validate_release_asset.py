from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "validate_release_asset.ps1"
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")
VERSION = "1.2.5"
TAG = f"v{VERSION}"
RELEASE_DATE = "20260713"
COMMIT = "0123456789abcdef0123456789abcdef01234567"
MAIN_NAME = f"reimbursement-tool-v{VERSION}-{RELEASE_DATE}.zip"
RUNTIME_NAME = "opencv-wechat-runtime-4.10.0.zip"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def create_gh_fixture(tmp_path: Path) -> tuple[dict[str, str], Path, Path, Path]:
    fixture_dir = tmp_path / "fixture"
    fixture_dir.mkdir(parents=True)
    main_bytes = b"main release zip placeholder"
    runtime_bytes = b"opencv runtime zip placeholder"
    (fixture_dir / MAIN_NAME).write_bytes(main_bytes)
    (fixture_dir / RUNTIME_NAME).write_bytes(runtime_bytes)

    manifest = {
        "tag": TAG,
        "commit": COMMIT,
        "release_date": "2026-07-13",
        "assets": [
            {"name": MAIN_NAME, "size": len(main_bytes), "sha256": sha256(main_bytes)},
            {"name": RUNTIME_NAME, "size": len(runtime_bytes), "sha256": sha256(runtime_bytes)},
        ],
    }
    manifest_path = fixture_dir / "release-manifest.json"
    write_json(manifest_path, manifest)
    checksums_path = fixture_dir / "SHA256SUMS.txt"
    checksums_path.write_text(
        f"{sha256(main_bytes)}  {MAIN_NAME}\n{sha256(runtime_bytes)}  {RUNTIME_NAME}\n",
        encoding="ascii",
    )

    release = {
        "url": f"https://example.invalid/releases/tag/{TAG}",
        "tagName": TAG,
        "isDraft": False,
        "isPrerelease": False,
        "publishedAt": "2026-07-13T00:00:00Z",
        "assets": [
            {"name": MAIN_NAME, "size": len(main_bytes), "digest": f"sha256:{sha256(main_bytes)}"},
            {"name": RUNTIME_NAME, "size": len(runtime_bytes), "digest": f"sha256:{sha256(runtime_bytes)}"},
            {
                "name": manifest_path.name,
                "size": manifest_path.stat().st_size,
                "digest": f"sha256:{sha256(manifest_path.read_bytes())}",
            },
            {
                "name": checksums_path.name,
                "size": checksums_path.stat().st_size,
                "digest": f"sha256:{sha256(checksums_path.read_bytes())}",
            },
        ],
    }
    release_path = fixture_dir / "release.json"
    write_json(release_path, release)

    stub_dir = tmp_path / "gh-stub"
    stub_dir.mkdir()
    stub_script = stub_dir / "gh_stub.py"
    stub_script.write_text(
        """from __future__ import annotations
import json
import os
import shutil
import sys
from pathlib import Path

args = sys.argv[1:]
fixture_dir = Path(os.environ["GH_RELEASE_FIXTURE_DIR"])
log_path = Path(os.environ["GH_RELEASE_DOWNLOAD_LOG"])
if args == ["--version"]:
    print("gh version 2.99.0")
elif args[:2] == ["release", "view"]:
    print((fixture_dir / "release.json").read_text(encoding="utf-8"))
elif args[:2] == ["release", "download"]:
    pattern = args[args.index("--pattern") + 1]
    destination = Path(args[args.index("--dir") + 1])
    with log_path.open("a", encoding="utf-8") as log:
        log.write(pattern + "\\n")
    source = fixture_dir / pattern
    if not source.is_file():
        sys.exit(1)
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination / source.name)
else:
    sys.exit(2)
""",
        encoding="utf-8",
    )
    (stub_dir / "gh.cmd").write_text('@python "%~dp0gh_stub.py" %*\n', encoding="ascii")
    download_log = tmp_path / "downloads.log"
    env = os.environ.copy()
    env["PATH"] = str(stub_dir) + os.pathsep + env["PATH"]
    env["GH_RELEASE_FIXTURE_DIR"] = str(fixture_dir)
    env["GH_RELEASE_DOWNLOAD_LOG"] = str(download_log)
    return env, release_path, manifest_path, checksums_path


def refresh_asset_metadata(release_path: Path, asset_path: Path) -> None:
    release = json.loads(release_path.read_text(encoding="utf-8"))
    for asset in release["assets"]:
        if asset["name"] == asset_path.name:
            payload = asset_path.read_bytes()
            asset["size"] = len(payload)
            asset["digest"] = f"sha256:{sha256(payload)}"
            break
    else:
        raise AssertionError(f"asset missing from fixture: {asset_path.name}")
    write_json(release_path, release)


def invoke_validator(
    tmp_path: Path,
    env: dict[str, str],
    *extra: str,
) -> tuple[subprocess.CompletedProcess[str], Path]:
    if POWERSHELL is None:
        pytest.skip("PowerShell is required for release asset validation tests")
    output_path = tmp_path / "validation.json"
    download_dir = tmp_path / "downloads"
    result = subprocess.run(
        [
            POWERSHELL,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPT),
            "-Version",
            VERSION,
            "-ReleaseDate",
            RELEASE_DATE,
            "-MetadataOnly",
            "-ExpectedCommit",
            COMMIT,
            "-DownloadDir",
            str(download_dir),
            "-OutputJson",
            str(output_path),
            *extra,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )
    return result, output_path


def test_metadata_only_downloads_only_integrity_assets_and_returns_summary(tmp_path: Path):
    env, _, _, _ = create_gh_fixture(tmp_path)

    result, output_path = invoke_validator(tmp_path, env)

    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["release_health_verified"] is True
    assert payload["is_draft"] is False
    assert payload["is_prerelease"] is False
    assert payload["integrity"]["checked"] is True
    assert payload["integrity"]["manifest"]["commit"] == COMMIT
    assert payload["integrity"]["manifest"]["release_date"] == "2026-07-13"
    assert payload["integrity"]["release_assets_verified"] == 2
    assert payload["integrity"]["github_digest_checks_verified"] == 4
    assert payload["integrity"]["main_zip_downloaded"] is False
    assert (tmp_path / "downloads.log").read_text(encoding="utf-8").splitlines() == [
        "release-manifest.json",
        "SHA256SUMS.txt",
    ]


def test_metadata_only_ignores_extra_runtime_assets_not_declared_by_manifest(tmp_path: Path):
    env, release_path, _, _ = create_gh_fixture(tmp_path)
    release = json.loads(release_path.read_text(encoding="utf-8"))
    release["assets"].append(
        {
            "name": "opencv-wechat-runtime-opencv-legacy-win_amd64.zip",
            "size": 123,
            "digest": f"sha256:{'a' * 64}",
        }
    )
    write_json(release_path, release)

    result, output_path = invoke_validator(tmp_path, env)

    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert [asset["name"] for asset in payload["opencv_runtime_assets"]] == [RUNTIME_NAME]
    assert payload["integrity"]["verified_runtime_asset_names"] == [RUNTIME_NAME]


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("isDraft", True, "still a draft"),
        ("isPrerelease", True, "marked as a prerelease"),
        ("tagName", "v1.2.4", "expected v1.2.5"),
        ("publishedAt", "", "has no publishedAt timestamp"),
        ("publishedAt", "not-a-date", "invalid publishedAt timestamp"),
    ],
)
def test_rejects_unhealthy_release_metadata(tmp_path: Path, field: str, value: object, message: str):
    env, release_path, _, _ = create_gh_fixture(tmp_path)
    release = json.loads(release_path.read_text(encoding="utf-8"))
    release[field] = value
    write_json(release_path, release)

    result, _ = invoke_validator(tmp_path, env)

    assert result.returncode != 0
    assert message in result.stdout + result.stderr


def test_rejects_missing_integrity_asset(tmp_path: Path):
    env, release_path, _, _ = create_gh_fixture(tmp_path)
    release = json.loads(release_path.read_text(encoding="utf-8"))
    release["assets"] = [asset for asset in release["assets"] if asset["name"] != "SHA256SUMS.txt"]
    write_json(release_path, release)

    result, _ = invoke_validator(tmp_path, env)

    assert result.returncode != 0
    assert "must contain one non-empty SHA256SUMS.txt" in result.stdout + result.stderr


@pytest.mark.parametrize(
    ("manifest_field", "value", "message"),
    [
        ("commit", "f" * 40, "expected 0123456789abcdef"),
        ("release_date", "2026-07-12", "expected 2026-07-13"),
        ("tag", "v1.2.4", "expected v1.2.5"),
    ],
)
def test_rejects_manifest_identity_mismatch(
    tmp_path: Path, manifest_field: str, value: str, message: str
):
    env, release_path, manifest_path, _ = create_gh_fixture(tmp_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest[manifest_field] = value
    write_json(manifest_path, manifest)
    refresh_asset_metadata(release_path, manifest_path)

    result, _ = invoke_validator(tmp_path, env)

    assert result.returncode != 0
    assert message in result.stdout + result.stderr


def test_rejects_manifest_checksum_and_github_digest_mismatches(tmp_path: Path):
    env, release_path, _, checksums_path = create_gh_fixture(tmp_path)
    checksums_path.write_text(f"{'0' * 64}  {MAIN_NAME}\n", encoding="ascii")
    refresh_asset_metadata(release_path, checksums_path)

    checksum_result, _ = invoke_validator(tmp_path, env)
    assert checksum_result.returncode != 0
    assert "entry count does not match" in checksum_result.stdout + checksum_result.stderr

    env, release_path, _, _ = create_gh_fixture(tmp_path / "digest")
    release = json.loads(release_path.read_text(encoding="utf-8"))
    release["assets"][0]["digest"] = f"sha256:{'f' * 64}"
    write_json(release_path, release)

    digest_result, _ = invoke_validator(tmp_path / "digest", env)
    assert digest_result.returncode != 0
    assert "GitHub digest mismatch" in digest_result.stdout + digest_result.stderr


def test_rejects_non_strict_semver_before_calling_github(tmp_path: Path):
    if POWERSHELL is None:
        pytest.skip("PowerShell is required for release asset validation tests")
    result = subprocess.run(
        [
            POWERSHELL,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPT),
            "-Version",
            "01.2.3",
            "-MetadataOnly",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    assert result.returncode != 0
    assert "strict X.Y.Z SemVer without leading zeroes" in result.stdout + result.stderr
