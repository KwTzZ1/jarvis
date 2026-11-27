# Jarvis : démarre le serveur en arrière-plan, ouvre la fenêtre de l'appli
# et place une icône près de l'horloge (clic droit pour quitter).
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class JarvisWindow {
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

    // Met au premier plan la fenêtre Chrome/Edge dont le titre est exactement "title".
    public static bool Focus(string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h)) return true;
            StringBuilder t = new StringBuilder(256);
            GetWindowText(h, t, 256);
            if (t.ToString() != title) return true;
            StringBuilder c = new StringBuilder(256);
            GetClassName(h, c, 256);
            if (!c.ToString().StartsWith("Chrome_WidgetWin")) return true;
            found = h;
            return false;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        if (IsIconic(found)) ShowWindow(found, 9);
        SetForegroundWindow(found);
        return true;
    }
}
'@

$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

# Réglage lu dans data\config.json (interface) puis dans .env (optionnel).
function Get-JarvisSetting([string]$key, [string]$default) {
    try {
        $cfg = Get-Content (Join-Path $dataDir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.$key) { return [string]$cfg.$key }
    } catch {}
    try {
        foreach ($line in Get-Content (Join-Path $root '.env') -Encoding UTF8) {
            if ($line -match "^\s*$key\s*=\s*(.+?)\s*$") { return $Matches[1].Trim('"', "'") }
        }
    } catch {}
    return $default
}

$port = [int](Get-JarvisSetting 'PORT' '3000')
$url = "http://127.0.0.1:$port"

# Fenêtre propriétaire invisible et au premier plan, pour que les messages ne se cachent pas derrière.
function Show-JarvisMessage([string]$text, [string]$icon = 'Error') {
    $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }
    $owner.Show(); $owner.Hide()
    [System.Windows.Forms.MessageBox]::Show($owner, $text, 'Jarvis', 'OK', $icon) | Out-Null
    $owner.Dispose()
}

function Test-Server {
    try { return (Invoke-WebRequest "$url/api/status" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}

function Find-Browser {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}

function Open-JarvisWindow {
    # Si la fenêtre est déjà ouverte, on la ramène simplement devant.
    $title = (Get-JarvisSetting 'ASSISTANT_NAME' 'Jarvis').ToUpper()
    if ([JarvisWindow]::Focus($title)) { return }
    $browser = Find-Browser
    if ($browser) {
        # Profil dédié : fenêtre d'appli indépendante, micro autorisé une seule fois.
        $profileDir = Join-Path $env:LOCALAPPDATA 'Jarvis\fenetre'
        Start-Process -FilePath $browser -ArgumentList @("--app=$url", "--user-data-dir=`"$profileDir`"", '--window-size=1440,900', '--no-first-run', '--no-default-browser-check')
    } else {
        Start-Process $url
    }
}

# Une seule instance : si Jarvis tourne déjà, on rouvre juste la fenêtre.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\JarvisAssistantTray', [ref]$created)
if (-not $created) {
    Open-JarvisWindow
    exit
}

# Processus "node server.js" qui écoutent sur notre port (y compris un serveur resté orphelin).
function Get-JarvisServerProcesses {
    $ids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($id in $ids) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
        if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'server\.js') { $p }
    }
}

$script:server = $null
$script:crashes = 0
function Start-JarvisServer([switch]$Quiet) {
    if (Test-Server) { return $true }
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        Show-JarvisMessage "Node.js est introuvable. Installe-le depuis https://nodejs.org (version LTS), puis relance Jarvis."
        return $false
    }
    $log = Join-Path $dataDir 'server.log'
    $errLog = Join-Path $dataDir 'server-erreurs.log'
    # On garde les journaux précédents (utile pour comprendre un plantage).
    foreach ($f in $log, $errLog) { if (Test-Path $f) { Move-Item $f "$f.old" -Force -ErrorAction SilentlyContinue } }
    $script:server = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $log -RedirectStandardError $errLog
    for ($i = 0; $i -lt 80; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-Server) { return $true }
        if ($script:server.HasExited) { break }
    }
    if (-not $Quiet) {
        $err = (Get-Content $errLog -Tail 15 -ErrorAction SilentlyContinue | Out-String).Trim()
        if (-not $err) { $err = "Aucun détail. Essaie de relancer Installer Jarvis.bat." }
        Show-JarvisMessage "Le serveur Jarvis n'a pas démarré.`n`n$err"
    }
    return $false
}

function Stop-JarvisServer {
    if ($script:server -and -not $script:server.HasExited) {
        Stop-Process -Id $script:server.Id -Force -ErrorAction SilentlyContinue
    }
    foreach ($p in Get-JarvisServerProcesses) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    $script:server = $null
}

if (-not (Start-JarvisServer)) { $mutex.ReleaseMutex(); exit 1 }
Open-JarvisWindow

# ---------- Icône près de l'horloge ----------
$tray = New-Object System.Windows.Forms.NotifyIcon
$iconPath = Join-Path $PSScriptRoot 'jarvis.ico'
$tray.Icon = if (Test-Path $iconPath) { New-Object System.Drawing.Icon $iconPath } else { [System.Drawing.SystemIcons]::Application }
$tray.Text = 'Jarvis'
$tray.Visible = $true

$watch = New-Object System.Windows.Forms.Timer
$watch.Interval = 15000

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Ouvrir Jarvis')
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Open-JarvisWindow })
$menu.Items.Add('Redémarrer le serveur').add_Click({
    Stop-JarvisServer
    Start-Sleep -Milliseconds 700
    $script:crashes = 0
    if (Start-JarvisServer) { $tray.ShowBalloonTip(2000, 'Jarvis', 'Serveur redémarré.', 'Info') }
})
$menu.Items.Add('Ouvrir le dossier').add_Click({ Start-Process explorer.exe $root })
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Quitter').add_Click({
    $watch.Stop()
    Stop-JarvisServer
    $tray.Visible = $false
    $tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({ param($s, $e) if ($e.Button -eq 'Left') { Open-JarvisWindow } })

# Relance automatique si le serveur s'arrête tout seul (3 essais, puis un seul message).
$watch.add_Tick({
    if ($script:server -and $script:server.HasExited -and -not (Test-Server)) {
        $script:crashes++
        if ($script:crashes -le 3) {
            if (Start-JarvisServer -Quiet) { $script:crashes = 0 }
        } elseif ($script:crashes -eq 4) {
            $tray.ShowBalloonTip(5000, 'Jarvis', "Le serveur s'arrête sans cesse. Clic droit sur l'icône, puis Redémarrer le serveur. Détails dans data\server-erreurs.log.", 'Error')
        }
    }
})
$watch.Start()

$tray.ShowBalloonTip(2500, 'Jarvis', "Jarvis tourne en arrière-plan. Clic droit sur l'icône pour quitter.", 'Info')
[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
