# Windows counterpart to android_build.sh. Builds the debug APK via Gradle.
#
# Usage (from repo root or anywhere):
#   pwsh scripts/mobile-validation/android_build.ps1
#   pwsh scripts/mobile-validation/android_build.ps1 -Task assembleRelease
#
# Respects env vars: JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT.
# Falls back to common Windows JDK/SDK install paths when not set.

param(
    [string]$Task = "assembleDebug"
)

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot   = Resolve-Path (Join-Path $ScriptDir "..\..")
$AndroidDir = Join-Path $RepoRoot "mobile\android"

function Find-Jdk17 {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
        return $env:JAVA_HOME
    }
    $candidates = @(
        "C:\Program Files\Eclipse Adoptium\jdk-17*",
        "C:\Program Files\Java\jdk-17*",
        "C:\Program Files\Microsoft\jdk-17*",
        "C:\Program Files\Zulu\zulu-17*",
        "$env:LOCALAPPDATA\Programs\Eclipse Adoptium\jdk-17*"
    )
    foreach ($pattern in $candidates) {
        $match = Get-ChildItem -Path $pattern -Directory -ErrorAction SilentlyContinue |
                 Sort-Object Name -Descending |
                 Select-Object -First 1
        if ($match) { return $match.FullName }
    }
    return $null
}

function Find-AndroidSdk {
    foreach ($var in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
        if ($var -and (Test-Path $var)) { return $var }
    }
    $candidates = @(
        "$env:LOCALAPPDATA\Android\Sdk",
        "$env:USERPROFILE\AppData\Local\Android\Sdk",
        "C:\Android\Sdk"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

$jdk = Find-Jdk17
if (-not $jdk) {
    Write-Error "[android-build] JDK 17 not found. Install Temurin 17 or set JAVA_HOME."
    exit 1
}
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"
Write-Host "[android-build] JAVA_HOME = $jdk"

$stdoutPath = [System.IO.Path]::GetTempFileName()
$stderrPath = [System.IO.Path]::GetTempFileName()
try {
    $javaProcess = Start-Process `
        -FilePath "$jdk\bin\java.exe" `
        -ArgumentList "-version" `
        -NoNewWindow `
        -Wait `
        -PassThru `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath
    if ($javaProcess.ExitCode -ne 0) {
        $javaError = Get-Content $stderrPath -Raw
        Write-Error "[android-build] java -version failed: $javaError"
        exit $javaProcess.ExitCode
    }
    $javaVersion = ((Get-Content $stderrPath -Raw) + [Environment]::NewLine + (Get-Content $stdoutPath -Raw)).Trim()
}
finally {
    Remove-Item $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
}
Write-Host "[android-build] $($javaVersion.Trim().Split([Environment]::NewLine)[0])"

$sdk = Find-AndroidSdk
if (-not $sdk) {
    Write-Error "[android-build] Android SDK not found. Install via Android Studio or set ANDROID_HOME."
    exit 1
}
$env:ANDROID_HOME     = $sdk
$env:ANDROID_SDK_ROOT = $sdk
Write-Host "[android-build] ANDROID_HOME = $sdk"

if (-not (Test-Path $AndroidDir)) {
    Write-Error "[android-build] Android module missing at $AndroidDir"
    exit 1
}

Push-Location $AndroidDir
try {
    Write-Host "[android-build] Running gradlew $Task ..."
    & .\gradlew.bat --no-daemon $Task
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[android-build] gradle $Task failed with exit $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    $apk = Get-ChildItem -Path (Join-Path $AndroidDir "app\build\outputs\apk") -Recurse -Filter "*.apk" -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending |
           Select-Object -First 1
    if ($apk) {
        Write-Host "[android-build] APK: $($apk.FullName)"
    }
}
finally {
    Pop-Location
}
