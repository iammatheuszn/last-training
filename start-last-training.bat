@echo off
setlocal EnableExtensions
title Last Training - startup
cd /d "%~dp0"

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm install || goto :fail
)

echo Compilando painel administrativo...
call npm run build:admin || goto :fail

if not defined LT_SERVER_PORT set "LT_SERVER_PORT=8787"

if not defined AUTH_JWT_SECRET (
  for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')"`) do set "AUTH_JWT_SECRET=%%S"
)

call npm run cert:dev || goto :fail

if not defined LT_TLS_KEY set "LT_TLS_KEY=%~dp0certs\dev.key"
if not defined LT_TLS_CERT set "LT_TLS_CERT=%~dp0certs\dev.crt"
if not defined NODE_EXTRA_CA_CERTS set "NODE_EXTRA_CA_CERTS=%LT_TLS_CERT%"

set "LT_SCHEME=https"
set "LT_BASE_URL=%LT_SCHEME%://127.0.0.1:%LT_SERVER_PORT%"
set "LT_ADMIN_URL=%LT_BASE_URL%/admin"

set "LT_AUTH_API_BASE_URL=%LT_BASE_URL%"
call node scripts\write-runtime-config.js || goto :fail

echo Iniciando backend em %LT_BASE_URL%...
start "Last Training API" cmd /k "node server\index.js"

echo Aguardando health check...
node -e "const target=process.env.LT_ADMIN_URL.replace(/\/admin\/?$/,'')+'/health';const mod=target.startsWith('https:')?require('https'):require('http');let tries=0;const timer=setInterval(()=>{tries++;const req=mod.get(target,{rejectUnauthorized:false},res=>{res.resume();if(res.statusCode===200){clearInterval(timer);process.exit(0)}});req.on('error',()=>{});if(tries>=60){clearInterval(timer);process.exit(1)}},250)"

if errorlevel 1 goto :api_fail

echo Abrindo painel administrativo...
start "" "%LT_ADMIN_URL%"

echo Iniciando aplicativo Electron...
call npm run dev
exit /b 0

:api_fail
echo O backend nao respondeu em %LT_BASE_URL%.
exit /b 1

:fail
echo Falha ao preparar o ambiente.
exit /b 1
