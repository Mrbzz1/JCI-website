@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "server\node_modules\" (
    echo [JCI] Installation des dependances Node ^(une seule fois^)...
    call npm install --prefix server
    if errorlevel 1 (
        echo Echec: installez Node.js depuis https://nodejs.org
        pause
        exit /b 1
    )
)

echo.
echo [JCI] Demarrage du serveur...
echo [JCI] Ouvrez: http://localhost:3000
echo [JCI] Admin: http://localhost:3000/admin.html
echo [JCI] Ctrl+C pour arreter.
echo.

node server\server.js
if errorlevel 1 pause
