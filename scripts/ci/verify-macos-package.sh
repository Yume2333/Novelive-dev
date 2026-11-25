#!/usr/bin/env bash
#
# Verifies the macOS DMG + ZIP package built by `pnpm --filter @novelive/desktop run package:macos`.
# Intended to run on a GitHub Actions `macos-15` runner after `package:macos`.
#
# Performs real native verification:
#   1. Verifies `.dmg`, `.zip`, `latest-mac.yml`, `BUILD.txt`, and `SHA256SUMS` exist,
#      every SHA-256 digest in `SHA256SUMS` matches, and `latest-mac.yml` version and
#      SHA-512 entries match the `.zip` and `.dmg` artifacts.
#   2. Attaches the `.dmg` read-only with `-nobrowse` at a fixed temporary mountpoint
#      via `hdiutil attach`, copies `Novelive.app` to a temporary Applications folder,
#      and ALWAYS detaches on exit via `trap`.
#   3. Verifies `Contents/Info.plist` declares `.novelive` in `CFBundleDocumentTypes`
#      (using `plutil` and `/usr/libexec/PlistBuddy`).
#   4. Verifies `Contents/Resources/licenses/LICENSE.txt`,
#      `Contents/Resources/licenses/THIRD_PARTY_NOTICES.txt`, and `app-update.yml`
#      are present and non-empty in the app bundle (plus Electron license files if present).
#   5. Launches the copied app binary (`Contents/MacOS/Novelive`) via Playwright
#      (`tests/e2e/m5-packaged.spec.ts` and optionally `tests/e2e/m5-share.spec.ts`)
#      with a fixture `.novelive` package path, throwaway HOME/user-data dir,
#      `NL_REPLAY=strict`, and a local `NL_UPDATE_URL` serving `latest-mac.yml` to verify
#      import, offline playback, packaged about/licenses, and update-metadata checks.
#   6. Verifies the unsigned macOS manual-update prompt branch (does NOT auto-download or
#      auto-install; shows manual download prompt and invokes `shell.openExternal`).
#   7. Detaches the DMG explicitly (also guarded by `trap`) and writes a machine-readable
#      JSON summary (default: `${RUNNER_TEMP:-/tmp}/macos-package-verification.json`).
#
# Exact invocation for .github/workflows/package.yml (on macos-15 after `package:macos`):
#
#   - name: Verify macOS DMG and ZIP package
#     if: matrix.platform == 'macos'
#     run: bash scripts/ci/verify-macos-package.sh
#
# Optional arguments / environment overrides:
#   bash scripts/ci/verify-macos-package.sh \
#     [--artifacts-dir <dir>] \
#     [--summary-path <file>] \
#     [--skip-share-e2e]
#
#   Environment variables:
#     ARTIFACTS_DIR    Overrides auto-discovery under apps/desktop/dist/darwin-*/artifacts
#     SUMMARY_PATH     Overrides summary JSON path (default: $RUNNER_TEMP/macos-package-verification.json)
#     SKIP_SHARE_E2E   Set to 1 to skip tests/e2e/m5-share.spec.ts (still runs m5-packaged.spec.ts)

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: bash scripts/ci/verify-macos-package.sh [options]

Options:
  --artifacts-dir <dir>   Path to artifacts directory (default: newest apps/desktop/dist/darwin-*/artifacts)
  --summary-path <file>   Output path for JSON summary (default: ${RUNNER_TEMP:-/tmp}/macos-package-verification.json)
  --skip-share-e2e        Skip tests/e2e/m5-share.spec.ts (still runs tests/e2e/m5-packaged.spec.ts)
  -h, --help              Show this help text
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_PACKAGE_JSON="$REPO_ROOT/apps/desktop/package.json"

if [[ ! -f "$DESKTOP_PACKAGE_JSON" ]]; then
	echo "ERROR: Cannot locate apps/desktop/package.json from repo root: $REPO_ROOT" >&2
	exit 1
fi

