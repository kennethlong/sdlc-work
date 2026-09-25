#Requires -Version 5.1
<#
.SYNOPSIS
  Manage the local Jira + Confluence Data Center stack.
.EXAMPLE
  ./dc.ps1 up                       # everything: .env, containers, setup wizards, SDLC project/space, PATs
  ./dc.ps1 up -NoSetup              # containers only
  ./dc.ps1 setup                    # (re)run the unattended setup against running containers; idempotent
  ./dc.ps1 init                     # create .env with random DB passwords (up does this if needed)
  ./dc.ps1 creds                    # show the admin logins (local dev only)
  ./dc.ps1 status
  ./dc.ps1 logs jira
  ./dc.ps1 down                     # stop, keep data
  ./dc.ps1 reset                    # stop and DELETE all data volumes
  ./dc.ps1 rebuild                  # reset + up, no prompt: a fresh instance (new 3-hour test license window)
  ./dc.ps1 license                  # fetch Atlassian's 3-hour test (timebomb) keys into .env
  ./dc.ps1 license jira -Copy       # ...and put the Jira key on the clipboard for the setup wizard
  ./dc.ps1 license all -Apply       # install the keys from .env into running instances (e.g. developer license)
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('init', 'up', 'setup', 'creds', 'down', 'status', 'logs', 'reset', 'rebuild', 'license')]
    [string]$Command = 'status',

    # logs: service name. license: jira | confluence | all.
    [Parameter(Position = 1)]
    [string]$Service,

    [int]$TimeoutMinutes = 15,

    # license: copy the key to the clipboard (single product only).
    [switch]$Copy,

    # license: install the key into the running, already-set-up instance(s).
    [switch]$Apply,

    # license -Apply: refetch the test keys instead of using the ones in the env file.
    [switch]$Fetch,

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
    bitbucket  = @{ Heading = 'Bitbucket Data Center'; EnvVar = 'BITBUCKET_LICENSE_KEY' }
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
    try {
        $r = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/vnd.atl.plugins+json' -Body $body
    } catch {
        if ("$($_.ErrorDetails.Message)" -match 'expired') {
            # Timebomb keys count 3 hours from the first time *this instance* saw them; re-applying doesn't reset it.
            throw "Jira rejected the key as expired: a 3-hour test license can't be renewed on the same instance. Run ./dc.ps1 rebuild (fresh instance, wipes data) or install the developer license."
        }
        throw
    }
    Write-Host "  jira: license installed (expires $($r.license.expiryDateString); valid=$($r.license.valid))"
}

