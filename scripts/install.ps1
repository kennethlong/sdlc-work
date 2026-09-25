#Requires -Version 5.1
<#
.SYNOPSIS
  Install the sdlc toolset for agents other than Claude Code (and the sdlc-atl CLI on PATH for everyone).
.DESCRIPTION
  Claude Code users should prefer the plugin:
    claude plugin marketplace add <path-or-git-url-of-sdlc-work>
    claude plugin install sdlc@sdlc-work
  This script:
    1. copies the bundled CLI to ~/.sdlc/bin and adds sdlc-atl(.cmd) shims + that dir to the user PATH;
    2. copies the skills to each target skills dir as "sdlc-<name>" (Agent Skills standard), rewriting the
       plugin-only CLI path to plain `sdlc-atl` and "/sdlc:<name>" references to "/sdlc-<name>".
.EXAMPLE
  ./scripts/install.ps1                      # CLI + skills into ~/.agents/skills (Codex and other agents)
  ./scripts/install.ps1 -SkillDirs ~/.agents/skills, ~/.gemini/skills
  ./scripts/install.ps1 -Uninstall
#>
param(
    [string[]]$SkillDirs = @((Join-Path $HOME '.agents/skills')),
    [string]$BinDir = (Join-Path $HOME '.sdlc/bin'),
    # Don't touch the user PATH (tests, or when you manage PATH yourself).
    [switch]$NoPath,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $repo 'plugins/sdlc'
$bin = $BinDir

function Set-UserPath([switch]$Remove) {
    if ($NoPath) { return }
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @($current -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $bin.TrimEnd('\')) })
    if (-not $Remove) { $parts += $bin }
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
}

$skillNames = Get-ChildItem (Join-Path $plugin 'skills') -Directory | ForEach-Object Name

if ($Uninstall) {
    foreach ($dir in $SkillDirs) {
        foreach ($n in $skillNames) { Remove-Item (Join-Path $dir "sdlc-$n") -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item $bin -Recurse -Force -ErrorAction SilentlyContinue
    Set-UserPath -Remove
    Write-Host 'Removed sdlc skills, ~/.sdlc/bin and its PATH entry (kept ~/.sdlc/atlassian.env).'
    return
}

# 1. CLI
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item (Join-Path $plugin 'bin/*.mjs') $bin -Force
Set-Content (Join-Path $bin 'sdlc-atl.cmd') "@node `"%~dp0sdlc-atl.mjs`" %*" -Encoding ascii
# POSIX shim for Git Bash / WSL-style shells
[IO.File]::WriteAllText((Join-Path $bin 'sdlc-atl'), "#!/bin/sh`nexec node `"`$(dirname `"`$0`")/sdlc-atl.mjs`" `"`$@`"`n")
Set-UserPath
Write-Host ("CLI: $bin" + $(if ($NoPath) { ' (PATH not changed)' } else { ' (added to your user PATH; open a new terminal)' }))

# 2. Skills
foreach ($dir in $SkillDirs) {
    New-Item -ItemType Directory -Force $dir | Out-Null
    foreach ($n in $skillNames) {
        $target = Join-Path $dir "sdlc-$n"
        New-Item -ItemType Directory -Force $target | Out-Null
        $text = Get-Content (Join-Path $plugin "skills/$n/SKILL.md") -Raw
        $text = $text -replace '(?m)^name:\s*\S+', "name: sdlc-$n"
        $text = $text.Replace('node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"', 'sdlc-atl')
        $text = $text -replace '/sdlc:([a-z-]+)', '/sdlc-$1'
        [IO.File]::WriteAllText((Join-Path $target 'SKILL.md'), $text)
    }
    Write-Host "Skills: $($skillNames.Count) -> $dir (as sdlc-<name>)"
}
Write-Host "Next: create ~/.sdlc/atlassian.env (see the sdlc-setup skill), then 'sdlc-atl whoami'."