ARTIFACTS_DIR="${ARTIFACTS_DIR:-}"
SUMMARY_PATH="${SUMMARY_PATH:-${RUNNER_TEMP:-/tmp}/macos-package-verification.json}"
SKIP_SHARE_E2E="${SKIP_SHARE_E2E:-0}"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--artifacts-dir)
			if [[ $# -lt 2 ]]; then
				echo "ERROR: --artifacts-dir requires a value" >&2
				exit 2
			fi
			ARTIFACTS_DIR="$2"
			shift 2
			;;
		--summary-path)
			if [[ $# -lt 2 ]]; then
				echo "ERROR: --summary-path requires a value" >&2
				exit 2
			fi
			SUMMARY_PATH="$2"
			shift 2
			;;
		--skip-share-e2e)
			SKIP_SHARE_E2E=1
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "ERROR: Unknown argument: $1" >&2
			usage >&2
			exit 2
			;;
	esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "ERROR: scripts/ci/verify-macos-package.sh must run on macOS (detected $(uname -s))." >&2
	exit 1
fi

for cmd in hdiutil plutil shasum ditto node pnpm; do
	if ! command -v "$cmd" >/dev/null 2>&1; then
		echo "ERROR: Required command not found in PATH: $cmd" >&2
		exit 1
	fi
done

if [[ ! -x /usr/libexec/PlistBuddy ]]; then
	echo "ERROR: /usr/libexec/PlistBuddy not found" >&2
	exit 1
fi

TEMP_ROOT="$(mktemp -d "${RUNNER_TEMP:-/tmp}/nl-mac-verify.XXXXXX")"
MOUNT_POINT="$TEMP_ROOT/dmg-mount"
TEMP_APPS="$TEMP_ROOT/Applications"
PACKAGED_REPORT="$TEMP_ROOT/packaged-report.json"
STEPS_LOG="$TEMP_ROOT/steps.jsonl"
ARTIFACTS_JSON="$TEMP_ROOT/artifacts.json"
LATEST_YML_JSON="$TEMP_ROOT/latest-mac.json"
PLIST_JSON="$TEMP_ROOT/info-plist.json"
LICENSES_JSON="$TEMP_ROOT/licenses.json"

mkdir -p "$MOUNT_POINT" "$TEMP_APPS"
: > "$STEPS_LOG"

DMG_MOUNTED=0
OVERALL_STATUS="failed"
ERROR_MESSAGE=""
EXPECTED_VERSION="$(node -e "console.log(JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).version)" "$DESKTOP_PACKAGE_JSON")"
APP_PATH="$TEMP_APPS/Novelive.app"
APP_BINARY="$APP_PATH/Contents/MacOS/Novelive"
SHARE_E2E_STATUS="not-run"
PACKAGED_SPEC_STATUS="not-run"
MANUAL_PROMPT_VERIFIED=0

record_step() {
	local step_num="$1"
	local step_name="$2"
	local step_status="$3"
	local step_detail="$4"
	echo "[Step $step_num: $step_name] $step_status - $step_detail"
	node -e '
		const fs = require("node:fs");
		const entry = {
			step: Number(process.argv[2]),
			name: process.argv[3],
			status: process.argv[4],
			detail: process.argv[5],
			at: new Date().toISOString(),
		};
		fs.appendFileSync(process.argv[1], JSON.stringify(entry) + "\n");
	' "$STEPS_LOG" "$step_num" "$step_name" "$step_status" "$step_detail"
}

detach_dmg() {
	if [[ "$DMG_MOUNTED" -eq 1 ]]; then
		echo "Detaching DMG from $MOUNT_POINT..."
		if hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || hdiutil detach -force "$MOUNT_POINT" >/dev/null 2>&1; then
			DMG_MOUNTED=0
			echo "Detached DMG from $MOUNT_POINT"
		else
			echo "WARNING: Failed to detach DMG from $MOUNT_POINT" >&2
		fi
	fi
}

write_summary() {
	local summary_dir
	summary_dir="$(dirname "$SUMMARY_PATH")"
	mkdir -p "$summary_dir"

	local os_product os_version os_build os_arch
	os_product="$(sw_vers -productName 2>/dev/null || echo 'macOS')"
	os_version="$(sw_vers -productVersion 2>/dev/null || echo 'unknown')"
	os_build="$(sw_vers -buildVersion 2>/dev/null || echo 'unknown')"
	os_arch="$(uname -m 2>/dev/null || echo 'unknown')"

	node -e '
		const fs = require("node:fs");
		const readJson = (file, fallback) => {
			try {
				return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
			} catch {
				return fallback;
			}
		};
		const steps = fs.existsSync(process.argv[2])
			? fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
			: [];
		const summary = {
			platform: "macos",
			verifiedAt: new Date().toISOString(),
			status: process.argv[3],
			error: process.argv[4] || null,
			runner: {
				productName: process.argv[5],
				productVersion: process.argv[6],
				buildVersion: process.argv[7],
				architecture: process.argv[8],
			},
			expectedVersion: process.argv[9],
			artifactsDir: process.argv[10] || null,
			artifacts: readJson(process.argv[11], []),
			latestMacYml: readJson(process.argv[12], null),
			infoPlist: readJson(process.argv[13], null),
			licenses: readJson(process.argv[14], []),
			packagedReport: readJson(process.argv[15], null),
			runtimeVerification: {
				packagedSpec: process.argv[16],
				shareE2ESpec: process.argv[17],
				manualUpdatePromptVerified: process.argv[18] === "1",
			},
			steps,
		};
		fs.writeFileSync(process.argv[1], JSON.stringify(summary, null, 2) + "\n");
	' \
		"$SUMMARY_PATH" \
		"$STEPS_LOG" \
		"$OVERALL_STATUS" \
		"$ERROR_MESSAGE" \
		"$os_product" \
		"$os_version" \
		"$os_build" \
		"$os_arch" \
		"$EXPECTED_VERSION" \
		"$ARTIFACTS_DIR" \
		"$ARTIFACTS_JSON" \
		"$LATEST_YML_JSON" \
		"$PLIST_JSON" \
		"$LICENSES_JSON" \
		"$PACKAGED_REPORT" \
		"$PACKAGED_SPEC_STATUS" \
		"$SHARE_E2E_STATUS" \
		"$MANUAL_PROMPT_VERIFIED"

	echo "Wrote macOS verification summary to $SUMMARY_PATH"
}

cleanup() {
	local exit_code=$?
	set +e
	detach_dmg
	if [[ "$exit_code" -ne 0 && "$OVERALL_STATUS" == "running" ]]; then
		OVERALL_STATUS="failed"
		if [[ -z "$ERROR_MESSAGE" ]]; then
			ERROR_MESSAGE="Verification exited with status $exit_code"
		fi
	fi
	write_summary || true
	rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

OVERALL_STATUS="running"
echo "Starting macOS package verification (expected version: $EXPECTED_VERSION)"

# ---------------------------------------------------------------------------
# Step 1: Verify .dmg, .zip, latest-mac.yml, BUILD.txt, and SHA256SUMS
# ---------------------------------------------------------------------------
if [[ -z "$ARTIFACTS_DIR" ]]; then
	DIST_DIR="$REPO_ROOT/apps/desktop/dist"
	if [[ ! -d "$DIST_DIR" ]]; then
		ERROR_MESSAGE="No apps/desktop/dist directory found at $DIST_DIR"
		record_step 1 "artifacts-and-checksums" "failed" "$ERROR_MESSAGE"
		exit 1
	fi
	ARTIFACTS_DIR="$(ls -td "$DIST_DIR"/darwin-*/artifacts 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$ARTIFACTS_DIR" || ! -d "$ARTIFACTS_DIR" ]]; then
	ERROR_MESSAGE="Cannot locate macOS artifacts directory under $REPO_ROOT/apps/desktop/dist/darwin-*/artifacts"
	record_step 1 "artifacts-and-checksums" "failed" "$ERROR_MESSAGE"
	exit 1
