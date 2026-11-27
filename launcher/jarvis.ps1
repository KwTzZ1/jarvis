# Jarvis : démarre le serveur en arrière-plan, ouvre la fenêtre de l'appli
# et place une icône près de l'horloge (clic droit pour quitter).
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$root = Split-Path -Parent $PSScriptRoot
$port = 3000
$url = "http://127.0.0.1:$port"
$dataDir = Join-Path $root 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

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

$script:server = $null
function Start-JarvisServer {
    if (Test-Server) { return $true }
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        [System.Windows.Forms.MessageBox]::Show("Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance Jarvis.", 'Jarvis', 'OK', 'Error') | Out-Null
        return $false
    }
    $script:server = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $dataDir 'server.log') -RedirectStandardError (Join-Path $dataDir 'server-erreurs.log')
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-Server) { return $true }
        if ($script:server.HasExited) { break }
    }
    $err = Get-Content (Join-Path $dataDir 'server-erreurs.log') -Tail 15 -ErrorAction SilentlyContinue | Out-String
    [System.Windows.Forms.MessageBox]::Show("Le serveur Jarvis n'a pas démarré.`n`n$err", 'Jarvis', 'OK', 'Error') | Out-Null
    return $false
}

function Stop-JarvisServer {
    if ($script:server -and -not $script:server.HasExited) {
        Stop-Process -Id $script:server.Id -Force -ErrorAction SilentlyContinue
    }
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

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Ouvrir Jarvis')
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Open-JarvisWindow })
$menu.Items.Add('Redémarrer le serveur').add_Click({
    Stop-JarvisServer
    Start-Sleep -Milliseconds 500
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

# Relance automatique si le serveur s'arrête tout seul.
$watch = New-Object System.Windows.Forms.Timer
$watch.Interval = 15000
$watch.add_Tick({ if ($script:server -and $script:server.HasExited) { Start-JarvisServer | Out-Null } })
$watch.Start()

$tray.ShowBalloonTip(2500, 'Jarvis', "Jarvis tourne en arrière-plan. Clic droit sur l'icône pour quitter.", 'Info')
[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
