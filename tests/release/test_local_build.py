from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")
NODE = shutil.which("node")
CARGO = shutil.which("cargo") or str(Path.home() / ".cargo/bin/cargo.exe")
SIGNING_NAMES = (
    "TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PATH",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "TAURI_PRIVATE_KEY",
    "TAURI_PRIVATE_KEY_PATH", "TAURI_PRIVATE_KEY_PASSWORD",
)


def run(command, *, cwd=ROOT, env=None):
    return subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=90)


def require_tools():
    if not POWERSHELL or not NODE or not Path(CARGO).is_file():
        pytest.skip("PowerShell, Node and Tauri CLI required")
    if run([CARGO, "tauri", "--version"]).returncode:
        pytest.skip("Tauri CLI required")


def clean_env():
    env = {key: value for key, value in os.environ.items() if key not in SIGNING_NAMES}
    env["PATH"] = str(Path(CARGO).parent) + os.pathsep + env["PATH"]
    return env


@pytest.fixture(scope="module")
def test_key(tmp_path_factory):
    require_tools()
    folder = tmp_path_factory.mktemp("ephemeral-updater-key")
    key = folder / "fixture.key"
    # Disposable test credential, never read the user's production private key.
    password = "fixture-password & ' quoted \" $ spaces !"
    result = run([CARGO, "tauri", "signer", "generate", "--ci", "-p", password, "-w", str(key)], env=clean_env())
    assert result.returncode == 0, "Unable to generate ephemeral test key"
    config = folder / "tauri.conf.json"
    config.write_text(json.dumps({"plugins": {"updater": {"pubkey": Path(f"{key}.pub").read_text().strip()}}}), encoding="utf-8")
    return key, password, config


def sign(file, key, password):
    env = clean_env()
    env.update(TEST_FILE=str(file), TEST_KEY=str(key), TEST_PASSWORD=password,
               SIGN_SCRIPT=str(ROOT / "scripts/sign_updater.ps1"))
    # Deliberately conflicting inherited credentials must be ignored in the child.
    env["TAURI_SIGNING_PRIVATE_KEY"] = "unrelated-key-must-not-be-used"
    env["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"] = "parent-password-must-be-preserved"
    script = """
$ErrorActionPreference = 'Stop'
$password = New-Object Security.SecureString
foreach ($character in $env:TEST_PASSWORD.ToCharArray()) { $password.AppendChar($character) }
try {
    & $env:SIGN_SCRIPT -File $env:TEST_FILE -KeyPath $env:TEST_KEY -Password $password
    if ($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -cne 'parent-password-must-be-preserved') { throw 'Parent env changed' }
} finally { $password.Dispose() }
"""
    return run([POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], env=env)


def verify(file, config):
    return run([NODE, str(ROOT / "scripts/verify_updater_signature.mjs"), str(file), f"{file}.sig", str(config)])


def test_real_tauri_signature_and_special_password(test_key, tmp_path):
    key, password, config = test_key
    file = tmp_path / "安装包 with spaces.exe"
    file.write_bytes(b"test-only-installer-content\x00" * 1024)
    result = sign(file, key, password)
    assert result.returncode == 0, result.stdout + result.stderr
    assert password not in result.stdout + result.stderr
    assert key.read_text() not in result.stdout + result.stderr
    checked = verify(file, config)
    assert checked.returncode == 0, checked.stdout + checked.stderr
    file.write_bytes(b"tampered")
    assert verify(file, config).returncode != 0


def test_wrong_password_stops_without_signature(test_key, tmp_path):
    key, _, _ = test_key
    file = tmp_path / "probe.txt"
    file.write_text("probe", encoding="utf-8")
    result = sign(file, key, "wrong-password")
    assert result.returncode != 0
    assert "Updater signing failed" in result.stdout + result.stderr
    assert not Path(f"{file}.sig").exists()