fi
ARTIFACTS_DIR="$(cd "$ARTIFACTS_DIR" && pwd)"

if ! node - "$REPO_ROOT" "$ARTIFACTS_DIR" "$EXPECTED_VERSION" "$ARTIFACTS_JSON" "$LATEST_YML_JSON" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");

const [repoRoot, artifactsDir, expectedVersion, artifactsJsonPath, latestYmlJsonPath] = process.argv.slice(2);
const requireFromRepo = createRequire(path.join(repoRoot, "package.json"));
const yaml = requireFromRepo("js-yaml");
const entries = fs.readdirSync(artifactsDir);

const shaSumsFile = path.join(artifactsDir, "SHA256SUMS");
const latestMacFile = path.join(artifactsDir, "latest-mac.yml");
const buildTxtFile = path.join(artifactsDir, "BUILD.txt");

for (const required of [shaSumsFile, latestMacFile, buildTxtFile]) {
	if (!fs.existsSync(required)) {
		throw new Error(`Missing required file: ${required}`);
	}
}

const dmgName = entries.find((name) => name.endsWith(".dmg"));
const zipName = entries.find((name) => name.endsWith(".zip"));
if (!dmgName) throw new Error(`No .dmg artifact found in ${artifactsDir}`);
if (!zipName) throw new Error(`No .zip artifact found in ${artifactsDir}`);

