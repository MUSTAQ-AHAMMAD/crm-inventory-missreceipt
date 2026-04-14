@echo off
REM ============================================================
REM  CRM – Inventory & Misc Receipt  ·  Start Application
REM  Run this every time you want to start the CRM.
REM  Opens the backend in one window and the frontend in another.
REM ============================================================

echo.
echo  =============================================
echo   CRM Portal – Starting Application
echo  =============================================
echo.

REM ── Verify .env exists ───────────────────────────────────────
if not exist "%~dp0backend\.env" (
    echo [ERROR] backend\.env not found.
    echo         Please run setup.bat first.
    pause
    exit /b 1
)

echo [1/3] Syncing Prisma client and migrations...
cd /d "%~dp0backend"
call npx prisma generate --schema prisma\schema.prisma
call npx prisma migrate deploy
echo.

REM Resolve backend port: use PORT env var, otherwise read backend\.env, fallback 4000
set BACKEND_PORT=%PORT%
if "%BACKEND_PORT%"=="" (
    for /f "usebackq tokens=1,2 delims==" %%A in ("%~dp0backend\.env") do (
        if /I "%%A"=="PORT" set BACKEND_PORT=%%B
    )
)
if "%BACKEND_PORT%"=="" set BACKEND_PORT=4000

REM Fail fast if the port is already in use
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%BACKEND_PORT% .*LISTENING"') do (
    echo [ERROR] Port %BACKEND_PORT% is already in use. Stop the process (PID %%P) or set PORT in backend\.env to a free port.
    pause
    exit /b 1
)

echo [2/3] Starting backend API server (port %BACKEND_PORT%)...
start "CRM Backend" cmd /k "cd /d \"%~dp0backend\" && set PORT=%BACKEND_PORT% && node src/index.js"

REM Give the backend a moment to start before opening the browser
timeout /t 3 /nobreak >nul

echo [3/3] Starting frontend dev server (port 3000)...
start "CRM Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

REM Wait a few seconds then open the browser
timeout /t 5 /nobreak >nul

echo.
echo  =============================================
echo   Application is running!
echo  =============================================
echo.
echo  Frontend : http://localhost:3000
echo  Backend  : http://localhost:%BACKEND_PORT%
echo  API Docs : http://localhost:%BACKEND_PORT%/api/docs
echo.
echo  Login with:  admin@crm.com  /  Admin@123
echo.
echo  Opening browser...
start "" "http://localhost:3000"

echo.
echo  Close the two terminal windows (CRM Backend / CRM Frontend)
echo  to stop the application.
echo.
pause
