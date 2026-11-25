<#
.SYNOPSIS
    Verifies the Windows NSIS package built by `pnpm --filter @novelive/desktop run package:windows`.

.DESCRIPTION
    Intended to run on a GitHub Actions `windows-2025` runner after `package:windows`.
    Performs real native verification:
      1. Verifies NSIS installer .exe, latest.yml, BUILD.txt, and SHA256SUMS exist,
         all SHA256SUMS digests match, and latest.yml version/sha512 match the installer.
      2. Silently installs the NSIS package (`/S /D=<temp dir>`).
      3. Verifies `.novelive` file association, ProgID, shell\open\command, and Uninstall
         registry keys created by NSIS in HKCU/HKLM.
      4. Verifies LICENSE.txt, THIRD_PARTY_NOTICES.txt, LICENSE.electron.txt, and
         LICENSES.chromium.html in the installation directory.
      5. Launches the installed Novelive.exe with a fixture `.novelive` package,
         throwaway user-data dir, NL_REPLAY=strict, and a local update feed serving
         latest.yml to verify import, offline playback, notices, and update-metadata
         checks (via Playwright `tests/e2e/m5-packaged.spec.ts` and `tests/e2e/m5-share.spec.ts`).
      6. Silently uninstalls (`Uninstall Novelive.exe /S`), waits for NSIS background
         cleanup (`Au_.exe`) to complete, and verifies clean removal of the install
         directory and registry keys.

    Writes a machine-readable JSON summary (default: `$env:RUNNER_TEMP\windows-package-verification.json`).

.PARAMETER ArtifactsDir
    Path to the `artifacts` directory produced by `tools/package/build.mjs`.
    Defaults to the newest `apps/desktop/dist/win32-*/artifacts` directory.

.PARAMETER InstallDir
    Temporary installation directory passed to NSIS `/D=`. Must not contain spaces.
    Defaults to a space-free temporary directory under `$env:RUNNER_TEMP` or system temp.

.PARAMETER SummaryPath
    Output path for the JSON verification summary.
    Defaults to `$env:RUNNER_TEMP\windows-package-verification.json` (or system temp).

.PARAMETER SkipShareE2E
    If specified, runs `tests/e2e/m5-packaged.spec.ts` only and skips the full
    multi-instance author/reader migration suite in `tests/e2e/m5-share.spec.ts`.

.EXAMPLE
    # Exact invocation for .github/workflows/package.yml (on windows-2025 after `package:windows`):
    #
    #   - name: Verify Windows NSIS package
    #     if: matrix.platform == 'windows'
    #     shell: pwsh
    #     run: ./scripts/ci/verify-windows-package.ps1
    #
    # Optional explicit arguments:
    #   pwsh -NoProfile -File scripts/ci/verify-windows-package.ps1 -ArtifactsDir apps/desktop/dist/win32-x64-xxxxxx/artifacts
#>