const sumLines = fs.readFileSync(shaSumsFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
const sums = new Map();
for (const line of sumLines) {
	const match = /^([0-9a-f]{64}) {1,2}(.+)$/.exec(line);
	if (!match) throw new Error(`Malformed SHA256SUMS line: ${line}`);
	sums.set(match[2], match[1]);
}

const unsummed = new Set(["SHA256SUMS", "BUILD.txt"]);
for (const name of entries) {
	if (!unsummed.has(name) && !sums.has(name)) {
		throw new Error(`Artifact missing from SHA256SUMS: ${name}`);
	}
}

const artifactRecords = [];
for (const [name, expectedSha256] of sums.entries()) {
	const fullPath = path.join(artifactsDir, name);
	if (!fs.existsSync(fullPath)) {
		throw new Error(`File listed in SHA256SUMS is missing: ${name}`);
	}
	const bytes = fs.readFileSync(fullPath);
	const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
	if (actualSha256 !== expectedSha256) {
		throw new Error(`SHA-256 mismatch for ${name}: ${actualSha256} != ${expectedSha256}`);
	}
	const actualSha512 = crypto.createHash("sha512").update(bytes).digest("base64");
	artifactRecords.push({
		name,
		size: bytes.length,
		sha256: actualSha256,
		sha512: actualSha512,
	});
}

const latest = yaml.load(fs.readFileSync(latestMacFile, "utf8"));
if (!latest || typeof latest !== "object") {
	throw new Error("latest-mac.yml failed to parse");
}
if (String(latest.version) !== expectedVersion) {
	throw new Error(`latest-mac.yml version mismatch: ${latest.version} != ${expectedVersion}`);
}
if (!Array.isArray(latest.files) || latest.files.length === 0) {
	throw new Error("latest-mac.yml files list is empty");
}

const byName = new Map(artifactRecords.map((item) => [item.name, item]));
for (const expectedArtifact of [zipName, dmgName]) {
	const entry = latest.files.find((file) => file && file.url === expectedArtifact);
	if (!entry) {
		throw new Error(`latest-mac.yml is missing file entry for ${expectedArtifact}`);
	}
	const actual = byName.get(expectedArtifact);
	if (entry.sha512 !== actual.sha512) {
		throw new Error(`latest-mac.yml sha512 mismatch for ${expectedArtifact}`);
	}
	if (typeof entry.size === "number" && entry.size !== actual.size) {
		throw new Error(`latest-mac.yml size mismatch for ${expectedArtifact}: ${entry.size} != ${actual.size}`);
	}
}

if (latest.path !== zipName) {
	throw new Error(`latest-mac.yml top-level path mismatch: ${latest.path} != ${zipName}`);
}
if (latest.sha512 !== byName.get(zipName).sha512) {
	throw new Error("latest-mac.yml top-level sha512 mismatch against .zip artifact");
}

fs.writeFileSync(artifactsJsonPath, JSON.stringify(artifactRecords, null, 2));
fs.writeFileSync(
	latestYmlJsonPath,
	JSON.stringify(
		{
			file: latestMacFile,
			version: String(latest.version),
			path: latest.path,
			sha512: latest.sha512,
			files: latest.files.map((f) => ({ url: f.url, sha512: f.sha512, size: f.size })),
		},
		null,
		2,
	),
);
NODE
then
	ERROR_MESSAGE="Artifact, checksum, or latest-mac.yml validation failed"
	record_step 1 "artifacts-and-checksums" "failed" "$ERROR_MESSAGE"
	exit 1
fi

DMG_FILE="$ARTIFACTS_DIR/$(node -e "console.log(JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).find((a) => a.name.endsWith('.dmg')).name)" "$ARTIFACTS_JSON")"
ZIP_FILE="$ARTIFACTS_DIR/$(node -e "console.log(JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).find((a) => a.name.endsWith('.zip')).name)" "$ARTIFACTS_JSON")"
LATEST_MAC_YML="$ARTIFACTS_DIR/latest-mac.yml"

