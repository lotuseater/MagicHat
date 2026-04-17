# One-command build + deploy script for the MagicHat Android app.
#
# Behavior:
#   1. Builds debug APK via android_build.ps1 (auto-finds JDK 17 + Android SDK).
#   2. Looks for an attached Android device (USB or emulator).
#   3. If a device is attached → `adb install -r` and launch the main activity.
#   4. If no device is attached → print the APK path and pairing instructions.
#
# Usage:
#   pwsh scripts/mobile-validation/build_and_run_android.ps1
#   pwsh scripts/mobile-validation/build_and_run_android.ps1 -SkipBuild
#   pwsh scripts/mobile-validation/build_and_run_android.ps1 -HostUrl http://192.168.1.50:18765
#
# Optional: pass -HostUrl to pre-fill the pairing screen (only honored if the
# app supports an intent extra; otherwise informational).

param(
    [switch]$SkipBuild,
    [string]$HostUrl = "",
    [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot   = Resolve-Path (Join-Path $ScriptDir "..\..")
$AndroidDir = Join-Path $RepoRoot "mobile\android"
$ApkPath    = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
$PackageId  = "com.magichat.mobile"
$MainActivity = "$PackageId/.MainActivity"

function Find-AndroidSdk {
    foreach ($var in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
        if ($var -and (Test-Path $var)) { return $var }
    }
    $candidates = @(
        "$env:LOCALAPPDATA\Android\Sdk",
        "$env:USERPROFILE\AppData\Local\Android\Sdk",
        "C:\Android\Sdk"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$sdk = Find-AndroidSdk
if (-not $sdk) {
    Write-Error "[deploy] Android SDK not found. Set ANDROID_HOME or install via Android Studio."
    exit 1
}
$adb = Join-Path $sdk "platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
    Write-Error "[deploy] adb.exe not found at $adb"
    exit 1
}

# -- Step 1: Build --
if (-not $SkipBuild) {
    Write-Host "[deploy] Building debug APK..." -ForegroundColor Cyan
    & (Join-Path $ScriptDir "android_build.ps1")
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[deploy] Build failed with exit $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} else {
    Write-Host "[deploy] -SkipBuild set; using existing APK if present." -ForegroundColor Yellow
}

if (-not (Test-Path $ApkPath)) {
    Write-Error "[deploy] APK not found at $ApkPath. Rerun without -SkipBuild."
    exit 1
}
$apkSize = [math]::Round((Get-Item $ApkPath).Length / 1MB, 2)
Write-Host "[deploy] APK ready: $ApkPath ($apkSize MB)" -ForegroundColor Green

# -- Step 2: Detect devices --
Write-Host "[deploy] Scanning for attached Android devices..."
$devicesOutput = & $adb devices 2>&1
$deviceLines = $devicesOutput |
    Select-Object -Skip 1 |
    Where-Object { $_ -match "^\S+\s+device$" }

if (-not $deviceLines -or $deviceLines.Count -eq 0) {
    Write-Host ""
    Write-Host "[deploy] No devices attached." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To install manually:"
    Write-Host "  1. Connect phone via USB (enable USB debugging in Developer Options)"
    Write-Host "     OR boot an emulator:  $sdk\emulator\emulator.exe -avd <avd-name>"
    Write-Host "  2. Rerun this script with -SkipBuild, or install by hand:"
    Write-Host "       $adb install -r `"$ApkPath`""
    Write-Host "       $adb shell am start -n $MainActivity"
    if ($HostUrl) {
        Write-Host "  3. In the app pairing screen, enter host URL: $HostUrl"
    }
    exit 0
}

# -- Step 3: Install on first available device --
$firstDevice = ($deviceLines[0] -split "\s+")[0]
Write-Host "[deploy] Target device: $firstDevice" -ForegroundColor Cyan

Write-Host "[deploy] Installing APK..."
& $adb -s $firstDevice install -r $ApkPath
if ($LASTEXITCODE -ne 0) {
    Write-Error "[deploy] adb install failed with exit $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "[deploy] Launching $MainActivity..."
& $adb -s $firstDevice shell am start -n $MainActivity 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Warning "[deploy] am start exited with $LASTEXITCODE. App is installed; launch manually from the home screen."
}

if ($HostUrl) {
    Write-Host ""
    Write-Host "[deploy] When the pairing screen appears, enter:" -ForegroundColor Cyan
    Write-Host "    Host URL     : $HostUrl"
    Write-Host "    Pairing code : run  node $RepoRoot\..\..\MagicHat\scripts\print_pairing_code.js"
} else {
    Write-Host ""
    Write-Host "[deploy] Installed + launched on $firstDevice." -ForegroundColor Green
    Write-Host "[deploy] Enter host URL (e.g. http://10.0.2.2:18765 for emulator, or your PC's LAN IP:18765)"
    Write-Host "[deploy] Fetch pairing code any time:  node `"$RepoRoot\scripts\print_pairing_code.js`""
}

if ($KeepRunning) {
    Write-Host ""
    Write-Host "[deploy] Tailing device logcat for com.magichat.app (Ctrl+C to stop)..." -ForegroundColor Cyan
    & $adb -s $firstDevice logcat --pid (& $adb -s $firstDevice shell pidof $PackageId)
}
