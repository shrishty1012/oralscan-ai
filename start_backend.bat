@echo off
echo ============================================================
echo   OralScan AI - Backend Startup
echo ============================================================

set PYTHON="d:\Oral Smart Screening\Oral Cancer Dataset\tf_env\Scripts\python.exe"
set BACKEND="d:\Oral Smart Screening\backend\app.py"

echo Using Python: tf_env
echo Starting Flask API on http://localhost:5000
echo.
echo  Open your browser at: http://localhost:5000
echo  Press Ctrl+C to stop.
echo.

%PYTHON% %BACKEND%
pause
