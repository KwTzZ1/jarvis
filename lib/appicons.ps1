# Icônes des applis du lanceur, tirées des programmes installés (lancé une fois par lib/system.js).
# $Out (dossier des icônes) et $Apps (liste id / path / scheme) sont ajoutés en tête par Node.
# Répond en JSON : pour chaque appli à lien (discord:, steam:…), si elle est installée.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JarvisIcons {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@

# Chemin et numéro d'icône lus dans le registre ("C:\...\appli.exe",0 ou une commande), seulement si le fichier existe.
function Read-IconValue($v) {
  if (-not $v) { return $null }
  $v = [Environment]::ExpandEnvironmentVariables($v)
  if ($v -match '^"([^"]+)"(?:,(-?\d+))?') { $p = $Matches[1]; $i = [int]$Matches[2] }
  elseif ($v -match '^([^,"]+?)(?:,(-?\d+))?$') { $p = $Matches[1].Trim(); $i = [int]$Matches[2] }
  else { return $null }
  if (Test-Path -LiteralPath $p -PathType Leaf) { return @($p, $i) }
  $null
}

# Où trouver l'icône : un chemin fixe, ou l'appli enregistrée pour un lien (DefaultIcon, sinon la commande d'ouverture).
function Get-IconSource($a) {
  if ($a.path) { if (Test-Path $a.path) { return @($a.path, 0) }; return $null }
  $key = "Registry::HKEY_CLASSES_ROOT\$($a.scheme)"
  if (-not (Test-Path $key)) { return $null }
  $src = Read-IconValue (Get-ItemProperty "$key\DefaultIcon").'(default)'
  if (-not $src) { $src = Read-IconValue (Get-ItemProperty "$key\shell\open\command").'(default)' }
  if ($src) { return $src }
  return @('', 0)
}

$found = @{}
foreach ($a in $Apps) {
  $src = Get-IconSource $a
  $found[$a.id] = [bool]$src
  if (-not $src -or -not $src[0] -or -not (Test-Path $src[0])) { continue }
  try {
    $h = New-Object IntPtr[] 1
    $ids = New-Object uint32[] 1
    if ([JarvisIcons]::PrivateExtractIcons($src[0], $src[1], 96, 96, $h, $ids, 1, 0) -ge 1 -and $h[0] -ne [IntPtr]::Zero) {
      $ico = [Drawing.Icon]::FromHandle($h[0])
      $bmp = $ico.ToBitmap()
      $bmp.Save((Join-Path $Out "$($a.id).png"), [Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose(); $ico.Dispose()
      [void][JarvisIcons]::DestroyIcon($h[0])
    }
  } catch {}
}
[Console]::Out.Write((ConvertTo-Json $found -Compress))
