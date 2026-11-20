param(
    [Parameter(Mandatory = $true)]
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$destinationRoot = (Resolve-Path -LiteralPath $Destination).Path

if (-not (Test-Path -LiteralPath (Join-Path $destinationRoot 'pyproject.toml'))) {
    throw "Destination does not look like a jiaoxiaoAI/Open WebUI checkout: $destinationRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $destinationRoot 'deploy\managed\plugins\tools'))) {
    throw "Destination is missing deploy\managed\plugins\tools: $destinationRoot"
}

$files = @(
    'backend\open_webui\models\skills.py',
    'backend\open_webui\routers\tools.py',
    'backend\open_webui\utils\jiaoxiaoai_plugins.py',
    'backend\tests\test_jiaoxiaoai_managed_plugins.py',
    'backend\tests\test_sjtu_canvas_plugin.py',
    'src\lib\components\common\SensitiveInput.svelte',
    'deploy\managed\README.md',
    'deploy\managed\plugins\README.md',
    'deploy\managed\plugin-src\skills\sjtu_canvas.md',
    'deploy\managed\plugin-src\tools\sjtu_canvas.py',
    'deploy\managed\plugins\skills\SJTU_CANVAS.md',
    'deploy\managed\plugins\skills\sjtu_canvas.json',
    'deploy\managed\plugins\tools\sjtu_canvas.json',
    'scripts\build_managed_plugin_bundles.py'
)

foreach ($relativePath in $files) {
    $source = Join-Path $sourceRoot $relativePath
    $target = Join-Path $destinationRoot $relativePath
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Overlay source is missing: $source"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
}

Write-Host "Applied SJTU Canvas integration overlay to $destinationRoot"
Write-Host "Next: python scripts/build_managed_plugin_bundles.py"
Write-Host "Then: python -m unittest backend.tests.test_sjtu_canvas_plugin -v"
