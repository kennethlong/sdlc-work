#Requires -Version 5.1
<#
.SYNOPSIS
  Manage the local Jira + Confluence Data Center stack.
.EXAMPLE
  ./dc.ps1 up                       # everything: .env, containers, setup wizards, SDLC project/space, PATs
  ./dc.ps1 up -NoSetup              # containers only
  ./dc.ps1 setup                    # (re)run the unattended setup against running containers; idempotent
  ./dc.ps1 init                     # create .env with random DB passwords (up does this if needed)
  ./dc.ps1 status
  ./dc.ps1 logs jira
  ./dc.ps1 down                     # stop, keep data
  ./dc.ps1 reset                    # stop and DELETE all data volumes
  ./dc.ps1 license                  # fetch Atlassian's 3-hour test (timebomb) keys into .env
  ./dc.ps1 license jira -Copy       # ...and put the Jira key on the clipboard for the setup wizard
  ./dc.ps1 license all -Apply       # ...and install fresh keys into already-set-up instances
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('init', 'up', 'setup', 'down', 'status', 'logs', 'reset', 'license')]
    [string]$Command = 'status',

    # logs: service name. license: jira | confluence | all.
    [Parameter(Position = 1)]
    [string]$Service,

    [int]$TimeoutMinutes = 15,

    # license: copy the key to the clipboard (single product only).
    [switch]$Copy,

    # license: install the key into the running, already-set-up instance(s).
    [switch]$Apply,

    # up: start containers without running the unattended setup.
    [switch]$NoSetup,

    # setup: show the browser while the wizards run.
    [switch]$Headed,

    # Alternate env file / compose project, e.g. for a second throwaway stack on other ports.
    [string]$EnvFile = '.env',
    [string]$Project = 'sdlc-atlassian'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$TimebombUrl = 'https://developer.atlassian.com/platform/marketplace/timebomb-licenses-for-testing-server-apps/'
# Product -> heading text on the timebomb page and the .env variable the key is stored in.
$LicenseProducts = [ordered]@{
    jira       = @{ Heading = 'Jira Software Data Center'; EnvVar = 'JIRA_LICENSE_KEY' }
    confluence = @{ Heading = 'Confluence Data Center'; EnvVar = 'CONFLUENCE_LICENSE_KEY' }
}

# Native tools write progress to stderr; under PS 5.1 that becomes a terminating error when output is
# redirected and ErrorActionPreference is Stop. Callers check $LASTEXITCODE instead.
function Invoke-Compose {
    $ErrorActionPreference = 'Continue'
    docker compose -p $Project --env-file $EnvFile @args
}

function Get-EnvValue([string]$Name, [string]$Default) {
    if (Test-Path $EnvFile) {
        $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
        if ($line) { $v = ($line -split '=', 2)[1].Trim(); if ($v) { return $v } }
    }
    return $Default
}

function Set-EnvValue([string]$Name, [string]$Value) {
    $lines = @(Get-Content $EnvFile)
    $found = $false
    $lines = $lines | ForEach-Object {
        if ($_ -match "^\s*$Name\s*=") { $found = $true; "$Name=$Value" } else { $_ }
    }
    if (-not $found) { $lines += "$Name=$Value" }
    $lines | Set-Content $EnvFile -Encoding ascii
}

function New-Secret {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    # Alphanumeric only, so it is safe inside SQL literals and JDBC URLs.
    return (([Convert]::ToBase64String($bytes)) -replace '[^A-Za-z0-9]', '')
}

function Get-AppState([string]$Url) {
    try {
        $r = Invoke-RestMethod -Uri "$Url/status" -TimeoutSec 5
        return $r.state
    } catch {
        return 'DOWN'
    }
}

function Wait-Apps([string[]]$Names) {
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    do {
        Start-Sleep -Seconds 10
        $states = $Names | ForEach-Object { "$_=$(Get-AppState $apps[$_])" }
        Write-Host ("  " + ($states -join '  '))
        $pending = $states | Where-Object { $_ -notmatch '=(RUNNING|FIRST_RUN)$' }
    } while ($pending -and (Get-Date) -lt $deadline)
    if ($pending) { throw "Timed out waiting for: $($pending -join ', '). Try ./dc.ps1 logs <service>." }
}