# Also verify via macOS native `shasum -a 256 -c`
if ! (cd "$ARTIFACTS_DIR" && shasum -a 256 -c SHA256SUMS); then
	ERROR_MESSAGE="shasum -a 256 -c SHA256SUMS failed"
	record_step 1 "artifacts-and-checksums" "failed" "$ERROR_MESSAGE"
	exit 1
fi

record_step 1 "artifacts-and-checksums" "passed" "Verified DMG ($(basename "$DMG_FILE")), ZIP ($(basename "$ZIP_FILE")), latest-mac.yml v$EXPECTED_VERSION, and SHA256SUMS"

# ---------------------------------------------------------------------------
# Step 2: Mount DMG read-only with hdiutil and copy Novelive.app to temp Applications
# ---------------------------------------------------------------------------
if ! hdiutil attach "$DMG_FILE" -readonly -nobrowse -mountpoint "$MOUNT_POINT" >/dev/null; then
	ERROR_MESSAGE="hdiutil attach failed for $DMG_FILE"
	record_step 2 "dmg-mount-and-copy" "failed" "$ERROR_MESSAGE"
	exit 1
fi
DMG_MOUNTED=1

MOUNTED_APP="$MOUNT_POINT/Novelive.app"
if [[ ! -d "$MOUNTED_APP" ]]; then
	ERROR_MESSAGE="Novelive.app not found at root of mounted DMG: $MOUNT_POINT"
	record_step 2 "dmg-mount-and-copy" "failed" "$ERROR_MESSAGE"
	exit 1
fi

if ! ditto "$MOUNTED_APP" "$APP_PATH"; then
	ERROR_MESSAGE="Failed to copy Novelive.app from DMG to $APP_PATH"
	record_step 2 "dmg-mount-and-copy" "failed" "$ERROR_MESSAGE"
	exit 1
fi

if [[ ! -x "$APP_BINARY" ]]; then
	ERROR_MESSAGE="Copied app binary is missing or not executable: $APP_BINARY"
	record_step 2 "dmg-mount-and-copy" "failed" "$ERROR_MESSAGE"
	exit 1
fi

record_step 2 "dmg-mount-and-copy" "passed" "Mounted $(basename "$DMG_FILE") at $MOUNT_POINT and copied Novelive.app to $APP_PATH"

# ---------------------------------------------------------------------------
# Step 3: Verify Info.plist CFBundleDocumentTypes declares .novelive
# ---------------------------------------------------------------------------
INFO_PLIST="$APP_PATH/Contents/Info.plist"
if [[ ! -f "$INFO_PLIST" ]]; then
	ERROR_MESSAGE="Info.plist missing: $INFO_PLIST"
	record_step 3 "info-plist-association" "failed" "$ERROR_MESSAGE"
	exit 1
fi

if ! plutil -lint "$INFO_PLIST"; then
	ERROR_MESSAGE="plutil -lint failed for $INFO_PLIST"
	record_step 3 "info-plist-association" "failed" "$ERROR_MESSAGE"
	exit 1
