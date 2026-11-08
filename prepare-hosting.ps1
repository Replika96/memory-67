$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$destination = Join-Path $PSScriptRoot 'public'
# Only stage application assets. Personal exports stay on the device.
$assets = @('index.html','library.css','autosave.js','sync-state.js','cloud-sync.js',
    'register.js','sw.js','app.webmanifest','icon-192.png','icon-512.png',
    'android/flashcards.html','android/cards.js','eng/flashcards.html','eng/cards.js','finance/flashcards.html','finance/cards.js')
foreach ($asset in $assets) {
    $target = Join-Path $destination $asset
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $asset) -Destination $target
}
