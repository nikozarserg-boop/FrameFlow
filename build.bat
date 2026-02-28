@echo off
setlocal enabledelayedexpansion

REM Разбор параметров командной строки
set CLEAN_BUILD=0
if "%1"=="clean" set CLEAN_BUILD=1

echo.
echo FrameFlow - Скрипт сборки
if %CLEAN_BUILD% equ 1 (
    echo [РЕЖИМ ПОЛНОЙ ОЧИСТКИ]
) else (
    echo [РЕЖИМ ИНКРЕМЕНТАЛЬНОЙ СБОРКИ]
)
echo.

REM Проверка наличия Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не найден. Установите Node.js 18+
    exit /b 1
)

REM Проверка наличия Cargo
where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Cargo не найден. Установите Rust
    exit /b 1
)

REM Получение корневой директории проекта
set PROJECT_ROOT=%~dp0
cd /d "%PROJECT_ROOT%"

REM Установка директории сборки для Cargo
set CARGO_TARGET_DIR=%PROJECT_ROOT%build

REM Полная очистка если запрошена
if %CLEAN_BUILD% equ 1 (
    echo [0/4] Очистка предыдущей сборки...
    if exist "%CARGO_TARGET_DIR%" (
        echo       Удаляю: %CARGO_TARGET_DIR%
        rmdir /s /q "%CARGO_TARGET_DIR%" >nul 2>&1
    )
    if exist "%PROJECT_ROOT%dist" (
        echo       Удаляю: dist
        rmdir /s /q "%PROJECT_ROOT%dist" >nul 2>&1
    )
    echo [ОК] Очищено
    echo.
)

echo [1/4] Синхронизация версии...
call node scripts/sync-version.mjs
if %errorlevel% neq 0 (
    echo [ОШИБКА] Синхронизация версии не удалась
    exit /b 1
)
echo [ОК] Версия синхронизирована
echo.

echo [2/5] Установка зависимостей npm...
call npm install
if %errorlevel% neq 0 (
    echo [ОШИБКА] npm install не удалась
    exit /b 1
)
echo [ОК] Зависимости установлены
echo.

echo [3/5] Сборка Tauri приложения...
echo       Целевая папка: %CARGO_TARGET_DIR%
if %CLEAN_BUILD% equ 1 (
    echo       Режим: Полная компиляция
) else (
    echo       Режим: Инкрементальная ^(только измененные файлы^)
)
echo.
REM Экспорт CARGO_TARGET_DIR для использования Cargo
set CARGO_TARGET_DIR=%PROJECT_ROOT%build

REM Вывод временной метки
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a:%%b)
echo [%mytime%] Начинаю компиляцию...
echo.

REM Установка пути фронтенда для Tauri
set TAURI_FRONTEND_DIST=%PROJECT_ROOT%build\frontend

REM Флаги оптимизации памяти
set RUSTFLAGS=-C opt-level=0

REM Запуск сборки с выводом всей информации
call npx @tauri-apps/cli build

if %errorlevel% neq 0 (
    echo.
    echo [ОШИБКА] Сборка Tauri не удалась
    exit /b 1
)

echo.
echo [ОК] Сборка завершена
echo.

REM Создание папок вывода если их нет
if not exist "%PROJECT_ROOT%dist" (
    echo [4/5] Создание выходных папок...
    mkdir "%PROJECT_ROOT%dist"
    echo [ОК] Папка dist создана
) else (
    echo [4/5] Выходные папки существуют
)

REM Создание подпапки setup для инсталяторов
if not exist "%PROJECT_ROOT%dist\setup" (
    mkdir "%PROJECT_ROOT%dist\setup"
    echo [ОК] Папка dist\setup создана
)

if not exist "%CARGO_TARGET_DIR%\frontend" (
    mkdir "%CARGO_TARGET_DIR%\frontend"
)
echo.

REM Поиск и копирование исполняемых файлов и инсталяторов
echo [5/5] Копирование артефактов в dist...
set exe_found=0
set src_exe=
set installer_found=0

REM Проверка основного расположения
if exist "%CARGO_TARGET_DIR%\release\frameflow.exe" (
    set "src_exe=%CARGO_TARGET_DIR%\release\frameflow.exe"
    set exe_found=1
)

