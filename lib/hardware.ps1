# Relevés du PC pour les points autour de la sphère. Lancé par lib/hardware.js, qui ajoute en tête
# $Parent (processus de Jarvis), $WithInfo (fiche du matériel à envoyer) et $NoNv (pas de carte NVIDIA).
# Une ligne JSON toutes les 1,5 s ; s'arrête tout seul si Jarvis s'arrête.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Send-Line($o) { [Console]::Out.WriteLine((ConvertTo-Json $o -Compress -Depth 4)); [Console]::Out.Flush() }

# Fiche du matériel : une seule fois par lancement de Jarvis.
if ($WithInfo) {
  $c = Get-CimInstance Win32_Processor | Select-Object -First 1
  $w = Get-CimInstance Win32_OperatingSystem
  $b = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
  Send-Line @{ info = @{
    cpu = @{ name = "$($c.Name)".Trim(); cores = [int]$c.NumberOfCores; threads = [int]$c.NumberOfLogicalProcessors; mhz = [int]$c.MaxClockSpeed }
    os = @{ name = "$($w.Caption)"; version = "$($w.Version)" }
    board = "$($b.Manufacturer) $($b.Product)".Trim()
    mem = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { @{ size = [double]$_.Capacity; mhz = [int]$(if ($_.ConfiguredClockSpeed) { $_.ConfiguredClockSpeed } else { $_.Speed }); type = [int]$_.SMBIOSMemoryType } })
    disks = @(Get-CimInstance -Namespace root/Microsoft/Windows/Storage -ClassName MSFT_PhysicalDisk | ForEach-Object { @{ name = "$($_.FriendlyName)"; size = [double]$_.Size; media = [int]$_.MediaType } })
    drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ id = "$($_.DeviceID)"; label = "$($_.VolumeName)" } })
    gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name = "$($_.Name)"; ram = [double]$_.AdapterRAM } })
  } }
}

# Compteurs Windows lus par .NET avec leurs noms anglais (marche aussi sur un Windows en français).
function New-Counter($cat, $name, $inst) {
  try { $p = New-Object Diagnostics.PerformanceCounter($cat, $name, $inst, $true); [void]$p.NextValue(); $p } catch { $null }
}
function Read-Counter($p) {
  if ($p) { try { return [double]$p.NextValue() } catch {} }
  $null
}
$util = New-Counter 'Processor Information' '% Processor Utility' '_Total'
$perf = New-Counter 'Processor Information' '% Processor Performance' '_Total'
$rd = New-Counter 'PhysicalDisk' 'Disk Read Bytes/sec' '_Total'
$wr = New-Counter 'PhysicalDisk' 'Disk Write Bytes/sec' '_Total'
$idle = New-Counter 'PhysicalDisk' '% Idle Time' '_Total'
$nets = @()
$sensors = $null
$i = 0

while ($true) {
  # Cartes réseau revues toutes les minutes (Wi-Fi qui change, câble branché…).
  if ($i % 40 -eq 0) {
    $nets = @()
    try {
      foreach ($n in (New-Object Diagnostics.PerformanceCounterCategory('Network Interface')).GetInstanceNames()) {
        if ($n -notmatch 'Loopback|isatap|Teredo|Pseudo|vEthernet|Virtual|VPN|Hyper-V') {
          $nets += [pscustomobject]@{ name = $n; rx = (New-Counter 'Network Interface' 'Bytes Received/sec' $n); tx = (New-Counter 'Network Interface' 'Bytes Sent/sec' $n) }
        }
      }
    } catch {}
  }
  # Températures du processeur : seulement si LibreHardwareMonitor (ou OpenHardwareMonitor) tourne.
  if (-not $sensors -and $i % 20 -eq 0) {
    foreach ($ns in 'root/LibreHardwareMonitor', 'root/OpenHardwareMonitor') {
      try { if (Get-CimInstance -Namespace $ns -ClassName Sensor -Filter "SensorType='Temperature'" -ErrorAction Stop) { $sensors = $ns; break } } catch {}
    }
  }

  Start-Sleep -Milliseconds 1500
  try { [void][Diagnostics.Process]::GetProcessById($Parent) } catch { exit }

  $o = @{ cpu = (Read-Counter $util); perf = (Read-Counter $perf); rd = (Read-Counter $rd); wr = (Read-Counter $wr) }
  $id = Read-Counter $idle
  if ($null -ne $id) { $o.busy = [math]::Max(0, 100 - $id) }

  $rx = 0; $tx = 0; $best = $null; $bestV = -1
  foreach ($n in $nets) {
    $a = Read-Counter $n.rx; $b = Read-Counter $n.tx
    $rx += $a; $tx += $b
    if ($a + $b -gt $bestV) { $bestV = $a + $b; $best = $n.name }
  }
  $o.rx = $rx; $o.tx = $tx; $o.nic = $best

  # Programmes qui prennent le plus de mémoire (toutes les ~4,5 s).
  if ($i % 3 -eq 0) {
    $h = @{}
    $all = [Diagnostics.Process]::GetProcesses()
    foreach ($x in $all) { $h[$x.ProcessName] += $x.WorkingSet64 }
    $o.procs = $all.Count
    $o.top = @($h.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 5 | ForEach-Object { @{ n = "$($_.Key)"; b = [double]$_.Value } })
  }

  if ($sensors) {
    $t = @(Get-CimInstance -Namespace $sensors -ClassName Sensor -Filter "SensorType='Temperature'")
    if ($t.Count) {
      $cpuT = @($t | Where-Object { $_.Identifier -match 'cpu' })
      $pk = $cpuT | Where-Object { $_.Name -match 'Package|Tctl|Tdie' } | Select-Object -First 1
      if ($pk) { $o.cpuTemp = [double]$pk.Value } elseif ($cpuT.Count) { $o.cpuTemp = [double]($cpuT | Measure-Object Value -Maximum).Maximum }
      $gT = $t | Where-Object { $_.Identifier -match 'gpu' } | Select-Object -First 1
      if ($gT) { $o.gpuTemp = [double]$gT.Value }
    } else { $sensors = $null }
  }

  # Carte graphique autre que NVIDIA : charge et mémoire vidéo par les compteurs de Windows.
  if ($NoNv) {
    $ge = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Filter "Name LIKE '%engtype_3D'"
    if ($ge) { $o.gpu = [math]::Min(100, [double]($ge | Measure-Object UtilizationPercentage -Sum).Sum) }
    $gm = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Sort-Object DedicatedUsage -Descending | Select-Object -First 1
    if ($gm) { $o.vram = [double]$gm.DedicatedUsage }
  }

  Send-Line $o
  $i++
}
