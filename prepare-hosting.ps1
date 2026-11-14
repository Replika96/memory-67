$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$destination = Join-Path $PSScriptRoot 'public'
# Only stage application assets. Personal exports stay on the device.
$assets = @('index.html','library.css','autosave.js','sync-state.js','cloud-sync.js',
    'register.js','sw.js','app.webmanifest','icon-192.png','icon-512.png',
    'android/flashcards.html','android/cards.js','eng/flashcards.html','eng/cards.js','finance/flashcards.html','finance/cards.js','lesson5/flashcards.html','lesson5/cards.js')
foreach ($asset in $assets) {
    $target = Join-Path $destination $asset
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $asset) -Destination $target
}

# Generated Anki content. Progress and the original archive stay in ivan-private.
$ivanAssets = @('index.html','catalog.js','catalog.css','batman-theme.css','catalog.json','extra-decks.json','load-deck.js','flashcards.html')
$ivanAssets += @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'ivan/decks') -File -Filter '*.js' | ForEach-Object { 'decks/' + $_.Name })
$ivanAssets += @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'ivan/media') -File -Filter '*.jpg' | ForEach-Object { 'media/' + $_.Name })
foreach ($asset in $ivanAssets) {
    $target = Join-Path $destination ('ivan/' + $asset)
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('ivan/' + $asset)) -Destination $target
}