# Atlassian publishes short-lived DC test licenses for app developers. The page embeds its markdown
# source with escaped newlines; each key sits in a code block under a bold "10 user <Product> ..." line.
function Get-TimebombLicenses {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $html = (Invoke-WebRequest -Uri $TimebombUrl -UseBasicParsing).Content
    $start = $html.IndexOf('Data Center host product licenses')
    if ($start -lt 0) { throw "Timebomb page layout changed: 'Data Center host product licenses' not found at $TimebombUrl" }
    $section = $html.Substring($start).Replace('\\n', "`n").Replace('\n', "`n")
    $found = @{}
    $pattern = '\*\*(?<title>10 user (?<product>[^*]+?) license, expires in (?<ttl>[^*]+?))\*\*\s*```[^\n]*\n(?<key>[\s\S]*?)```'
    foreach ($m in [regex]::Matches($section, $pattern)) {
        $product = $m.Groups['product'].Value.Trim()
        if ($found.ContainsKey($product)) { continue }
        $found[$product] = [pscustomobject]@{
            Title = $m.Groups['title'].Value.Trim()
            Ttl   = $m.Groups['ttl'].Value.Trim()
            Key   = ($m.Groups['key'].Value -replace '[\\\s]', '')
        }
    }
    return $found
}

function Get-JiraAuthHeaders {
    $pat = Get-EnvValue 'JIRA_PAT' ''
    if ($pat) { return @{ Authorization = "Bearer $pat" } }
    $user = Get-EnvValue 'JIRA_ADMIN_USER' ''
    $pass = Get-EnvValue 'JIRA_ADMIN_PASSWORD' ''
    if (-not ($user -and $pass)) { throw 'Set JIRA_PAT (admin user) or JIRA_ADMIN_USER/JIRA_ADMIN_PASSWORD in .env to apply the Jira license.' }
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${pass}"))
    return @{ Authorization = "Basic $basic" }
}

function Install-JiraLicense([string]$Key) {
    # Same call the admin "Versions & licenses" page makes. XSRF check must be bypassed for REST clients.
    $uri = "$($apps.jira)/rest/plugins/applications/1.0/installed/jira-software/license"
    $headers = (Get-JiraAuthHeaders) + @{ 'X-Atlassian-Token' = 'no-check' }
    # UPM wants its vendor media type and a `licenseKey` field (plain JSON -> 415, `rawLicense` -> 500).
    $body = @{ licenseKey = $Key } | ConvertTo-Json
    $r = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/vnd.atl.plugins+json' -Body $body
    Write-Host "  jira: license installed (expires $($r.license.expiryDateString); valid=$($r.license.valid))"
}

function Install-ConfluenceLicense([string]$Key) {
    # Confluence keeps the license in confluence.cfg.xml. We edit that one property in place and
    # restart. Do NOT use ATL_FORCE_CFG_UPDATE for this: regenerating the file from the container
    # template resets setupStep/buildNumber and sends a configured instance back into the wizard.
    $script = @'
import os, re, sys
p = '/var/atlassian/application-data/confluence/confluence.cfg.xml'
s = open(p).read()
line = '<property name="atlassian.license.message">%s</property>' % os.environ['NEWKEY']
if 'atlassian.license.message' in s:
    s = re.sub(r'<property name="atlassian.license.message">.*?</property>', lambda _: line, s, flags=re.S)
else:
    s = s.replace('</properties>', '    ' + line + '\n  </properties>', 1)
open(p, 'w').write(s)
'@
    $ErrorActionPreference = 'Continue'
    $script | docker compose -p $Project --env-file $EnvFile exec -T -e "NEWKEY=$Key" confluence python3 -
    if ($LASTEXITCODE) { throw 'Failed to update confluence.cfg.xml' }
    Write-Host '  confluence: license written, restarting...'
    Invoke-Compose restart confluence | Out-Null
    Wait-Apps @('confluence')
    Write-Host '  confluence: license installed'
}