function Install-BitbucketLicense([string]$Key) {
    $user = Get-EnvValue 'BITBUCKET_ADMIN_USER' 'admin'
    $pass = Get-EnvValue 'BITBUCKET_ADMIN_PASSWORD' ''
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${pass}"))
    $r = Invoke-RestMethod -Method Post -Uri "$($apps.bitbucket)/rest/api/1.0/admin/license" -Headers @{ Authorization = "Basic $basic"; 'X-Atlassian-Token' = 'no-check' } -ContentType 'application/json' -Body (@{ license = $Key } | ConvertTo-Json)
    Write-Host "  bitbucket: license installed (expires $([DateTimeOffset]::FromUnixTimeMilliseconds($r.expiryDate).ToString('u')))"
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

function Show-Creds {
    foreach ($p in 'JIRA', 'CONFLUENCE', 'BITBUCKET') {
        $name = $p.ToLower()
        Write-Host ("{0,-11} {1}  user: {2}  password: {3}" -f $name, $publicUrls[$name], (Get-EnvValue "$($p)_ADMIN_USER" 'admin'), (Get-EnvValue "$($p)_ADMIN_PASSWORD" '?'))
    }
}

# Bitbucket sets itself up from SETUP_* env vars at first start, so its license and admin password must exist
# before the container is created. Other apps get theirs during `setup`.
function Initialize-BitbucketSetup {
    if (-not (Get-EnvValue 'BITBUCKET_ADMIN_USER' '')) { Set-EnvValue 'BITBUCKET_ADMIN_USER' 'admin' }
    if (-not (Get-EnvValue 'BITBUCKET_ADMIN_PASSWORD' '')) { Set-EnvValue 'BITBUCKET_ADMIN_PASSWORD' (New-Secret) }
    if (-not (Get-EnvValue 'BITBUCKET_LICENSE_KEY' '')) {
        $lic = (Get-TimebombLicenses)[$LicenseProducts.bitbucket.Heading]
        if (-not $lic) { throw 'No Bitbucket Data Center key on the timebomb page; set BITBUCKET_LICENSE_KEY in the env file.' }
        Set-EnvValue 'BITBUCKET_LICENSE_KEY' $lic.Key
        Write-Host 'bitbucket: using Atlassian 3-hour test license'
    }
}

# The postgres init script only runs on an empty volume; re-run it (idempotent) so apps added later get a database.
function Initialize-Databases {
    Invoke-Compose up -d postgres | Out-Null
    # Probe over TCP: on a fresh volume the image first runs its own init on a socket-only temporary server, and
    # running our script against that one races it.
    for ($i = 0; $i -lt 60; $i++) {
        Invoke-Compose exec -T postgres pg_isready -h 127.0.0.1 -U postgres | Out-Null
        if (-not $LASTEXITCODE) { break }
        Start-Sleep -Seconds 2
    }
    Invoke-Compose exec -T postgres bash /docker-entrypoint-initdb.d/01-create-databases.sh | Out-Null
    if ($LASTEXITCODE) { throw 'Creating app databases failed' }
}

$apps = [ordered]@{
    jira       = "http://localhost:$(Get-EnvValue 'JIRA_PORT' '8080')"
    confluence = "http://localhost:$(Get-EnvValue 'CONFLUENCE_PORT' '8090')"
    bitbucket  = "http://localhost:$(Get-EnvValue 'BITBUCKET_PORT' '7990')"
}
$publicUrls = [ordered]@{
    jira       = "http://jira.localhost:$(Get-EnvValue 'JIRA_PORT' '8080')"
    confluence = "http://confluence.localhost:$(Get-EnvValue 'CONFLUENCE_PORT' '8090')"
    bitbucket  = "http://bitbucket.localhost:$(Get-EnvValue 'BITBUCKET_PORT' '7990')"
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
        Initialize-BitbucketSetup
        Initialize-Databases
        Invoke-Compose up -d
        if ($LASTEXITCODE) { throw 'docker compose up failed' }
        Write-Host 'Waiting for apps (first start takes several minutes)...'
        Wait-Apps @($apps.Keys)
        if (-not $NoSetup) { Invoke-Setup }
        Write-Host ''
        foreach ($k in $publicUrls.Keys) { Write-Host ("{0,-11} {1}" -f "$($k):", $publicUrls[$k]) }
        if (-not $NoSetup) {
            Write-Host ''
            Show-Creds
            Write-Host "(Also in $EnvFile, with the API tokens. Show again: ./dc.ps1 creds)"
        }
    }
    'setup' { Invoke-Setup }
    'creds' { Show-Creds }
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
    'rebuild' {
        # Test licenses expire 3 hours after an instance first sees them and can't be renewed in place, so the
        # way to keep developing on them is a fresh instance. Keeps admin passwords and license keys in the env
        # file (setup reuses them); drops the PATs, which belong to the old instance.
        Invoke-Compose down -v
        if (Test-Path $EnvFile) {
            (Get-Content $EnvFile) | Where-Object { $_ -notmatch '^((JIRA|CONFLUENCE)_PAT|BITBUCKET_TOKEN)=' } | Set-Content $EnvFile -Encoding ascii
        }
        & $PSCommandPath up -EnvFile $EnvFile -Project $Project -TimeoutMinutes $TimeoutMinutes
    }
    'license' {
        if (-not (Test-Path $EnvFile)) { throw 'No .env yet. Run ./dc.ps1 init first.' }
        $targets = if (-not $Service -or $Service -eq 'all') { @($LicenseProducts.Keys) } else { @($Service) }
        foreach ($t in $targets) { if (-not $LicenseProducts.Contains($t)) { throw "Unknown product '$t'. Use jira, confluence or all." } }
        if ($Copy -and $targets.Count -ne 1) { throw '-Copy needs a single product: ./dc.ps1 license jira -Copy' }

        # Without -Apply: fetch the test keys into the env file. With -Apply: install the key already in the env
        # file (e.g. a pasted developer license), fetching a test key only if none is set or -Fetch is given.
        $licenses = $null
        foreach ($t in $targets) {
            $p = $LicenseProducts[$t]
            $key = Get-EnvValue $p.EnvVar ''
            if (-not $Apply -or $Fetch -or -not $key) {
                if (-not $licenses) { Write-Host "Fetching test licenses from $TimebombUrl"; $licenses = Get-TimebombLicenses }
                $lic = $licenses[$p.Heading]
                if (-not $lic) { throw "No '$($p.Heading)' key on the timebomb page (found: $($licenses.Keys -join ', '))." }
                $key = $lic.Key
                Set-EnvValue $p.EnvVar $key
                Write-Host ("  {0,-11} {1} (3 hours per instance) -> {2} {3}" -f $t, $lic.Title, $EnvFile, $p.EnvVar)
            } else {
                Write-Host ("  {0,-11} using {1} from {2}" -f $t, $p.EnvVar, $EnvFile)
            }
            if ($Copy) { Set-Clipboard -Value $key; Write-Host "  $t key copied to clipboard." }
            if ($Apply) {
                if ((Get-AppState $apps[$t]) -ne 'RUNNING') { throw "$t is not RUNNING (finish its setup wizard first, then use -Apply)." }
                switch ($t) {
                    'jira' { Install-JiraLicense $key }
                    'confluence' { Install-ConfluenceLicense $key }
                    'bitbucket' { Install-BitbucketLicense $key }
                }
            }
        }
    }
}
