# SUBHA INFRA — bring published CMS images into the website files
# ------------------------------------------------------------------
# The admin panel stores new photos in Google Drive and the website loads them
# with js/cms.js. Run this script to make those choices permanent in the site
# files as well (faster first paint, works without the CMS, better for Google):
#
#   1. reads the PUBLISHED image list from your Apps Script web app (cmsApi in js/site-config.js)
#   2. downloads every changed photo into assets/cms/<IMAGE-ID>.<ext>
#   3. points the matching <img data-slot="..."> in _build/pages + partials to that file
#      (team photos: js/site-config.js team[].photo / groupPhoto)
#   4. moves old files that are no longer used anywhere to _build/cms/replaced/<date>/
#   5. rebuilds the website with the same base path as the current build
#
# Usage (from the website folder):
#   powershell -ExecutionPolicy Bypass -File _build\cms\sync-images.ps1
#   powershell -ExecutionPolicy Bypass -File _build\cms\sync-images.ps1 -WhatIf     (show what would change)
# Then upload / push the website as usual (git add -A; git commit; git push).
param([switch]$WhatIf, [switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$CmsDir = $PSScriptRoot; $B = Split-Path -Parent $CmsDir; $root = Split-Path -Parent $B
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Text($p) { [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }
function Write-Text($p, $s) { if (-not $WhatIf) { [IO.File]::WriteAllText($p, $s, $utf8) } }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- 1. published data
$cfg = Read-Text "$root\js\site-config.js"
if ($cfg -notmatch "cmsApi:\s*'([^']+)'") { throw 'cmsApi is empty in js/site-config.js' }
$api = $Matches[1]
Write-Host "Reading published images from the CMS..."
$data = Invoke-RestMethod -Uri ($api + $(if ($api.Contains('?')) { '&' } else { '?' }) + 'api=site') -UseBasicParsing
if (-not $data.ok) { throw "CMS error: $($data.error)" }
$tpl = $(if ($data.tpl) { $data.tpl } else { 'https://lh3.googleusercontent.com/d/{id}=w{w}' })
Write-Host ("Published version v{0} · {1} placements" -f $data.v, @($data.slots.PSObject.Properties).Count)

# ---- built-in image tokens used in the page sources ({{R15}} -> /assets/project-images/...)
$catDir = @{ R = 'residential-buildings'; C = 'commercial-buildings'; F = 'facades'; P = 'peb-structures'; I = 'industrial-buildings'; S = 'steel-structures'; T = 'tensile-structures' }
function Resolve-Src($s) { if ($s -match '^\{\{([RCFPIST])(\d\d)\}\}$') { '/assets/project-images/subha-infra-{0}-{1}.jpg' -f $catDir[$Matches[1]], $Matches[2] } else { $s } }

# ---- 2. download Drive photos
$outDir = Join-Path $root 'assets\cms'
if (-not $WhatIf) { New-Item -ItemType Directory -Force $outDir | Out-Null }
$target = @{}   # slot -> site path
foreach ($p in $data.slots.PSObject.Properties) {
  $m = $p.Value
  if ($m.d) {
    $existing = Get-ChildItem $outDir -Filter ($m.i + '.*') -ErrorAction SilentlyContinue | Select-Object -First 1
    $stamp = Join-Path $outDir ($m.i + '.drive-id')
    $fresh = $existing -and (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $m.d)
    if (-not $fresh) {
      $w = [Math]::Max(1600, [Math]::Min(2400, [int]$(if ($m.w) { $m.w } else { 2400 })))
      $url = $tpl.Replace('{id}', $m.d).Replace('{w}', [string]$w)
      Write-Host "  download $($m.i) for $($p.Name)"
      if (-not $WhatIf) {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing
        $ct = [string]$r.Headers['Content-Type']
        $ext = $(if ($ct -match 'webp') { '.webp' } elseif ($ct -match 'png') { '.png' } else { '.jpg' })
        Get-ChildItem $outDir -Filter ($m.i + '.*') -ErrorAction SilentlyContinue | Where-Object { $_.Extension -ne '.drive-id' } | Remove-Item -Force
        [IO.File]::WriteAllBytes((Join-Path $outDir ($m.i + $ext)), [byte[]]$r.Content)
        [IO.File]::WriteAllText($stamp, $m.d)
        $existing = Get-Item (Join-Path $outDir ($m.i + $ext))
      }
    }
    $target[$p.Name] = $(if ($existing) { '/assets/cms/' + $existing.Name } else { '/assets/cms/' + $m.i + '.webp' })
  }
  elseif ($m.u) { $target[$p.Name] = $m.u }
}

# ---- 3. update page sources
$files = @(Get-ChildItem "$B\pages\*.html") + @(Get-ChildItem "$B\partials\*.html")
$oldUsed = New-Object System.Collections.ArrayList
$changes = 0
foreach ($f in $files) {
  $src = Read-Text $f.FullName; $orig = $src
  $src = [regex]::Replace($src, '<img data-slot="([^"]+)"([^>]*?) src="([^"]+)"', {
      param($mm)
      $key = $mm.Groups[1].Value; $cur = $mm.Groups[3].Value
      if (-not $target.ContainsKey($key)) { return $mm.Value }
      $new = $target[$key]
      if ((Resolve-Src $cur) -eq $new) { return $mm.Value }
      [void]$script:oldUsed.Add((Resolve-Src $cur)); $script:changes++
      Write-Host ("  {0,-24} {1}  ->  {2}" -f $key, (Resolve-Src $cur), $new)
      '<img data-slot="' + $key + '"' + $mm.Groups[2].Value + ' src="' + $new + '"'
    })
  # lightbox links that pointed at the old file
  if ($src -ne $orig) {
    $src = [regex]::Replace($src, '(<a [^>]*href=")([^"]+)("[^>]*data-lb[^>]*>\s*<img data-slot="([^"]+)"[^>]* src="([^"]+)")', { param($mm) if ($mm.Groups[2].Value -ne $mm.Groups[5].Value -and $target.ContainsKey($mm.Groups[4].Value)) { $mm.Groups[1].Value + $mm.Groups[5].Value + $mm.Groups[3].Value } else { $mm.Value } })
    Write-Text $f.FullName $src
  }
}
# team photos live in js/site-config.js
$cfgNew = $cfg
for ($k = 1; $k -le 12; $k++) {
  $key = "TEAM-MEMBER-$k"; if (-not $target.ContainsKey($key)) { continue }
  $n = 0
  $cfgNew = [regex]::Replace($cfgNew, "photo:\s*'[^']*'", { param($mm) $script:n++; if ($script:n -eq $k) { "photo: '" + $target[$key].TrimStart('/') + "'" } else { $mm.Value } })
}
if ($target.ContainsKey('TEAM-GROUP')) { $cfgNew = [regex]::Replace($cfgNew, "groupPhoto:\s*'[^']*'", "groupPhoto: '" + $target['TEAM-GROUP'].TrimStart('/') + "'") }
if ($cfgNew -ne $cfg) { Write-Host '  team photos -> js/site-config.js'; $changes++; Write-Text "$root\js\site-config.js" $cfgNew }

# ---- 4. move old files that nothing uses any more
$allText = (($files | ForEach-Object { Read-Text $_.FullName }) -join "`n") + (Read-Text "$B\build.ps1") + (Read-Text "$B\templates\project.html") + $cfgNew
$tokens = [regex]::Matches($allText, '\{\{([RCFPIST]\d\d)\}\}') | ForEach-Object { Resolve-Src $_.Value }
$moved = @()
foreach ($old in ($oldUsed | Sort-Object -Unique)) {
  if ($old -notlike '/assets/*' -or $old -like '/assets/project-images/*' -or $old -like '*placeholder*') { continue }   # project photos are used by project pages
  if ($allText.Contains($old) -or ($tokens -contains $old)) { continue }
  $full = Join-Path $root $old.TrimStart('/').Replace('/', '\')
  if (-not (Test-Path $full)) { continue }
  $dest = Join-Path $CmsDir ('replaced\' + (Get-Date -Format 'yyyy-MM-dd') + '\' + $old.TrimStart('/').Replace('/', '_'))
  if (-not $WhatIf) { New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null; Move-Item $full $dest -Force }
  $moved += $old
}
if ($moved.Count) { Write-Host "Old files replaced (backup in _build\cms\replaced):"; $moved | ForEach-Object { Write-Host "  $_" } }

if ($WhatIf) { Write-Host "`n-WhatIf: nothing was changed. $changes change(s) would be made."; return }
if (-not $changes) { Write-Host "`nEverything already matches the published CMS images."; return }

# ---- 5. rebuild with the same base path as the current build
if (-not $NoBuild) {
  $base = ''
  if ((Read-Text "$root\index.html") -match "SITE_BASE='(/[^']+)'") { $base = $Matches[1] }
  Write-Host "`nRebuilding the website$(if ($base) { " (base $base)" })..."
  & powershell -ExecutionPolicy Bypass -File "$CmsDir\generate-cms.ps1" | Write-Host
  if ($base) { & powershell -ExecutionPolicy Bypass -File "$B\build.ps1" -Base $base | Write-Host } else { & powershell -ExecutionPolicy Bypass -File "$B\build.ps1" | Write-Host }
}
Write-Host "`nDone: $changes change(s). Publish the website files (git add -A; git commit -m 'Sync CMS images'; git push)."
