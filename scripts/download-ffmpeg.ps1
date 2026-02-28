# Enable progress output
$ProgressPreference = 'Continue'

$archive = "$env:TEMP\ffmpeg-dl.7z"
$tmp  = "$env:TEMP\ffmpeg-tmp"
$projectRoot = Split-Path -Parent $PSScriptRoot
$dest = "$projectRoot\src-tauri\binaries"
$destFile = "$dest\ffmpeg-x86_64-pc-windows-msvc.exe"

# Ensure binaries directory exists
if (-not (Test-Path $dest)) {
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  FFmpeg Downloader" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Step 0: Check Internet Connection
Write-Host "[0/4] Checking connectivity..." -ForegroundColor Yellow
try {
    $testUri = "https://www.gyan.dev/ffmpeg/builds/"
    $response = Invoke-WebRequest -Uri $testUri -UseBasicParsing -TimeoutSec 10 -Method Head -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "[OK] Server is reachable" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Server returned status: $($response.StatusCode)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "[ERROR] Cannot reach server: $_" -ForegroundColor Red
    Write-Host "       Check your internet connection" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 1: Download (or check cache)
Write-Host "[1/4] Checking for FFmpeg archive..." -ForegroundColor Yellow
$uri = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.7z"
$minFileSize = 20 * 1MB  # Minimum acceptable size (expected ~31 MB)

# Check if archive already exists
if (Test-Path $archive) {
    $existingSize = (Get-Item $archive).Length
    $existingSizeInMB = [math]::Round($existingSize / 1MB, 1)
    
    if ($existingSize -ge $minFileSize) {
        Write-Host "[OK] Using cached archive ($existingSizeInMB MB)" -ForegroundColor Green
        Write-Host "     Path: $archive" -ForegroundColor DarkGray
        Write-Host ""
        # Skip to step 2
    } else {
        Write-Host "[WARNING] Cached file too small ($existingSizeInMB MB), redownloading..." -ForegroundColor Yellow
        Remove-Item $archive -Force
        Write-Host ""
        $skipDownload = $false
    }
} else {
    $skipDownload = $false
}

# Download if needed
if (-not (Test-Path $archive) -or $skipDownload -eq $false) {
    if ($skipDownload -eq $false -and (Test-Path $archive)) {
        Remove-Item $archive -Force
    }
    
    Write-Host "[1/4] Downloading FFmpeg (release essentials)..." -ForegroundColor Yellow
    try {
        # Download with timeout
        Write-Host "  URL: $uri" -ForegroundColor DarkGray
        $response = Invoke-WebRequest -Uri $uri -OutFile $archive -UseBasicParsing -TimeoutSec 300 -ErrorAction Stop
        
        # Verify download
        if (-not (Test-Path $archive)) {
            Write-Host "[ERROR] Download completed but file not found" -ForegroundColor Red
            exit 1
        }
        
        $fileSize = (Get-Item $archive).Length
        $fileSizeInMB = [math]::Round($fileSize / 1MB, 1)
        
        # Check if file size is reasonable
        if ($fileSize -lt $minFileSize) {
            Write-Host "[WARNING] Downloaded file seems too small: $fileSizeInMB MB (expected ~31 MB)" -ForegroundColor Yellow
            Write-Host "         This might be an error page. Retrying..." -ForegroundColor Yellow
            Remove-Item $archive -Force
            Start-Sleep -Seconds 2
            
            $response = Invoke-WebRequest -Uri $uri -OutFile $archive -UseBasicParsing -TimeoutSec 300 -ErrorAction Stop
            $fileSize = (Get-Item $archive).Length
            $fileSizeInMB = [math]::Round($fileSize / 1MB, 1)
            
            if ($fileSize -lt $minFileSize) {
                Write-Host "[ERROR] Still too small after retry. Check the URL." -ForegroundColor Red
                exit 1
            }
        }
        
        Write-Host "[OK] Downloaded successfully ($fileSizeInMB MB)" -ForegroundColor Green
    } catch [System.Net.WebException] {
        Write-Host "[ERROR] Network error during download: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "       - Check your internet connection" -ForegroundColor Red
        Write-Host "       - Server might be down" -ForegroundColor Red
        exit 1
    } catch [System.TimeoutException] {
        Write-Host "[ERROR] Download timeout (300 seconds exceeded)" -ForegroundColor Red
        Write-Host "       - Server is too slow" -ForegroundColor Red
        Write-Host "       - Check your internet speed" -ForegroundColor Red
        exit 1
    } catch {
        Write-Host "[ERROR] Download failed: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}
Write-Host ""

# Step 2: Extract
Write-Host "[2/4] Extracting archive..." -ForegroundColor Yellow
try {
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    # Use 7z for extraction (must have 7-Zip installed)
    $sevenZipPath = "C:\Program Files\7-Zip\7z.exe"
    if (-not (Test-Path $sevenZipPath)) {
        $sevenZipPath = "C:\Program Files (x86)\7-Zip\7z.exe"
    }
    
    if (Test-Path $sevenZipPath) {
        & $sevenZipPath x $archive -o"$tmp" -y | Out-Null
    } else {
        # Fallback to PowerShell's Expand-Archive (slower but works)
        Expand-Archive -Path $archive -DestinationPath $tmp -Force
    }
    Write-Host "[OK] Extracted" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Extraction failed: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 3: Find FFmpeg
Write-Host "[3/4] Finding ffmpeg.exe..." -ForegroundColor Yellow
$exe = Get-ChildItem -Path $tmp -Recurse -Filter "ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
    Write-Host "[ERROR] ffmpeg.exe not found in archive" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Found: $($exe.FullName)" -ForegroundColor Green
Write-Host ""

# Step 4: Copy
Write-Host "[4/4] Copying to $dest..." -ForegroundColor Yellow
try {
    Copy-Item $exe.FullName -Destination $destFile -Force
    Write-Host "[OK] Copied" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Copy failed: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Cleanup
Write-Host "Cleaning up temporary files..." -ForegroundColor Cyan
Remove-Item $archive -Force -ErrorAction SilentlyContinue
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ""

# Summary
$info = Get-Item $destFile
$sizeInMB = [math]::Round($info.Length / 1MB, 1)
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Completed Successfully!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "File: $($info.Name)" -ForegroundColor White
Write-Host "Size: $sizeInMB MB" -ForegroundColor White
Write-Host "Path: $destFile" -ForegroundColor White
Write-Host ""
