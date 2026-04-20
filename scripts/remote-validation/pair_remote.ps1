#Requires -Version 5.1
# Single-action remote QR pairing on PC.
# Starts the loopback relay + host, opens the pairing QR in the default viewer,
# then watches for the phone's claim and prompts once to approve it.

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

$RelayPort = if ($env:MAGICHAT_RELAY_PORT) { $env:MAGICHAT_RELAY_PORT } else { '18795' }
$HostPort  = if ($env:MAGICHAT_PORT)       { $env:MAGICHAT_PORT }       else { '18765' }
$RelayBindHost = if ($env:MAGICHAT_RELAY_BIND_HOST) { $env:MAGICHAT_RELAY_BIND_HOST } else { '0.0.0.0' }
$RelayLocalUrl  = "http://127.0.0.1:$RelayPort"
$HostUrl   = "http://127.0.0.1:$HostPort"
$AdminBase = "$HostUrl/admin/v2/remote"

$LogDir = Join-Path $env:TEMP 'magichat_pair_remote'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$RelayLog = Join-Path $LogDir 'relay.log'
$HostLog  = Join-Path $LogDir 'host.log'
$SvgPath  = Join-Path $LogDir 'pair_qr.svg'

function Find-TeamAppCommand($repoRoot) {
    if ($env:MAGICHAT_TEAM_APP_CMD -and (Test-Path $env:MAGICHAT_TEAM_APP_CMD)) {
        return @{
            Command = (Resolve-Path $env:MAGICHAT_TEAM_APP_CMD).Path
            Cwd = if ($env:MAGICHAT_TEAM_APP_CWD) { $env:MAGICHAT_TEAM_APP_CWD } else { $null }
        }
    }

    $wizardRepo = Join-Path (Split-Path -Parent $repoRoot) 'Wizard_Erasmus'
    $candidates = @(
        (Join-Path $wizardRepo 'build\wizard_team_app.exe'),
        (Join-Path $wizardRepo 'build\wizard_team_app_console.exe'),
        (Join-Path $wizardRepo 'build\Release\wizard_team_app.exe'),
        (Join-Path $wizardRepo 'build\Debug\wizard_team_app.exe'),
        (Join-Path $wizardRepo 'build\src\team_app\wizard_team_app.exe'),
        (Join-Path $wizardRepo 'build\src\team_app\Release\wizard_team_app.exe'),
        (Join-Path $wizardRepo 'build\src\team_app\Debug\wizard_team_app.exe')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return @{
                Command = (Resolve-Path $candidate).Path
                Cwd = $wizardRepo
            }
        }
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
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Get-FirstAdbDeviceSerial($adbPath) {
    if (-not $adbPath -or -not (Test-Path $adbPath)) {
        return $null
    }

    $deviceLines = @(
        & $adbPath devices 2>&1 |
            Select-Object -Skip 1 |
            Where-Object { $_ -match "^\S+\s+device$" }
    )
    if (-not $deviceLines) {
        return $null
    }

    return [regex]::Match($deviceLines[0], "^(?<serial>\S+)\s+device$").Groups["serial"].Value
}

function Get-LanAdvertiseHost {
    if ($env:MAGICHAT_RELAY_ADVERTISE_HOST) {
        return $env:MAGICHAT_RELAY_ADVERTISE_HOST
    }

    $route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Sort-Object RouteMetric, InterfaceMetric |
        Select-Object -First 1
    if ($route) {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
            Where-Object {
                $_.IPAddress -and
                $_.IPAddress -notlike '169.254.*' -and
                $_.IPAddress -ne '127.0.0.1'
            } |
            Select-Object -ExpandProperty IPAddress -First 1
        if ($ip) { return $ip }
    }

    $fallback = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.IPAddress -ne '127.0.0.1' -and
            $_.PrefixOrigin -ne 'WellKnown'
        } |
        Select-Object -ExpandProperty IPAddress -First 1
    if ($fallback) { return $fallback }

    throw "No LAN IPv4 address detected. Set MAGICHAT_RELAY_ADVERTISE_HOST to your PC's reachable IP."
}

$sdk = Find-AndroidSdk
$adb = if ($sdk) { Join-Path $sdk "platform-tools\adb.exe" } else { $null }
$adbSerial = Get-FirstAdbDeviceSerial $adb
$UseAdbReverse = [bool]$adbSerial -and -not $env:MAGICHAT_RELAY_ADVERTISE_HOST
$RelayAdvertiseHost = if ($UseAdbReverse) { "127.0.0.1" } else { Get-LanAdvertiseHost }
$RelayAdvertiseUrl = "http://$RelayAdvertiseHost`:$RelayPort"
$TeamApp = Find-TeamAppCommand $RepoRoot

