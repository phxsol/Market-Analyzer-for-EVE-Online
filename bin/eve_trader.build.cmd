@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  --max-old-space-size=4096 --stack-size=2048 eve_trader-build %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  --max-old-space-size=16096 --stack-size=24048 eve_trader-build %*
)
