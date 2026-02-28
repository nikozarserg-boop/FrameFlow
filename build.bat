@echo off
setlocal enabledelayedexpansion

REM Разбор параметров командной строки
set CLEAN_BUILD=0
if "%1"=="clean" set CLEAN_BUILD=1

echo.
echo ============================================
echo   NeuroScreenCaster Build Script
if %CLEAN_BUILD% equ 1 (
    echo   [CLEAN BUILD MODE]
) else (
    echo   [INCREMENTAL BUILD MODE]
)
echo ============================================
echo.

REM Проверка наличия Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 18+
    exit /b 1
)

REM Проверка наличия Cargo
where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Cargo not found. Please install Rust
    exit /b 1
)

REM Получение корневой директории проекта
set PROJECT_ROOT=%~dp0
cd /d "%PROJECT_ROOT%"

REM Установка директории сборки для Cargo
set CARGO_TARGET_DIR=%PROJECT_ROOT%build

REM Полная очистка если запрошена
if %CLEAN_BUILD% equ 1 (
    echo [0/4] Cleaning previous build...
    if exist "%CARGO_TARGET_DIR%" (
        echo       Removing: %CARGO_TARGET_DIR%
        rmdir /s /q "%CARGO_TARGET_DIR%" >nul 2>&1
    )
    if exist "%PROJECT_ROOT%dist" (
        echo       Removing: dist
        rmdir /s /q "%PROJECT_ROOT%dist" >nul 2>&1
    )
    echo [OK] Cleaned
    echo.
)

echo [1/4] Syncing version from version file...
call node scripts/sync-version.mjs
if %errorlevel% neq 0 (
    echo [ERROR] Version sync failed
    exit /b 1
)
echo [OK] Version synced
echo.

echo [2/5] Installing npm dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed
    exit /b 1
)
echo [OK] Dependencies installed
echo.

echo [3/5] Building Tauri application...
echo       Target: %CARGO_TARGET_DIR%
if %CLEAN_BUILD% equ 1 (
    echo       Mode: Full compilation
) else (
    echo       Mode: Incremental ^(only changed files^)
)
echo.
REM Экспорт CARGO_TARGET_DIR для использования Cargo
set CARGO_TARGET_DIR=%PROJECT_ROOT%build

REM Вывод временной метки
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a:%%b)
echo [%mytime%] Starting compilation...
echo.

REM Установка пути фронтенда для Tauri
set TAURI_FRONTEND_DIST=%PROJECT_ROOT%build\frontend

REM Флаги оптимизации памяти
set RUSTFLAGS=-C opt-level=0

REM Запуск сборки с выводом всей информации
call npx @tauri-apps/cli build

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Tauri build failed
    exit /b 1
)

echo.
echo [OK] Build completed
echo.

REM Создание папок вывода если их нет
if not exist "%PROJECT_ROOT%dist" (
    echo [4/5] Creating output folders...
    mkdir "%PROJECT_ROOT%dist"
    echo [OK] dist folder created
) else (
    echo [4/5] Output folders exist
)

REM Создание подпапки setup для инсталяторов
if not exist "%PROJECT_ROOT%dist\setup" (
    mkdir "%PROJECT_ROOT%dist\setup"
    echo [OK] dist\setup folder created
)

if not exist "%CARGO_TARGET_DIR%\frontend" (
    mkdir "%CARGO_TARGET_DIR%\frontend"
)
echo.

REM Поиск и копирование исполняемых файлов и инсталяторов
echo [5/5] Copying artifacts to dist...
set exe_found=0
set src_exe=
set installer_found=0

REM Проверка основного расположения
if exist "%CARGO_TARGET_DIR%\release\neuroscreencaster.exe" (
    set "src_exe=%CARGO_TARGET_DIR%\release\neuroscreencaster.exe"
    set exe_found=1
)

REM Если не найдено, проверить альтернативное расположение
if %exe_found% equ 0 (
    if exist "%PROJECT_ROOT%src-tauri\target\release\neuroscreencaster.exe" (
        set "src_exe=%PROJECT_ROOT%src-tauri\target\release\neuroscreencaster.exe"
        set exe_found=1
        echo [WARNING] Using src-tauri/target/release (fallback)
    )
)

REM Копирование основного исполняемого файла в dist
if %exe_found% equ 1 (
    copy /y "!src_exe!" "%PROJECT_ROOT%dist\"
    if %errorlevel% equ 0 (
        echo [OK] Copied: neuroscreencaster.exe to dist\
    ) else (
        echo [ERROR] Failed to copy executable
        exit /b 1
    )
) else (
    echo [ERROR] No executable found in release directories
    echo [ERROR] Build might have failed. Check output above
    exit /b 1
)

REM Копирование MSI инсталятора в dist\setup если существует
if exist "%CARGO_TARGET_DIR%\release\bundle\msi\*.msi" (
    for %%f in ("%CARGO_TARGET_DIR%\release\bundle\msi\*.msi") do (
        copy /y "%%f" "%PROJECT_ROOT%dist\setup\"
        if %errorlevel% equ 0 (
            echo [OK] Copied: %%~nf to dist\setup\
            set installer_found=1
        ) else (
            echo [WARNING] Failed to copy %%~nf
        )
    )
)

REM Копирование EXE инсталятора в dist\setup если существует
if exist "%CARGO_TARGET_DIR%\release\bundle\nsis\*.exe" (
    for %%f in ("%CARGO_TARGET_DIR%\release\bundle\nsis\*.exe") do (
        copy /y "%%f" "%PROJECT_ROOT%dist\setup\"
        if %errorlevel% equ 0 (
            echo [OK] Copied: %%~nf to dist\setup\
            set installer_found=1
        ) else (
            echo [WARNING] Failed to copy %%~nf
        )
    )
)

REM Проверка альтернативных путей для Tauri 2
if exist "%PROJECT_ROOT%src-tauri\target\release\bundle\msi\*.msi" (
    for %%f in ("%PROJECT_ROOT%src-tauri\target\release\bundle\msi\*.msi") do (
        copy /y "%%f" "%PROJECT_ROOT%dist\setup\"
        if %errorlevel% equ 0 (
            echo [OK] Copied: %%~nf to dist\setup\
            set installer_found=1
        ) else (
            echo [WARNING] Failed to copy %%~nf
        )
    )
)

if exist "%PROJECT_ROOT%src-tauri\target\release\bundle\nsis\*.exe" (
    for %%f in ("%PROJECT_ROOT%src-tauri\target\release\bundle\nsis\*.exe") do (
        copy /y "%%f" "%PROJECT_ROOT%dist\setup\"
        if %errorlevel% equ 0 (
            echo [OK] Copied: %%~nf to dist\setup\
            set installer_found=1
        ) else (
            echo [WARNING] Failed to copy %%~nf
        )
    )
)

echo.
echo ============================================
echo   Build completed successfully!
echo ============================================
echo.
echo Output directories:
echo   Main executable: %PROJECT_ROOT%dist\neuroscreencaster.exe
echo.
if exist "%PROJECT_ROOT%dist\setup" (
    echo   Installers: %PROJECT_ROOT%dist\setup\
    echo   - NeuroScreenCaster_0.1.4_x64_en-US.msi
    echo   - NeuroScreenCaster_0.1.4_x64-setup.exe
    echo.
)
echo Frontend sources: %PROJECT_ROOT%build\frontend\
echo.
echo Usage for next build:
echo   .\build.bat           - Incremental build ^(only changed files^)
echo   .\build.bat clean     - Full clean rebuild
echo.
endlocal
