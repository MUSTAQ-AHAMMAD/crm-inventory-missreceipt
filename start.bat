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

echo [2/3] Starting backend API server (port 4000)...
start "CRM Backend" cmd /k "cd /d "%~dp0backend" && node src/index.js"

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
echo  Backend  : http://localhost:4000
echo  API Docs : http://localhost:4000/api/docs
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