[CmdletBinding()]
param(
    [string]$ArtifactsDir,
    [string]$InstallDir,
    [string]$SummaryPath,
    [switch]$SkipShareE2E
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$desktopPackageJson = Join-Path $repoRoot 'apps\desktop\package.json'
if (-not (Test-Path -LiteralPath $desktopPackageJson)) {
    throw "Cannot locate apps/desktop/package.json from repo root: $repoRoot"
}

function Get-BaseTempRoot {
    $candidates = @()
    if ($env:RUNNER_TEMP) { $candidates += $env:RUNNER_TEMP }
    $candidates += [System.IO.Path]::GetTempPath()
    if ($env:SystemDrive) { $candidates += "$($env:SystemDrive)\" }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate) -and -not $candidate.Contains(' ')) {
            return $candidate.TrimEnd('\')
        }
    }
    return [System.IO.Path]::GetTempPath().TrimEnd('\')
}

$baseTemp = Get-BaseTempRoot
if (-not $SummaryPath) {
    $summaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
    $SummaryPath = Join-Path $summaryRoot 'windows-package-verification.json'
}
if (-not $InstallDir) {
    $InstallDir = Join-Path $baseTemp ("nl-win-install-$PID-" + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
}
if ($InstallDir.Contains(' ')) {
    throw "InstallDir must not contain spaces because NSIS /D= cannot safely parse quoted paths: $InstallDir"
}

$osInfo = $null
try {
    $osInfo = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
} catch {
    $osInfo = $null
}

$summary = [ordered]@{
    platform = 'windows'
    verifiedAt = [DateTimeOffset]::UtcNow.ToString('o')
    status = 'running'
    error = $null
    runner = [ordered]@{
        osCaption = if ($osInfo) { $osInfo.Caption } else { [System.Environment]::OSVersion.VersionString }
        osVersion = if ($osInfo) { $osInfo.Version } else { [System.Environment]::OSVersion.Version.ToString() }
        osBuild = if ($osInfo) { $osInfo.BuildNumber } else { [System.Environment]::OSVersion.Version.Build.ToString() }
        architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        powershellVersion = $PSVersionTable.PSVersion.ToString()
    }
    expectedVersion = $null
    artifactsDir = $null
    artifacts = @()
    latestYml = $null
    install = [ordered]@{
        installDir = $InstallDir
        executable = $null
        uninstaller = $null
        registryHives = @()
        progId = $null
        openCommand = $null
        uninstallRegistryKeys = @()
        licenses = @()
    }
    runtimeVerification = [ordered]@{
        packagedSpec = 'not-run'
        shareE2ESpec = 'not-run'
        updateMetadataChecked = $false
    }
    uninstall = [ordered]@{
        exitCode = $null
        installDirRemoved = $false
        registryRemoved = $false
    }
    steps = @()
}

function Add-StepResult {
    param(
        [int]$Step,
        [string]$Name,
        [string]$Status,
        [string]$Detail
    )
    $summary.steps += [ordered]@{
        step = $Step
        name = $Name
        status = $Status
        detail = $Detail
    }
    $label = if ($Status -eq 'passed') { 'PASS' } else { 'FAIL' }
    Write-Host "[STEP $Step/6] [$label] $Name - $Detail"
}

function Unquote-YamlScalar {
    param([string]$Value)
    $trimmed = $Value.Trim()
    if ($trimmed.Length -ge 2) {
        if (($trimmed.StartsWith("'") -and $trimmed.EndsWith("'")) -or ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"'))) {
            return $trimmed.Substring(1, $trimmed.Length - 2)
        }
    }
    return $trimmed
}

function Parse-LatestYml {
    param([string]$Path)
    $lines = Get-Content -LiteralPath $Path -Encoding UTF8
    $result = [ordered]@{
        version = $null
        path = $null
        sha512 = $null
        releaseDate = $null
        files = @()
    }
    $inFiles = $false
    $currentFile = $null

    foreach ($rawLine in $lines) {
        $line = $rawLine -replace "`r$", ''
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
            continue
        }
        if ($line -match '^files:\s*$') {
            $inFiles = $true
            continue
        }
        if ($inFiles) {
            if ($line -match '^\s*-\s+([A-Za-z0-9_]+):\s*(.*)$') {
                if ($currentFile) { $result.files += $currentFile }
                $currentFile = [ordered]@{}
                $currentFile[$matches[1]] = Unquote-YamlScalar $matches[2]
                continue
            }
            if ($line -match '^\s{2,}([A-Za-z0-9_]+):\s*(.*)$' -and $currentFile) {
                $currentFile[$matches[1]] = Unquote-YamlScalar $matches[2]
                continue
            }
            if ($currentFile) {
                $result.files += $currentFile
                $currentFile = $null
            }
            $inFiles = $false
        }
        if ($line -match '^([A-Za-z0-9_]+):\s*(.*)$') {
            $key = $matches[1]
            $val = Unquote-YamlScalar $matches[2]
            if ($result.Contains($key)) {
                $result[$key] = $val
            }
        }
    }
    if ($currentFile) {
        $result.files += $currentFile
    }
    return $result
}

function Get-FileSha512Base64 {
    param([string]$Path)
    $sha512 = [System.Security.Cryptography.SHA512]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $hashBytes = $sha512.ComputeHash($stream)
        return [Convert]::ToBase64String($hashBytes)
    } finally {
        $stream.Dispose()
        $sha512.Dispose()
    }
}

function Get-RegistryDefaultValue {
    param([string]$RegistryPath)
    if (-not (Test-Path -LiteralPath $RegistryPath)) { return $null }
    $item = Get-Item -LiteralPath $RegistryPath
    try {
        return $item.GetValue('', $null)
    } finally {
        $item.Dispose()
    }
}

function Get-RegistryNamedValue {
    param([string]$RegistryPath, [string]$Name)
    if (-not (Test-Path -LiteralPath $RegistryPath)) { return $null }
    $item = Get-Item -LiteralPath $RegistryPath
    try {
        return $item.GetValue($Name, $null)
    } finally {
        $item.Dispose()
    }
}

function Get-RunningProcessInDir {
    param([string]$Directory)
    $normalized = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'
    $matches = @()
    foreach ($proc in (Get-Process -ErrorAction SilentlyContinue)) {
        try {
            $exePath = $proc.Path
            if ($exePath -and $exePath.StartsWith($normalized, [System.StringComparison]::OrdinalIgnoreCase)) {
                $matches += $proc
            }
        } catch {
            # Ignore processes whose path cannot be queried (System/Idle/elevated)
        }
    }
    return $matches
}

$installedExe = $null
$uninstallerExe = $null
$recordedProgIdKeys = @()
$recordedOpenWithEntries = @()
$recordedUninstallKeys = @()
$savedEnv = @{}

try {
    # -------------------------------------------------------------------------
    # Step 1: Verify artifacts, SHA256SUMS, and latest.yml
    # -------------------------------------------------------------------------
    $stepName = 'artifacts-and-checksums'
    try {
        $pkg = Get-Content -LiteralPath $desktopPackageJson -Raw -Encoding UTF8 | ConvertFrom-Json
        $expectedVersion = [string]$pkg.version
        if (-not $expectedVersion) {
            throw 'apps/desktop/package.json is missing version'
        }
        $summary.expectedVersion = $expectedVersion

        if (-not $ArtifactsDir) {
            $distDir = Join-Path $repoRoot 'apps\desktop\dist'
            if (-not (Test-Path -LiteralPath $distDir)) {
                throw "Missing dist directory (run package:windows first): $distDir"
            }
            $candidates = @(Get-ChildItem -LiteralPath $distDir -Directory -Filter 'win32-*' |
                ForEach-Object { Join-Path $_.FullName 'artifacts' } |
                Where-Object { Test-Path -LiteralPath $_ } |
                ForEach-Object { Get-Item -LiteralPath $_ } |
                Sort-Object -Property LastWriteTimeUtc -Descending)
            if ($candidates.Count -eq 0) {
                throw "No win32-*/artifacts directory found under $distDir"
            }
            $ArtifactsDir = $candidates[0].FullName
        } else {
            $ArtifactsDir = (Resolve-Path -LiteralPath $ArtifactsDir).Path
        }
        $summary.artifactsDir = $ArtifactsDir

        $sha256Path = Join-Path $ArtifactsDir 'SHA256SUMS'
        $latestYmlPath = Join-Path $ArtifactsDir 'latest.yml'
        $buildTxtPath = Join-Path $ArtifactsDir 'BUILD.txt'

        foreach ($required in @($sha256Path, $latestYmlPath, $buildTxtPath)) {
            if (-not (Test-Path -LiteralPath $required)) {
                throw "Missing required artifact file: $required"
            }
        }

        $buildTxt = Get-Content -LiteralPath $buildTxtPath -Raw -Encoding UTF8
        if ($buildTxt -notmatch ("Novelive " + [regex]::Escape($expectedVersion)) -or $buildTxt -notmatch 'Target:\s*win32/') {
            throw "BUILD.txt does not match expected version/target: $buildTxt"
        }

        $exeCandidates = @(Get-ChildItem -LiteralPath $ArtifactsDir -File -Filter '*.exe' |
            Where-Object { $_.Name -notlike 'Uninstall*' })
        if ($exeCandidates.Count -ne 1) {
            throw "Expected exactly 1 NSIS installer .exe in $ArtifactsDir, found $($exeCandidates.Count)"
        }
        $installerExe = $exeCandidates[0]

        $checksumLines = @(Get-Content -LiteralPath $sha256Path -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($checksumLines.Count -eq 0) {
            throw "SHA256SUMS is empty: $sha256Path"
        }
        $verifiedChecksums = @{}
        foreach ($line in $checksumLines) {
            if ($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
                throw "Malformed SHA256SUMS line: $line"
            }
            $expectedHash = $matches[1].ToLowerInvariant()
            $fileName = $matches[2].Trim()
            $targetFile = Join-Path $ArtifactsDir $fileName
            if (-not (Test-Path -LiteralPath $targetFile)) {
                throw "File listed in SHA256SUMS does not exist: $targetFile"
            }
            $actualHash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualHash -ne $expectedHash) {
                throw "SHA-256 mismatch for ${fileName}: expected $expectedHash, got $actualHash"
            }
            $fileInfo = Get-Item -LiteralPath $targetFile
            $artifactEntry = [ordered]@{
                name = $fileName
                size = $fileInfo.Length
                sha256 = $actualHash
            }
            if ($fileName -eq $installerExe.Name) {
                $artifactEntry['sha512'] = Get-FileSha512Base64 -Path $targetFile
            }
            $summary.artifacts += $artifactEntry
            $verifiedChecksums[$fileName] = $actualHash
        }

        if (-not $verifiedChecksums.ContainsKey($installerExe.Name)) {
            throw "Installer $($installerExe.Name) is missing from SHA256SUMS"
        }
        if (-not $verifiedChecksums.ContainsKey('latest.yml')) {
            throw 'latest.yml is missing from SHA256SUMS'
        }

        $latest = Parse-LatestYml -Path $latestYmlPath
        $summary.latestYml = $latest
        if ($latest.version -ne $expectedVersion) {
            throw "latest.yml version mismatch: expected '$expectedVersion', got '$($latest.version)'"
        }
        if ($latest.path -ne $installerExe.Name) {
            throw "latest.yml path mismatch: expected '$($installerExe.Name)', got '$($latest.path)'"
        }
        $actualSha512 = Get-FileSha512Base64 -Path $installerExe.FullName
        if ($latest.sha512 -ne $actualSha512) {
            throw "latest.yml sha512 mismatch for $($installerExe.Name)"
        }
        $matchingFileEntry = @($latest.files | Where-Object { $_.Contains('url') -and $_.url -eq $installerExe.Name })
        if ($matchingFileEntry.Count -eq 0) {
            throw "latest.yml files[] does not list $($installerExe.Name)"
        }
        if (-not $matchingFileEntry[0].Contains('sha512') -or $matchingFileEntry[0].sha512 -ne $actualSha512) {
            throw "latest.yml files[0].sha512 mismatch for $($installerExe.Name)"
        }
        if ($matchingFileEntry[0].Contains('size') -and [int64]$matchingFileEntry[0].size -ne $installerExe.Length) {
            throw "latest.yml files[0].size mismatch: expected $($installerExe.Length), got $($matchingFileEntry[0].size)"
        }
        Add-StepResult -Step 1 -Name $stepName -Status 'passed' -Detail "Verified $($installerExe.Name) (v$expectedVersion), latest.yml, and $($verifiedChecksums.Count) SHA256SUMS entries"
    } catch {
        Add-StepResult -Step 1 -Name $stepName -Status 'failed' -Detail $_.Exception.Message
        throw
    }

    # -------------------------------------------------------------------------
    # Step 2: Silent NSIS install (/S /D=<temp dir>)
    # -------------------------------------------------------------------------
    $stepName = 'nsis-silent-install'
    try {
        if (Test-Path -LiteralPath $InstallDir) {
            Remove-Item -LiteralPath $InstallDir -Recurse -Force
        }
        $installProc = Start-Process -FilePath $installerExe.FullName -ArgumentList "/S /D=$InstallDir" -Wait -PassThru
        if ($installProc.ExitCode -ne 0) {
            throw "NSIS silent install exited with code $($installProc.ExitCode)"
        }

        $installedExe = Join-Path $InstallDir 'Novelive.exe'
        $uninstallerExe = Join-Path $InstallDir 'Uninstall Novelive.exe'
        if (-not (Test-Path -LiteralPath $installedExe)) {
            throw "Installed executable not found at $installedExe"
        }
        if (-not (Test-Path -LiteralPath $uninstallerExe)) {
            throw "Uninstaller not found at $uninstallerExe"
        }
        $summary.install.executable = $installedExe
        $summary.install.uninstaller = $uninstallerExe

        Add-StepResult -Step 2 -Name $stepName -Status 'passed' -Detail "Installed silently to $InstallDir"
    } catch {
        Add-StepResult -Step 2 -Name $stepName -Status 'failed' -Detail $_.Exception.Message
        throw
    }

    # -------------------------------------------------------------------------
    # Step 3: Verify .novelive registry / ProgID / Uninstall entries
    # -------------------------------------------------------------------------
    $stepName = 'registry-file-association'
    try {
        $foundHives = @()
        $normalizedInstall = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
        $normalizedExe = [System.IO.Path]::GetFullPath($installedExe)

        foreach ($hive in @('HKCU', 'HKLM')) {
            $extKey = "${hive}:\Software\Classes\.novelive"
            if (-not (Test-Path -LiteralPath $extKey)) {
                continue
            }
            $foundHives += $hive

            $progId = Get-RegistryDefaultValue -RegistryPath $extKey
            if ([string]::IsNullOrWhiteSpace($progId)) {
                throw "$extKey exists but has empty (Default) ProgID"
            }
            $contentType = Get-RegistryNamedValue -RegistryPath $extKey -Name 'Content Type'
            if ($contentType -and $contentType -ne 'application/vnd.novelive+zip') {
                throw "$extKey Content Type mismatch: expected 'application/vnd.novelive+zip', got '$contentType'"
            }

            $openWithKey = "$extKey\OpenWithProgids"
            if (Test-Path -LiteralPath $openWithKey) {
                $owItem = Get-Item -LiteralPath $openWithKey
                try {
                    if ($owItem.GetValueNames() -contains $progId) {
                        $recordedOpenWithEntries += [ordered]@{ Key = $openWithKey; ValueName = $progId }
                    }
                } finally {
                    $owItem.Dispose()
                }
            }

            $progIdKey = "${hive}:\Software\Classes\$progId"
            if (-not (Test-Path -LiteralPath $progIdKey)) {
                throw "ProgID registry key missing: $progIdKey"
            }
            $recordedProgIdKeys += $progIdKey

            $cmdKey = "$progIdKey\shell\open\command"
            $openCmd = Get-RegistryDefaultValue -RegistryPath $cmdKey
            if ([string]::IsNullOrWhiteSpace($openCmd)) {
                throw "Open command registry value missing at $cmdKey"
            }
            if ($openCmd.IndexOf($normalizedExe, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
                throw "Open command at $cmdKey does not point to ${normalizedExe}: $openCmd"
            }
            if ($openCmd -notmatch '%1') {
                throw "Open command at $cmdKey does not include %1 argument placeholder: $openCmd"
            }

            $summary.install.progId = $progId
            $summary.install.openCommand = $openCmd
        }

        if ($foundHives.Count -eq 0) {
            throw 'Neither HKCU:\Software\Classes\.novelive nor HKLM:\Software\Classes\.novelive was created by NSIS'
        }
        $summary.install.registryHives = $foundHives

        foreach ($hive in @('HKCU', 'HKLM')) {
            $uninstallRoot = "${hive}:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
            if (-not (Test-Path -LiteralPath $uninstallRoot)) { continue }
            foreach ($subKey in (Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue)) {
                try {
                    $displayName = Get-RegistryNamedValue -RegistryPath $subKey.PSPath -Name 'DisplayName'
                    $uninstallString = Get-RegistryNamedValue -RegistryPath $subKey.PSPath -Name 'UninstallString'
                    $installLocation = Get-RegistryNamedValue -RegistryPath $subKey.PSPath -Name 'InstallLocation'
                    $matchesInstall = (
                        ($installLocation -and $installLocation.TrimEnd('\') -ieq $normalizedInstall) -or
                        ($uninstallString -and $uninstallString.IndexOf($normalizedInstall, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -or
                        ($displayName -eq 'Novelive')
                    )
                    if ($matchesInstall) {
                        $recordedUninstallKeys += $subKey.Name
                        $summary.install.uninstallRegistryKeys += $subKey.Name
                    }
                } finally {
                    $subKey.Close()
                }
            }
        }
        if ($recordedUninstallKeys.Count -eq 0) {
            throw 'No Uninstall registry entry found for Novelive after installation'
        }

        Add-StepResult -Step 3 -Name $stepName -Status 'passed' -Detail "Verified .novelive association in $($foundHives -join ',') (ProgID: $($summary.install.progId))"
    } catch {
        Add-StepResult -Step 3 -Name $stepName -Status 'failed' -Detail $_.Exception.Message
        throw
    }

    # -------------------------------------------------------------------------
    # Step 4: Verify LICENSE.txt and THIRD_PARTY_NOTICES.txt in install
    # -------------------------------------------------------------------------
    $stepName = 'install-licenses'
    try {
        $licenseChecks = @(
            @{ RelPath = 'resources\licenses\LICENSE.txt'; Pattern = 'GNU AFFERO GENERAL PUBLIC LICENSE' },
            @{ RelPath = 'resources\licenses\THIRD_PARTY_NOTICES.txt'; Pattern = 'LICENSES\.chromium\.html' },
            @{ RelPath = 'resources\licenses\THIRD_PARTY_NOTICES.txt'; Pattern = 'electron-updater@' },
            @{ RelPath = 'LICENSE.electron.txt'; Pattern = 'Electron' },
            @{ RelPath = 'LICENSES.chromium.html'; Pattern = '<html' }
        )

        $verifiedRelPaths = [System.Collections.Generic.List[string]]::new()
        foreach ($check in $licenseChecks) {
            $fullPath = Join-Path $InstallDir $check.RelPath
            if (-not (Test-Path -LiteralPath $fullPath)) {
                throw "Missing installed license file: $fullPath"
            }
            $content = Get-Content -LiteralPath $fullPath -Raw -Encoding UTF8
            if ([string]::IsNullOrWhiteSpace($content)) {
                throw "Installed license file is empty: $fullPath"
            }
            if ($content -notmatch $check.Pattern) {
                throw "License file $fullPath did not match expected content pattern '$($check.Pattern)'"
            }
            if (-not $verifiedRelPaths.Contains($check.RelPath)) {
                $verifiedRelPaths.Add($check.RelPath)
            }
        }
        $summary.install.licenses = @($verifiedRelPaths)

        Add-StepResult -Step 4 -Name $stepName -Status 'passed' -Detail "Verified $($verifiedRelPaths -join ', ')"
    } catch {
        Add-StepResult -Step 4 -Name $stepName -Status 'failed' -Detail $_.Exception.Message
        throw
    }

    # -------------------------------------------------------------------------
    # Step 5: Launch installed Novelive.exe with fixture .novelive, NL_REPLAY=strict,
    #         throwaway user-data dir, offline playback & update-metadata check
    # -------------------------------------------------------------------------
    $packagedReportPath = Join-Path $baseTemp ("nl-win-packaged-report-$PID-" + [System.Guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
    $stepName = 'packaged-runtime-smoke'
    try {
        $envVarsToSet = @{
            NL_REPLAY = 'strict'
            NL_M5_EXECUTABLE = $installedExe
            NL_M5_UPDATE_METADATA = $latestYmlPath
            NL_M5_PACKAGED_REPORT = $packagedReportPath
        }
        foreach ($key in $envVarsToSet.Keys) {
            $savedEnv[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
            [System.Environment]::SetEnvironmentVariable($key, $envVarsToSet[$key], 'Process')
        }

        Push-Location $repoRoot
        try {
            Write-Host "Running packaged smoke spec against $installedExe..."
            & pnpm exec playwright test tests/e2e/m5-packaged.spec.ts --reporter=list
            if ($LASTEXITCODE -ne 0) {
                throw "Playwright packaged smoke test failed with exit code $LASTEXITCODE"
            }
            $summary.runtimeVerification.packagedSpec = 'passed'
            $summary.runtimeVerification.updateMetadataChecked = $true
            if (Test-Path -LiteralPath $packagedReportPath) {
                $summary.runtimeVerification['packagedReport'] = (Get-Content -LiteralPath $packagedReportPath -Raw -Encoding UTF8 | ConvertFrom-Json)
            }

            if (-not $SkipShareE2E) {
                Write-Host "Running M5 share and offline playback E2E spec against $installedExe..."
                & pnpm exec playwright test tests/e2e/m5-share.spec.ts --reporter=list
                if ($LASTEXITCODE -ne 0) {
                    throw "Playwright m5-share.spec.ts failed with exit code $LASTEXITCODE"
                }
                $summary.runtimeVerification.shareE2ESpec = 'passed'
            } else {
                $summary.runtimeVerification.shareE2ESpec = 'skipped'
            }
        } finally {
            Pop-Location
        }

        # Ensure no Novelive.exe processes hold file locks in $InstallDir before uninstall
        $lockDeadline = [DateTime]::UtcNow.AddSeconds(15)
        while ([DateTime]::UtcNow -lt $lockDeadline) {
            $lingering = @(Get-RunningProcessInDir -Directory $InstallDir)
            if ($lingering.Count -eq 0) { break }
            Start-Sleep -Milliseconds 250
        }
        $remainingProcs = @(Get-RunningProcessInDir -Directory $InstallDir)
        if ($remainingProcs.Count -gt 0) {
            $names = ($remainingProcs | ForEach-Object { "$($_.ProcessName)($($_.Id))" }) -join ', '
            throw "Processes still running from $InstallDir after test exit: $names"
        }

        Add-StepResult -Step 5 -Name $stepName -Status 'passed' -Detail "Verified packaged fixture import, offline playback, notices, and latest.yml update check (shareE2E=$($summary.runtimeVerification.shareE2ESpec))"
    } catch {
        if ($summary.runtimeVerification.packagedSpec -eq 'not-run') {
            $summary.runtimeVerification.packagedSpec = 'failed'
        } elseif (-not $SkipShareE2E -and $summary.runtimeVerification.shareE2ESpec -eq 'not-run') {
            $summary.runtimeVerification.shareE2ESpec = 'failed'
        }
        Add-StepResult -Step 5 -Name $stepName -Status 'failed' -Detail $_.Exception.Message
        throw
    } finally {
        if (Test-Path -LiteralPath $packagedReportPath) {
            Remove-Item -LiteralPath $packagedReportPath -Force -ErrorAction SilentlyContinue
        }
        foreach ($key in $savedEnv.Keys) {
            [System.Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process')
        }
    }

    # -------------------------------------------------------------------------
    # Step 6: Silent uninstall and verify clean removal
    # -------------------------------------------------------------------------
    $stepName = 'nsis-silent-uninstall'
    try {
        $uninstProc = Start-Process -FilePath $uninstallerExe -ArgumentList '/S' -Wait -PassThru
        $summary.uninstall.exitCode = $uninstProc.ExitCode
        if ($uninstProc.ExitCode -ne 0) {
            throw "Silent uninstall exited with code $($uninstProc.ExitCode)"
        }

        # NSIS copies the uninstaller to %TEMP%\~nsu.tmp\Au_.exe and returns immediately
        # so the copy can delete Uninstall Novelive.exe and $InstallDir asynchronously.
        $deadline = [DateTime]::UtcNow.AddSeconds(45)
        $dirRemoved = $false
        $regRemoved = $false
        while ([DateTime]::UtcNow -lt $deadline) {
            $dirExists = Test-Path -LiteralPath $InstallDir
            $anyRegLeft = $false
            foreach ($regPath in $recordedProgIdKeys) {
                if (Test-Path -LiteralPath $regPath) {
                    $anyRegLeft = $true
                    break
                }
            }
            if (-not $anyRegLeft) {
                foreach ($owEntry in $recordedOpenWithEntries) {
                    if (Test-Path -LiteralPath $owEntry.Key) {
                        $owItem = Get-Item -LiteralPath $owEntry.Key
                        try {
                            if ($owItem.GetValueNames() -contains $owEntry.ValueName) {
                                $anyRegLeft = $true
                                break
                            }
                        } finally {
                            $owItem.Dispose()
                        }
                    }
                }
            }
            if (-not $anyRegLeft) {
                foreach ($hive in @('HKCU', 'HKLM')) {
                    $uninstallRoot = "${hive}:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
                    if (-not (Test-Path -LiteralPath $uninstallRoot)) { continue }
                    foreach ($subKey in (Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue)) {
                        try {
                            if ($recordedUninstallKeys -contains $subKey.Name) {
                                $anyRegLeft = $true
                                break
                            }
                        } finally {
                            $subKey.Close()
                        }
                    }
                    if ($anyRegLeft) { break }
                }
            }
            if (-not $dirExists -and -not $anyRegLeft) {
                $dirRemoved = $true
                $regRemoved = $true
                break
            }
            Start-Sleep -Milliseconds 250
        }

        $summary.uninstall.installDirRemoved = $dirRemoved
        $summary.uninstall.registryRemoved = $regRemoved

        if (-not $dirRemoved) {
            $leftover = if (Test-Path -LiteralPath $InstallDir) {
                (Get-ChildItem -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName) -join '; '
            } else {
                ''
            }
            throw "Install directory still exists after silent uninstall: $InstallDir ($leftover)"
        }
        if (-not $regRemoved) {
            $leftKeys = @($recordedProgIdKeys | Where-Object { Test-Path -LiteralPath $_ })
            throw "Registry keys/values still exist after silent uninstall (ProgID keys: $($leftKeys -join ', '))"
        }
        Add-StepResult -Step 6 -Name $stepName -Status 'passed' -Detail "Cleanly uninstalled $InstallDir and removed NSIS registry keys"
    } catch {
        Add-StepResult -Step 6 -Name $stepName -Status 'failed' -Detail $_.Exception.Message
        throw
    }

    $summary.status = 'passed'
    Write-Host "Windows package verification PASSED. Summary: $SummaryPath"
} catch {
    $summary.status = 'failed'
    $summary.error = $_.Exception.Message
    Write-Error "Windows package verification FAILED: $($_.Exception.Message)"
    exit 1
} finally {
    $summaryParent = Split-Path -Parent $SummaryPath
    if ($summaryParent -and -not (Test-Path -LiteralPath $summaryParent)) {
        New-Item -ItemType Directory -Path $summaryParent -Force | Out-Null
    }
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $SummaryPath -Encoding UTF8
    Write-Host "Wrote verification summary to $SummaryPath"
}
