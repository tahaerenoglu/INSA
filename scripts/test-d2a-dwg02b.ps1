$ErrorActionPreference='Stop'
powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot/test-d2a-dwg02a.ps1"
$existingExit=$LASTEXITCODE
node --test --import tsx apps/manager-mcp/test/cad-vertical-runtime.test.ts
$verticalExit=$LASTEXITCODE
if($existingExit -ne 0 -or $verticalExit -ne 0){exit 1}
exit 0