fi

if ! /usr/libexec/PlistBuddy -c "Print :CFBundleDocumentTypes" "$INFO_PLIST" >/dev/null 2>&1; then
	ERROR_MESSAGE="Info.plist does not declare CFBundleDocumentTypes"
	record_step 3 "info-plist-association" "failed" "$ERROR_MESSAGE"
	exit 1
fi

PLIST_CONVERTED="$TEMP_ROOT/info-plist-raw.json"
if ! plutil -convert json -o "$PLIST_CONVERTED" "$INFO_PLIST"; then
	ERROR_MESSAGE="Failed to convert Info.plist to JSON via plutil"
	record_step 3 "info-plist-association" "failed" "$ERROR_MESSAGE"
	exit 1
fi

if ! node - "$PLIST_CONVERTED" "$EXPECTED_VERSION" "$PLIST_JSON" <<'NODE'
const fs = require("node:fs");
const [rawPath, expectedVersion, outPath] = process.argv.slice(2);
const plist = JSON.parse(fs.readFileSync(rawPath, "utf8"));

if (plist.CFBundleShortVersionString !== expectedVersion) {
	throw new Error(
		`CFBundleShortVersionString mismatch: ${plist.CFBundleShortVersionString} != ${expectedVersion}`,
	);
}

const docTypes = Array.isArray(plist.CFBundleDocumentTypes) ? plist.CFBundleDocumentTypes : [];
const noveliveDoc = docTypes.find(
	(entry) =>
		entry &&
		Array.isArray(entry.CFBundleTypeExtensions) &&
		entry.CFBundleTypeExtensions.includes("novelive"),
);

if (!noveliveDoc) {
	throw new Error("CFBundleDocumentTypes does not include extension 'novelive'");
}

fs.writeFileSync(
	outPath,
	JSON.stringify(
		{
			bundleIdentifier: plist.CFBundleIdentifier,
			bundleName: plist.CFBundleName,
			bundleShortVersionString: plist.CFBundleShortVersionString,
			noveliveDocumentType: noveliveDoc,
		},
		null,
		2,
	),
);
NODE
then
	ERROR_MESSAGE="Info.plist .novelive CFBundleDocumentTypes assertion failed"
	record_step 3 "info-plist-association" "failed" "$ERROR_MESSAGE"
	exit 1
fi

record_step 3 "info-plist-association" "passed" "Verified Info.plist CFBundleDocumentTypes declares .novelive"

# ---------------------------------------------------------------------------
# Step 4: Verify LICENSE.txt and THIRD_PARTY_NOTICES.txt in app resources
# ---------------------------------------------------------------------------
RESOURCES_DIR="$APP_PATH/Contents/Resources"
if ! node - "$RESOURCES_DIR" "$LICENSES_JSON" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [resourcesDir, outPath] = process.argv.slice(2);
const checks = [
	{ rel: "licenses/LICENSE.txt", patterns: [/GNU AFFERO GENERAL PUBLIC LICENSE/i] },
	{ rel: "licenses/THIRD_PARTY_NOTICES.txt", patterns: [/LICENSES\.chromium\.html/, /electron-updater@/] },
	{ rel: "app-update.yml", patterns: [/provider:\s*generic/i] },
	{ rel: "LICENSE.electron.txt", patterns: [/Electron/i] },
	{ rel: "LICENSES.chromium.html", patterns: [/<html/i] },
];

const found = [];
for (const check of checks) {
	const full = path.join(resourcesDir, check.rel);
	const st = fs.statSync(full, { throwIfNoEntry: false });
	if (!st || !st.isFile() || st.size === 0) {
		throw new Error(`Missing or empty app resource: ${full}`);
	}
	const text = fs.readFileSync(full, "utf8");
	for (const pattern of check.patterns) {
		if (!pattern.test(text)) {
			throw new Error(`Unexpected content in ${full} (expected ${pattern})`);
		}
	}
	found.push({ path: check.rel, size: st.size });
}