function Invoke-Setup {
    $ErrorActionPreference = 'Continue'
    Push-Location (Join-Path $PSScriptRoot 'setup')
    try {
        if (-not (Test-Path node_modules)) {
            Write-Host 'Installing setup dependencies (first run only)...'
            npm ci --no-audit --no-fund | Out-Null
            if ($LASTEXITCODE) { throw 'npm ci failed' }
            npx playwright install chromium | Out-Null
        }
        $envPath = if ([IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $PSScriptRoot $EnvFile }
        $nodeArgs = @('src/setup.ts', '--env', $envPath)
        if ($Headed) { $nodeArgs += '--headed' }
        node @nodeArgs
        if ($LASTEXITCODE) { throw 'Unattended setup failed (see output above; screenshots in setup-debug/).' }
    } finally {
        Pop-Location
    }
}

$apps = [ordered]@{
    jira       = "http://localhost:$(Get-EnvValue 'JIRA_PORT' '8080')"
    confluence = "http://localhost:$(Get-EnvValue 'CONFLUENCE_PORT' '8090')"
}

switch ($Command) {
    'init' {
        if (Test-Path $EnvFile) { Write-Host '.env already exists; leaving it alone.'; return }
        (Get-Content .env.example) `
            -replace '^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$(New-Secret)" `
            -replace '^ATL_DB_PASSWORD=.*', "ATL_DB_PASSWORD=$(New-Secret)" |
            Set-Content $EnvFile -Encoding ascii
        Write-Host 'Created .env with random database passwords. Set versions/license there if needed.'
    }
    'up' {
        if (-not (Test-Path $EnvFile)) { & $PSCommandPath init -EnvFile $EnvFile -Project $Project }
        Invoke-Compose up -d
        if ($LASTEXITCODE) { throw 'docker compose up failed' }
        Write-Host 'Waiting for apps (first start takes several minutes)...'
        Wait-Apps @($apps.Keys)
        if (-not $NoSetup) { Invoke-Setup }
        Write-Host ''
        Write-Host "Jira:       http://jira.localhost:$(Get-EnvValue 'JIRA_PORT' '8080')"
        Write-Host "Confluence: http://confluence.localhost:$(Get-EnvValue 'CONFLUENCE_PORT' '8090')"
        if (-not $NoSetup) {
            Write-Host "Admin logins and tokens are in $EnvFile (JIRA_ADMIN_*, CONFLUENCE_ADMIN_*, *_PAT)."
        }
    }
    'setup' { Invoke-Setup }
    'status' {
        Invoke-Compose ps
        foreach ($k in $apps.Keys) { Write-Host ("{0,-11} {1}" -f $k, (Get-AppState $apps[$k])) }
    }
    'logs' {
        if ($Service) { Invoke-Compose logs -f --tail 200 $Service } else { Invoke-Compose logs -f --tail 100 }
    }
    'down' { Invoke-Compose down }
    'reset' {
        $answer = Read-Host 'This deletes ALL Jira/Confluence/Postgres data volumes. Type "reset" to confirm'
        if ($answer -ne 'reset') { Write-Host 'Aborted.'; return }
        Invoke-Compose down -v
    }
    'license' {
        if (-not (Test-Path $EnvFile)) { throw 'No .env yet. Run ./dc.ps1 init first.' }
        $targets = if (-not $Service -or $Service -eq 'all') { @($LicenseProducts.Keys) } else { @($Service) }
        foreach ($t in $targets) { if (-not $LicenseProducts.Contains($t)) { throw "Unknown product '$t'. Use jira, confluence or all." } }
        if ($Copy -and $targets.Count -ne 1) { throw '-Copy needs a single product: ./dc.ps1 license jira -Copy' }

        Write-Host "Fetching test licenses from $TimebombUrl"
        $licenses = Get-TimebombLicenses
        foreach ($t in $targets) {
            $p = $LicenseProducts[$t]
            $lic = $licenses[$p.Heading]
            if (-not $lic) { throw "No '$($p.Heading)' key on the timebomb page (found: $($licenses.Keys -join ', '))." }
            Set-EnvValue $p.EnvVar $lic.Key
            Write-Host ("  {0,-11} {1} (valid {2} from when applied) -> .env {3}" -f $t, $lic.Title, $lic.Ttl, $p.EnvVar)
            if ($Copy) { Set-Clipboard -Value $lic.Key; Write-Host "  $t key copied to clipboard." }
            if ($Apply) {
                if ((Get-AppState $apps[$t]) -ne 'RUNNING') { throw "$t is not RUNNING (finish its setup wizard first, then use -Apply)." }
                if ($t -eq 'jira') { Install-JiraLicense $lic.Key } else { Install-ConfluenceLicense $lic.Key }
            }
        }
    }
}
