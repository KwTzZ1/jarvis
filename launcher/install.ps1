# Installe Jarvis sur ce PC : dépendances, icône, raccourcis Bureau + menu Démarrer.
param([switch]$Demarrage)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ''
Write-Host '  JARVIS - installation' -ForegroundColor Cyan
Write-Host '  ---------------------' -ForegroundColor DarkCyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '  Node.js est introuvable. Installe-le depuis https://nodejs.org (version LTS) puis relance.' -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js $(node --version) détecté."

Write-Host '  Installation des dépendances...'
npm install --omit=dev --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "npm install a échoué" }

$ico = Join-Path $PSScriptRoot 'jarvis.ico'
if (-not (Test-Path $ico)) { & (Join-Path $PSScriptRoot 'make-icon.ps1') | Out-Null }

$shell = New-Object -ComObject WScript.Shell
function New-JarvisShortcut([string]$path) {
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
    $lnk.Arguments = '"' + (Join-Path $PSScriptRoot 'Jarvis.vbs') + '"'
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = "$ico,0"
    $lnk.Description = 'Jarvis, ton assistant personnel'
    $lnk.Save()
}

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Jarvis.lnk'
New-JarvisShortcut (Join-Path $desktop 'Jarvis.lnk')
New-JarvisShortcut $startMenu
Write-Host '  Raccourcis créés sur le Bureau et dans le menu Démarrer.'

$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Jarvis.lnk'
if ($Demarrage) {
    New-JarvisShortcut $startup
    Write-Host '  Jarvis se lancera aussi au démarrage de Windows.'
} elseif (Test-Path $startup) {
    Remove-Item $startup
}

Write-Host ''
Write-Host '  Terminé ! Jarvis démarre. Ensuite, lance-le depuis le raccourci du Bureau.' -ForegroundColor Green
Write-Host ''
Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList ('"' + (Join-Path $PSScriptRoot 'Jarvis.vbs') + '"')
