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
INSTALLER_NAME = f"报销管理_{VERSION}_x64-setup.exe"
SIGNATURE_NAME = f"{INSTALLER_NAME}.sig"
LATEST_NAME = "latest.json"
COMPAT_NAME = "data-compat.json"
RUNTIME_NAME = "opencv-wechat-runtime-4.10.0.zip"
UPDATE_URL = f"https://github.com/winloud/Reimbursement-Tool/releases/download/{TAG}/{INSTALLER_NAME}"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def create_gh_fixture(tmp_path: Path) -> tuple[dict[str, str], Path, Path, Path, Path]:
    fixture_dir = tmp_path / "fixture"
    fixture_dir.mkdir(parents=True)
    installer_bytes = b"nsis installer placeholder"
    signature_bytes = b"untrusted comment: signature\nRWReX3/gb3u/XPLACEHOLDER\n"
    runtime_bytes = b"opencv runtime zip placeholder"
    (fixture_dir / INSTALLER_NAME).write_bytes(installer_bytes)
    (fixture_dir / SIGNATURE_NAME).write_bytes(signature_bytes)
    (fixture_dir / RUNTIME_NAME).write_bytes(runtime_bytes)

    latest_path = fixture_dir / LATEST_NAME
    write_json(
        latest_path,
        {
            "version": VERSION,
            "pub_date": "2026-07-13T00:00:00Z",
            "platforms": {
                "windows-x86_64": {
                    "signature": "RWReX3/gb3u/XPLACEHOLDER",
                    "url": UPDATE_URL,
                }
            },
        },
    )
    compat_path = fixture_dir / COMPAT_NAME
    write_json(compat_path, {"min_data_schema_version": 7, "max_data_schema_version": 7})

    asset_files = [
        (INSTALLER_NAME, installer_bytes),
        (SIGNATURE_NAME, signature_bytes),
        (LATEST_NAME, latest_path.read_bytes()),
        (COMPAT_NAME, compat_path.read_bytes()),
        (RUNTIME_NAME, runtime_bytes),
    ]

    manifest = {
        "tag": TAG,
        "commit": COMMIT,
        "release_date": "2026-07-13",
        "assets": [
            {"name": name, "size": len(payload), "sha256": sha256(payload)}
            for name, payload in asset_files
        ],
    }
    manifest_path = fixture_dir / "release-manifest.json"
    write_json(manifest_path, manifest)
    checksums_path = fixture_dir / "SHA256SUMS.txt"
    checksums_path.write_text(
        "".join(f"{sha256(payload)}  {name}\n" for name, payload in asset_files),
        encoding="utf-8",
    )

    release = {
        "url": f"https://example.invalid/releases/tag/{TAG}",
        "tagName": TAG,
        "isDraft": False,
        "isPrerelease": False,
        "publishedAt": "2026-07-13T00:00:00Z",
        "assets": [
            {"name": name, "size": len(payload), "digest": f"sha256:{sha256(payload)}"}
            for name, payload in asset_files
        ]
        + [
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
    sys.stdout.reconfigure(encoding="utf-8")
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
    env["PYTHONIOENCODING"] = "utf-8"
    return env, release_path, manifest_path, checksums_path, latest_path


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


def refresh_integrity_artifacts(fixture_dir: Path, release_path: Path) -> None:
    """改动被 manifest 覆盖的资产后，重算 manifest / SHA256SUMS / release 元数据。

    否则完整性校验会先于被测断言失败（例如改 latest.json 只想触发 feed 校验，
    却先撞上 "GitHub digest mismatch"）。
    """
    manifest_path = fixture_dir / "release-manifest.json"
    checksums_path = fixture_dir / "SHA256SUMS.txt"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    for record in manifest["assets"]:
        payload = (fixture_dir / record["name"]).read_bytes()
        record["size"] = len(payload)
        record["sha256"] = sha256(payload)
        refresh_asset_metadata(release_path, fixture_dir / record["name"])

    write_json(manifest_path, manifest)
    checksums_path.write_text(
        "".join(f"{record['sha256']}  {record['name']}\n" for record in manifest["assets"]),
        encoding="utf-8",
    )
    refresh_asset_metadata(release_path, manifest_path)
    refresh_asset_metadata(release_path, checksums_path)


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
        # PowerShell 的错误信息按控制台代码页输出（中文 Windows 上是 GBK），
        # 严格 utf-8 解码会让 stdout/stderr 变成 None。断言只看关键字，替换即可。
        errors="replace",
        env=env,
    )
    return result, output_path


def test_metadata_only_downloads_only_integrity_assets_and_returns_summary(tmp_path: Path):
    env, *_ = create_gh_fixture(tmp_path)

    result, output_path = invoke_validator(tmp_path, env)

    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["release_health_verified"] is True
    assert payload["is_draft"] is False
    assert payload["is_prerelease"] is False
    assert [installer["name"] for installer in payload["installers"]] == [INSTALLER_NAME]
    assert payload["signatures"] == [SIGNATURE_NAME]
    assert payload["updater_feed"]["latest_version"] == VERSION
    assert payload["updater_feed"]["update_asset_name"] == INSTALLER_NAME
    assert payload["updater_feed"]["min_data_schema_version"] == 7
    assert payload["integrity"]["checked"] is True
    assert payload["integrity"]["manifest"]["commit"] == COMMIT
    assert payload["integrity"]["manifest"]["release_date"] == "2026-07-13"
    # 安装包 + 签名 + latest.json + data-compat.json + OpenCV runtime。
    assert payload["integrity"]["release_assets_verified"] == 5
    assert payload["integrity"]["github_digest_checks_verified"] == 7
    assert payload["integrity"]["installer_downloaded"] is False
    assert (tmp_path / "downloads.log").read_text(encoding="utf-8").splitlines() == [
        "release-manifest.json",
        "SHA256SUMS.txt",
        LATEST_NAME,
        COMPAT_NAME,
    ]


def test_rejects_installer_without_updater_signature(tmp_path: Path):
    env, release_path, *_ = create_gh_fixture(tmp_path)
    release = json.loads(release_path.read_text(encoding="utf-8"))
    release["assets"] = [asset for asset in release["assets"] if asset["name"] != SIGNATURE_NAME]
    write_json(release_path, release)

    result, _ = invoke_validator(tmp_path, env)

    assert result.returncode != 0
    assert "Updater signature asset is missing" in result.stdout + result.stderr


def test_rejects_feed_version_mismatch(tmp_path: Path):
    env, release_path, _, _, latest_path = create_gh_fixture(tmp_path)
    latest = json.loads(latest_path.read_text(encoding="utf-8"))
    latest["version"] = "9.9.9"
    write_json(latest_path, latest)
    refresh_integrity_artifacts(tmp_path / "fixture", release_path)

    result, _ = invoke_validator(tmp_path, env)

    assert result.returncode != 0
    assert "latest.json version is 9.9.9" in result.stdout + result.stderr


def test_rejects_feed_url_pointing_at_another_tag(tmp_path: Path):
    env, release_path, _, _, latest_path = create_gh_fixture(tmp_path)
    latest = json.loads(latest_path.read_text(encoding="utf-8"))
    latest["platforms"]["windows-x86_64"]["url"] = UPDATE_URL.replace(TAG, "v9.9.9")
    write_json(latest_path, latest)
    refresh_integrity_artifacts(tmp_path / "fixture", release_path)

    result, _ = invoke_validator(tmp_path, env)

    assert result.returncode != 0
    assert "does not point at v1.2.5" in result.stdout + result.stderr


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
    env, release_path, *_ = create_gh_fixture(tmp_path)
    release = json.loads(release_path.read_text(encoding="utf-8"))
    release[field] = value
    write_json(release_path, release)

    result, _ = invoke_validator(tmp_path, env)

    assert result.returncode != 0
    assert message in result.stdout + result.stderr


def test_rejects_missing_integrity_asset(tmp_path: Path):
    env, release_path, *_ = create_gh_fixture(tmp_path)
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
    env, release_path, manifest_path, _, _ = create_gh_fixture(tmp_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest[manifest_field] = value
    write_json(manifest_path, manifest)
    refresh_asset_metadata(release_path, manifest_path)

    result, _ = invoke_validator(tmp_path, env)

    assert result.returncode != 0
    assert message in result.stdout + result.stderr


def test_rejects_manifest_checksum_and_github_digest_mismatches(tmp_path: Path):
    env, release_path, _, checksums_path, _ = create_gh_fixture(tmp_path)
    checksums_path.write_text(f"{'0' * 64}  {INSTALLER_NAME}\n", encoding="utf-8")
    refresh_asset_metadata(release_path, checksums_path)

    checksum_result, _ = invoke_validator(tmp_path, env)
    assert checksum_result.returncode != 0
    assert "entry count does not match" in checksum_result.stdout + checksum_result.stderr

    env, release_path, _, _, _ = create_gh_fixture(tmp_path / "digest")
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
        errors="replace",
    )

    assert result.returncode != 0
    assert "strict X.Y.Z SemVer without leading zeroes" in result.stdout + result.stderr
