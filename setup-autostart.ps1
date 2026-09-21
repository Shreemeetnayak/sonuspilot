# PowerShell script to set up OmniRoute autostart on Windows
# Run this script as Administrator

$TaskName = "OmniRoute-Autostart"
$ScriptPath = Join-Path $PSScriptRoot "start-omniroute.bat"

# Check if task already exists
$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($ExistingTask) {
    Write-Host "Task '$TaskName' already exists. Removing old task..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create the scheduled task action
$Action = New-ScheduledTaskAction -Execute $ScriptPath

# Create the trigger (at logon)
$Trigger = New-ScheduledTaskTrigger -AtLogOn

# Create the principal (run with highest privileges)
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

# Create the settings
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register the scheduled task
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Automatically start OmniRoute server on login"

Write-Host "Task created successfully!"
Write-Host "OmniRoute will now start automatically when you log in."
