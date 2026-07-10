@echo off
cd /d "C:\Users\Eason\Documents\私家E院\eason-fans-club"
set "PATH=C:\Users\Eason\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin;C:\Users\Eason\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Windows\system32;C:\Windows"
"C:\Users\Eason\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" node_modules\next\dist\bin\next dev -p 8000 > dev-server.out.log 2> dev-server.err.log
