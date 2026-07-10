$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot
$env:Path = 'C:\Users\Eason\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin;C:\Users\Eason\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Windows\system32;C:\Windows'
& 'C:\Users\Eason\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\next\dist\bin\next' dev -p 8000 *> 'dev-server.out.log'
