@echo off
REM Double-click this file to push the current gas\Code.gs to Apps Script
REM and cut a new version on your live deployment. No terminal typing.

cd /d "%~dp0"

echo ============================================
echo  Pushing code to Apps Script...
echo ============================================
call clasp push --force
if %errorlevel% neq 0 (
    echo.
    echo PUSH FAILED. See the error above.
    echo If it says you're not logged in, run "clasp login" once in a
    echo terminal and then try double-clicking this file again.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Deploying new version...
echo ============================================
REM Replace YOUR_DEPLOYMENT_ID below with your real deployment ID
REM (Apps Script editor -> Deploy -> Manage deployments -> click your
REM Web App deployment -> the ID is shown there).
call clasp deploy --deploymentId AKfycbyCEa9mVyScBqRnwNb0AWYl0I4eniKE8sfVgzyaeyUKALNfYqS5BgT5bTMl0vll6TRPPQ --description "update via double-click"
if %errorlevel% neq 0 (
    echo.
    echo DEPLOY FAILED. Your code WAS pushed above, but the live version
    echo wasn't updated. Go do it manually this once: Apps Script editor
    echo -^> Deploy -^> Manage deployments -^> pencil icon -^> New version -^> Deploy.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Done! Your backend is live.
echo ============================================
pause