Write-Host "[pair_remote] relay local      : $RelayLocalUrl"
Write-Host "[pair_remote] relay advertised : $RelayAdvertiseUrl"
if ($UseAdbReverse) {
    Write-Host "[pair_remote] transport       : adb reverse ($adbSerial)"
} else {
    Write-Host "[pair_remote] transport       : lan"
}
Write-Host "[pair_remote] host   : $HostUrl"
if ($TeamApp) {
    Write-Host "[pair_remote] team app cmd    : $($TeamApp.Command)"
} else {
    Write-Host "[pair_remote] team app cmd    : <not found>" -ForegroundColor Yellow
}
Write-Host "[pair_remote] logs   : $LogDir"
Write-Host ""

function Test-HttpUp($url) {
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $url | Out-Null
        return $true
    } catch { return $false }
}

function Wait-HttpUp($url, $label, $timeoutSec = 45) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpUp $url) { Write-Host "[pair_remote] $label up"; return }
        Start-Sleep -Milliseconds 500
    }
    throw "$label not reachable at $url after $timeoutSec s - check $LogDir"
}

function Stop-ProcessesListeningOnPort($port, $label) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) { return }

    $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($listenerPid in $pids) {
        if (-not $listenerPid -or $listenerPid -eq $PID) { continue }
        try {
            Write-Host "[pair_remote] stopping $label listener on port $port (pid=$listenerPid)" -ForegroundColor Yellow
            Stop-Process -Id $listenerPid -Force -ErrorAction Stop
        } catch {
            throw "Failed to stop ${label} listener pid=${listenerPid} on port ${port}: $($_.Exception.Message)"
        }
    }
    Start-Sleep -Milliseconds 500
}

function Resolve-ApprovalTarget($adminBase, $originalClaim) {
    try {
        $latest = Invoke-RestMethod -Uri "$adminBase/pending-devices"
    } catch {
        return $originalClaim
    }

    $pending = @($latest.pending_approvals) | Where-Object { $_ -and $_.status -eq 'pending' }
    $sameDevice = $pending | Where-Object {
        $_.device_name -eq $originalClaim.device_name -and
        $_.platform -eq $originalClaim.platform
    } | Sort-Object created_at_ms -Descending

    if ($sameDevice) {
        return $sameDevice[0]
    }

    return $originalClaim
}

function Ensure-AdvertisedRelayReachable {
    if (-not (Test-HttpUp "$RelayAdvertiseUrl/healthz")) {
        Write-Host "[pair_remote] relay is loopback-only; restarting it with LAN-visible bind" -ForegroundColor Yellow
        Stop-ProcessesListeningOnPort -port $RelayPort -label "relay"
    }
}

function Start-NpmService($cwd, $envVars, $logFile) {
    foreach ($k in $envVars.Keys) { Set-Item "env:$k" $envVars[$k] }
    return Start-Process -FilePath 'cmd.exe' `
        -ArgumentList @('/c', 'npm start') `
        -WorkingDirectory $cwd `
        -WindowStyle Hidden `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError  "$logFile.err" `
        -PassThru
}

function Ensure-AdbReverse($adbPath, $serial, $port) {
    if (-not $adbPath -or -not $serial) {
        return
    }

    & $adbPath -s $serial reverse "tcp:$port" "tcp:$port" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "adb reverse failed for $serial on port $port"
    }
}

function Test-AdbReachability($adbPath, $serial, $targetHost, $port) {
    if (-not $adbPath -or -not $serial) {
        return $false
    }

    $result = & $adbPath -s $serial shell "toybox nc -z $targetHost $port; echo EXIT:`$?" 2>&1
    return ($result | Out-String) -match "EXIT:0"
}

