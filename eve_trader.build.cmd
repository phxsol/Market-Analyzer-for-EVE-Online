@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  --max-old-space-size=16096 --stack-size=8048 c:\phox.solutions\products\eve_trader\bin\eve_trader-build %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  --max-old-space-size=16096 --stack-size=8048 c:\phox.solutions\products\eve_trader\bin\eve_trader-build %*
)