REM Если не найдено, проверить альтернативное расположение
if %exe_found% equ 0 (
    if exist "%PROJECT_ROOT%src-tauri\target\release\frameflow.exe" (
        set "src_exe=%PROJECT_ROOT%src-tauri\target\release\frameflow.exe"
        set exe_found=1
        echo [ПРЕДУПРЕЖДЕНИЕ] Используем src-tauri/target/release ^(резервный путь^)
    )
)

REM Копирование основного исполняемого файла в dist
if %exe_found% equ 1 (
    copy /y "!src_exe!" "%PROJECT_ROOT%dist\"
    if %errorlevel% equ 0 (
        echo [ОК] Скопирован: frameflow.exe в dist\
    ) else (
        echo [ОШИБКА] Не удалось скопировать исполняемый файл
        exit /b 1
    )
) else (
    echo [ОШИБКА] Исполняемый файл не найден в папках release
    echo [ОШИБКА] Сборка, возможно, не удалась. Проверьте вывод выше
    exit /b 1
)

REM Копирование MSI инсталятора в dist\setup если существует
if exist "%CARGO_TARGET_DIR%\release\bundle\msi\*.msi" (
    for %%f in ("%CARGO_TARGET_DIR%\release\bundle\msi\*.msi") do (
        copy /y "%%f" "%PROJECT_ROOT%dist\setup\"
        if %errorlevel% equ 0 (
            echo [ОК] Скопирован: %%~nf в dist\setup\
            set installer_found=1
        ) else (
            echo [ПРЕДУПРЕЖДЕНИЕ] Не удалось скопировать %%~nf
        )
    )
)

REM Копирование EXE инсталятора в dist\setup если существует
if exist "%CARGO_TARGET_DIR%\release\bundle\nsis\*.exe" (
    for %%f in ("%CARGO_TARGET_DIR%\release\bundle\nsis\*.exe") do (
        copy /y "%%f" "%PROJECT_ROOT%dist\setup\"
        if %errorlevel% equ 0 (
            echo [ОК] Скопирован: %%~nf в dist\setup\
            set installer_found=1
        ) else (
            echo [ПРЕДУПРЕЖДЕНИЕ] Не удалось скопировать %%~nf
        )
    )
)

REM Проверка альтернативных путей для Tauri 2
if exist "%PROJECT_ROOT%src-tauri\target\release\bundle\msi\*.msi" (
    for %%f in ("%PROJECT_ROOT%src-tauri\target\release\bundle\msi\*.msi") do (
        copy /y "%%f" "%PROJECT_ROOT%dist\setup\"
        if %errorlevel% equ 0 (
            echo [ОК] Скопирован: %%~nf в dist\setup\
            set installer_found=1
        ) else (
            echo [ПРЕДУПРЕЖДЕНИЕ] Не удалось скопировать %%~nf
        )
    )
)

if exist "%PROJECT_ROOT%src-tauri\target\release\bundle\nsis\*.exe" (
    for %%f in ("%PROJECT_ROOT%src-tauri\target\release\bundle\nsis\*.exe") do (
        copy /y "%%f" "%PROJECT_ROOT%dist\setup\"
        if %errorlevel% equ 0 (
            echo [ОК] Скопирован: %%~nf в dist\setup\
            set installer_found=1
        ) else (
            echo [ПРЕДУПРЕЖДЕНИЕ] Не удалось скопировать %%~nf
        )
    )
)

echo.
echo Сборка успешно завершена!
echo.
echo Выходные папки:
echo   Основной файл: %PROJECT_ROOT%dist\frameflow.exe
echo.
if exist "%PROJECT_ROOT%dist\setup" (
    echo   Инсталяторы: %PROJECT_ROOT%dist\setup\
    echo   - FrameFlow_0.1.5_x64_en-US.msi
    echo   - FrameFlow_0.1.5_x64-setup.exe
    echo.
)
echo Исходники фронтенда: %PROJECT_ROOT%build\frontend\
echo.
echo Команды для следующей сборки:
echo   .\build.bat           - Инкрементальная сборка ^(только измененные файлы^)
echo   .\build.bat clean     - Полная чистая сборка
echo.
endlocal