$children = New-Object System.Collections.ArrayList
function Stop-Children {
    foreach ($p in $script:children) {
        if ($p -and -not $p.HasExited) {
            try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
}

try {
    if ($UseAdbReverse) {
        Ensure-AdbReverse -adbPath $adb -serial $adbSerial -port $RelayPort
        if (-not (Test-AdbReachability -adbPath $adb -serial $adbSerial -targetHost "127.0.0.1" -port $RelayPort)) {
            throw "adb reverse is configured for $adbSerial, but the device still cannot reach 127.0.0.1:$RelayPort"
        }
    }

    if (Test-HttpUp "$RelayLocalUrl/healthz") {
        Write-Host "[pair_remote] relay already running - reusing"
        Ensure-AdvertisedRelayReachable
    }
    if (-not (Test-HttpUp "$RelayLocalUrl/healthz")) {
        $relayProc = Start-NpmService (Join-Path $RepoRoot 'relay') @{
            MAGICHAT_RELAY_BIND_HOST           = $RelayBindHost
            MAGICHAT_RELAY_PORT                = $RelayPort
            MAGICHAT_RELAY_ALLOW_INSECURE_HTTP = '1'
        } $RelayLog
        [void]$children.Add($relayProc)
        Wait-HttpUp "$RelayLocalUrl/healthz" 'relay'
        if (-not (Test-HttpUp "$RelayAdvertiseUrl/healthz")) {
            throw "Relay started on $RelayLocalUrl but is still not reachable on $RelayAdvertiseUrl. Check firewall or set MAGICHAT_RELAY_ADVERTISE_HOST explicitly."
        }
    }

    if (-not $TeamApp) {
        throw "Team App binary not found. Set MAGICHAT_TEAM_APP_CMD or build Wizard_Erasmus\\build\\wizard_team_app.exe first."
    }

    if (Test-HttpUp "$HostUrl/healthz") {
        $status = Invoke-RestMethod -Uri "$AdminBase/status"
        if ($status.relay_url -ne $RelayAdvertiseUrl) {
            Write-Host "[pair_remote] host relay URL mismatch; restarting host" -ForegroundColor Yellow
            Stop-ProcessesListeningOnPort -port $HostPort -label "host"
        } else {
            Write-Host "[pair_remote] restarting host to apply Team App launch command" -ForegroundColor Yellow
            Stop-ProcessesListeningOnPort -port $HostPort -label "host"
        }
    }
    if (Test-HttpUp "$HostUrl/healthz") {
        Write-Host "[pair_remote] host already running - reusing (relay URL matches advertised endpoint)"
    } else {
        $hostEnv = @{
            MAGICHAT_RELAY_URL            = $RelayAdvertiseUrl
            MAGICHAT_ALLOW_INSECURE_RELAY = '1'
            MAGICHAT_BIND_HOST            = '0.0.0.0'
            MAGICHAT_PORT                 = $HostPort
            MAGICHAT_TEAM_APP_CMD         = $TeamApp.Command
        }
        if ($TeamApp.Cwd) {
            $hostEnv.MAGICHAT_TEAM_APP_CWD = $TeamApp.Cwd
        }
        $hostProc = Start-NpmService (Join-Path $RepoRoot 'host') $hostEnv $HostLog
        [void]$children.Add($hostProc)
        Wait-HttpUp "$HostUrl/healthz" 'host'
    }

    $bootstrap = Invoke-RestMethod -Method Post -Uri "$AdminBase/bootstrap"
    Set-Content -Path $SvgPath -Value $bootstrap.qr_svg -Encoding UTF8

    Write-Host ""
    Write-Host "=== Scan this QR on the phone ==="
    Write-Host "  pair_uri : $($bootstrap.pair_uri)"
    Write-Host "  relay    : $RelayAdvertiseUrl"
    Write-Host "  qr_svg   : $SvgPath"
    Write-Host "  expires  : $($bootstrap.expires_at)"
    Start-Process $SvgPath

    Write-Host ""
    Write-Host "Waiting for the phone to register a claim. Ctrl+C to cancel."

    $decided = @{}
    $approved = $false
    while (-not $approved) {
        Start-Sleep -Seconds 2
        try {
            $r = Invoke-RestMethod -Uri "$AdminBase/pending-devices"
        } catch {
            Write-Host "[pair_remote] admin poll failed: $($_.Exception.Message)"
            continue
        }

        foreach ($p in @($r.pending_approvals)) {
            if (-not $p) { continue }
            if ($decided.ContainsKey($p.claim_id)) { continue }
            if ($p.status -ne 'pending') { $decided[$p.claim_id] = $p.status; continue }

            $label = if ($p.device_name) { $p.device_name } else { '(unnamed device)' }
            Write-Host ""
            Write-Host "Pending claim: $label [$($p.platform)]  claim_id=$($p.claim_id)"
            $ans = Read-Host 'Approve? [y/N/q to quit]'
            switch -Regex ($ans) {
                '^[Yy]' {
                    $approvalTarget = Resolve-ApprovalTarget -adminBase $AdminBase -originalClaim $p
                    if ($approvalTarget.claim_id -ne $p.claim_id) {
                        Write-Host "[pair_remote] newer claim detected for $label; approving latest claim_id=$($approvalTarget.claim_id)" -ForegroundColor Yellow
                        $decided[$p.claim_id] = 'superseded'
                    }
                    Invoke-RestMethod -Method Post -Uri "$AdminBase/pending-devices/$($approvalTarget.claim_id)/approve" | Out-Null
                    $decided[$approvalTarget.claim_id] = 'approved'
                    $approved = $true
                    Write-Host "[pair_remote] approved - phone is completing registration (claim_id=$($approvalTarget.claim_id))"
                    break
                }
                '^[Qq]' { throw 'cancelled by user' }
                default {
                    Invoke-RestMethod -Method Post -Uri "$AdminBase/pending-devices/$($p.claim_id)/reject" | Out-Null
                    $decided[$p.claim_id] = 'rejected'
                    Write-Host "[pair_remote] rejected - still watching for new claims"
                }
            }
            if ($approved) { break }
        }
    }

    Write-Host ""
    Write-Host "=== Paired. Keep this window open to stay online. Ctrl+C to stop host+relay. ==="
    while ($true) { Start-Sleep -Seconds 60 }
}
finally {
    Write-Host ""
    Write-Host "[pair_remote] stopping background relay + host"
    Stop-Children
}