const electronLicenses = [];
fs.writeFileSync(outPath, JSON.stringify([...found, ...electronLicenses], null, 2));
NODE
then
	ERROR_MESSAGE="Required license files missing or invalid in $RESOURCES_DIR"
	record_step 4 "app-licenses" "failed" "$ERROR_MESSAGE"
	exit 1
fi

record_step 4 "app-licenses" "passed" "Verified LICENSE.txt, THIRD_PARTY_NOTICES.txt, and app-update.yml in $RESOURCES_DIR"

# ---------------------------------------------------------------------------
# Step 5 & 6: Launch copied app binary with fixture .novelive, throwaway
#             HOME/user-data dir, NL_REPLAY=strict, verify offline playback,
#             update-metadata check, and unsigned manual-update prompt branch
# ---------------------------------------------------------------------------
THROWAWAY_HOME="$TEMP_ROOT/home"
mkdir -p "$THROWAWAY_HOME/Documents"

export NL_REPLAY="strict"
export NL_M5_EXECUTABLE="$APP_BINARY"
export NL_M5_UPDATE_METADATA="$LATEST_MAC_YML"
export NL_M5_HOME="$THROWAWAY_HOME"
export NL_M5_PACKAGED_REPORT="$PACKAGED_REPORT"

if ! (cd "$REPO_ROOT" && pnpm exec playwright test tests/e2e/m5-packaged.spec.ts); then
	PACKAGED_SPEC_STATUS="failed"
	ERROR_MESSAGE="Packaged smoke spec tests/e2e/m5-packaged.spec.ts failed"
	record_step 5 "packaged-runtime-and-playback" "failed" "$ERROR_MESSAGE"
	exit 1
fi
PACKAGED_SPEC_STATUS="passed"
record_step 5 "packaged-runtime-and-playback" "passed" "Verified fixture .novelive import, offline playback, about/licenses, and latest-mac.yml check"

if ! node -e '
	const fs = require("node:fs");
	const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
	if (!report.manualPromptMessage || !report.manualPromptUrl) {
		throw new Error("Manual update prompt was not recorded in packaged report");
	}
	if (report.installerDownloadsAttempted !== 0) {
		throw new Error(`Expected 0 installer downloads, got ${report.installerDownloadsAttempted}`);
	}
' "$PACKAGED_REPORT"; then
	ERROR_MESSAGE="Unsigned macOS manual-update prompt check did not match expected policy"
	record_step 6 "unsigned-manual-update-prompt" "failed" "$ERROR_MESSAGE"
	exit 1
fi
MANUAL_PROMPT_VERIFIED=1
record_step 6 "unsigned-manual-update-prompt" "passed" "Verified unsigned macOS update check prompts manual download without auto-downloading"

if [[ "$SKIP_SHARE_E2E" != "1" ]]; then
	if ! (cd "$REPO_ROOT" && pnpm exec playwright test tests/e2e/m5-share.spec.ts); then
		SHARE_E2E_STATUS="failed"
		ERROR_MESSAGE="Share and migration E2E spec tests/e2e/m5-share.spec.ts failed"
		record_step 6 "share-e2e-replay" "failed" "$ERROR_MESSAGE"
		exit 1
	fi
	SHARE_E2E_STATUS="passed"
	record_step 6 "share-e2e-replay" "passed" "Verified tests/e2e/m5-share.spec.ts against packaged binary"
else
	SHARE_E2E_STATUS="skipped"
fi
# ---------------------------------------------------------------------------
# Step 7: Detach DMG explicitly (cleanup trap also guards this)
# ---------------------------------------------------------------------------
detach_dmg
if [[ "$DMG_MOUNTED" -ne 0 ]]; then
	ERROR_MESSAGE="Failed to detach DMG mountpoint $MOUNT_POINT"
	record_step 7 "detach-dmg" "failed" "$ERROR_MESSAGE"
	exit 1
fi
record_step 7 "detach-dmg" "passed" "Detached $MOUNT_POINT cleanly"

OVERALL_STATUS="passed"
echo "macOS package verification PASSED."