def test_existing_ci_environment_contract(test_key, tmp_path):
    key, password, config = test_key
    file = tmp_path / "ci-installer.exe"
    file.write_bytes(b"ci-fixture")
    env = clean_env()
    env["TAURI_SIGNING_PRIVATE_KEY_PATH"] = str(key)
    env["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"] = password
    result = run([POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/sign_updater.ps1"), "-File", str(file)], env=env)
    assert result.returncode == 0, result.stdout + result.stderr
    assert verify(file, config).returncode == 0
    assert password not in result.stdout + result.stderr


def test_wrong_embedded_key_and_tampered_trusted_comment_rejected(test_key, tmp_path):
    key, password, config = test_key
    file = tmp_path / "sample.exe"
    file.write_bytes(b"fixture")
    assert sign(file, key, password).returncode == 0
    modified = json.loads(config.read_text())
    public_lines = base64.b64decode(modified["plugins"]["updater"]["pubkey"]).decode().splitlines()
    packet = bytearray(base64.b64decode(public_lines[1]))
    packet[-1] ^= 1  # Keep the key ID: checking the ID alone is insufficient.
    public_lines[1] = base64.b64encode(packet).decode()
    modified["plugins"]["updater"]["pubkey"] = base64.b64encode(("\n".join(public_lines) + "\n").encode()).decode()
    wrong_config = tmp_path / "wrong-config.json"
    wrong_config.write_text(json.dumps(modified), encoding="utf-8")
    assert verify(file, wrong_config).returncode != 0
    signature = Path(f"{file}.sig")
    lines = base64.b64decode(signature.read_text()).decode().splitlines()
    lines[2] += " tampered"
    signature.write_text(base64.b64encode(("\n".join(lines) + "\n").encode()).decode())
    assert verify(file, config).returncode != 0


@pytest.fixture
def small_repo(tmp_path, test_key):
    key, _, config = test_key
    repo = tmp_path / "仓库 with spaces"
    (repo / "scripts").mkdir(parents=True)
    (repo / "src-tauri").mkdir()
    for name in ("build_local.ps1", "sign_updater.ps1", "verify_updater_signature.mjs"):
        shutil.copy2(ROOT / "scripts" / name, repo / "scripts" / name)
    payload = json.loads(config.read_text())
    payload["version"] = "2.0.0"
    (repo / "src-tauri/tauri.conf.json").write_text(json.dumps(payload), encoding="utf-8")
    (repo / "src-tauri/Cargo.toml").write_text('[package]\nversion = "2.0.0"\n', encoding="utf-8")
    (repo / ".gitignore").write_text("artifacts/\n.build-venv/\n", encoding="utf-8")
    for args in (("init",), ("add", "."), ("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture")):
        result = run(["git", *args], cwd=repo)
        assert result.returncode == 0, result.stderr
    return repo, key


def preflight(repo, key, mode):
    return run([POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                str(repo / "scripts/build_local.ps1"), "-Mode", mode, "-KeyPath", str(key), "-PlanOnly"],
               cwd=repo.parent, env=clean_env())


def test_readonly_preflight_from_another_directory_and_dirty_gates(small_repo):
    repo, key = small_repo
    for mode in ("Test", "Release"):
        result = preflight(repo, key, mode)
        assert result.returncode == 0, result.stdout + result.stderr
        assert "2.0.0" in result.stdout
    assert not (repo / "artifacts").exists()
    assert not (repo / ".build-venv").exists()
    # An untracked source file must block the formal build too.
    (repo / "new-source.py").write_text("pass\n")
    assert preflight(repo, key, "Release").returncode != 0
    assert preflight(repo, key, "Test").returncode == 0


def test_preflight_missing_and_mismatched_key(small_repo, tmp_path):
    repo, key = small_repo
    assert preflight(repo, tmp_path / "missing.key", "Test").returncode != 0
    config_path = repo / "src-tauri/tauri.conf.json"
    config = json.loads(config_path.read_text())
    config["plugins"]["updater"]["pubkey"] = "wrong"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    assert preflight(repo, key, "Test").returncode != 0
    assert not (repo / "artifacts").exists()


def test_wrapper_wrong_password_fails_before_dependencies(small_repo):
    repo, key = small_repo
    env = clean_env()
    env.update(LOCAL_BUILD_SCRIPT=str(repo / "scripts/build_local.ps1"), LOCAL_TEST_KEY=str(key))
    result = run([POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", """
$password = New-Object Security.SecureString
foreach ($character in 'wrong'.ToCharArray()) { $password.AppendChar($character) }
try {
    & $env:LOCAL_BUILD_SCRIPT -Mode Test -KeyPath $env:LOCAL_TEST_KEY -SigningPassword $password
    $scriptExit = $LASTEXITCODE
}
finally { $password.Dispose() }
exit $scriptExit
"""], cwd=repo.parent, env=env)
    assert result.returncode != 0
    assert not (repo / ".build-venv").exists()
    assert not list(repo.rglob("signing-check.txt*"))
    assert not list(repo.rglob("build-summary.json"))
    # Failed runs release the lock so the next double-click can proceed.
    lock = repo / "artifacts/.local-build.lock"
    lock.unlink()


def test_formal_orchestrator_preserves_secure_password_for_online_release(small_repo, test_key):
    repo, key = small_repo
    _, password, config = test_key
    for name in ("build_target.ps1", "validate_tauri_release.ps1", "generate_updater_feed.ps1"):
        shutil.copy2(ROOT / "scripts" / name, repo / "scripts" / name)
    # Replace only the expensive compiler; keep real orchestration, signing and validators.
    (repo / "scripts/build_tauri_release.ps1").write_text("""
param($Version, $ReleaseDate, $Python, $OutputDir, $IntermediateRoot, $FeedOutputDir, $CommitSha,
    [switch]$RequireSignature, $SigningKeyPath, [Security.SecureString]$SigningPassword,
    [switch]$SkipFeed)
$ErrorActionPreference = 'Stop'
if (-not $RequireSignature -or $null -eq $SigningPassword) { throw 'Signing contract lost' }
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$file = Join-Path $OutputDir "fixture-$Version-setup.exe"
[IO.File]::WriteAllText($file, 'compiled fixture')
$context = @{schema_version=1; distribution_target='tauri'; version=$Version; commit=$CommitSha;
    release_date=$ReleaseDate; build_mode='release'; variant='online'} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $OutputDir 'build-context.json'), $context)
& (Join-Path $PSScriptRoot 'sign_updater.ps1') -File $file -KeyPath $SigningKeyPath -Password $SigningPassword
if (-not $SkipFeed) {
    & (Join-Path $PSScriptRoot 'generate_updater_feed.ps1') -Version $Version `
        -UpdateUrl 'https://example.invalid/fixture.exe' -SignatureFile "$file.sig" `
        -ReleaseDate '2026-09-07' -OutputDir $FeedOutputDir
}
""", encoding="utf-8-sig")
    assert run(["git", "add", "."], cwd=repo).returncode == 0
    assert run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "compiler fixture"], cwd=repo).returncode == 0
    env = clean_env()
    env.update(TEST_TARGET=str(repo / "scripts/build_target.ps1"), TEST_KEY=str(key), TEST_PASSWORD=password)
    result = run([POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", """
$ErrorActionPreference = 'Stop'
$password = New-Object Security.SecureString
foreach ($character in $env:TEST_PASSWORD.ToCharArray()) { $password.AppendChar($character) }
try {
    & $env:TEST_TARGET -Target Tauri -Version 2.0.0 -ReleaseDate 20260907 `
        -SigningKeyPath $env:TEST_KEY -SigningPassword $password
} finally { $password.Dispose() }
"""], cwd=repo, env=env)
    assert result.returncode == 0, result.stdout + result.stderr
    installers = list((repo / "artifacts/tauri").rglob("*.exe"))
    assert len(installers) == 1
    for installer in installers:
        assert verify(installer, config).returncode == 0
    assert (repo / "artifacts/tauri/updater/latest.json").is_file()
    assert not (repo / "artifacts/tauri/offline").exists()
    assert not run(["git", "status", "--porcelain"], cwd=repo).stdout.strip()
