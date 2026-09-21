# OmniRoute Autostart Setup

This folder contains scripts to automatically start the OmniRoute server when your laptop starts or when you log in.

## Quick Setup

1. **Open PowerShell as Administrator**
   - Press `Win + X` and select "Windows PowerShell (Admin)" or "Terminal (Admin)"

2. **Navigate to this directory**
   ```powershell
   cd "C:\Users\KIIT0001\Desktop\SonusPilot"
   ```

3. **Run the setup script**
   ```powershell
   .\setup-autostart.ps1
   ```

4. **Done!** OmniRoute will now start automatically when you log in.

## What It Does

- Creates a Windows scheduled task named "OmniRoute-Autostart"
- Runs `omniroute` automatically when you log in
- Opens in a new command window so you can see the server output
- Works even if you close and reopen your laptop

## Managing Autostart

### Disable (temporary)
```powershell
Disable-ScheduledTask -TaskName "OmniRoute-Autostart"
```

### Enable (if disabled)
```powershell
Enable-ScheduledTask -TaskName "OmniRoute-Autostart"
```

### Remove completely
```powershell
Unregister-ScheduledTask -TaskName "OmniRoute-Autostart" -Confirm:$false
```

### View task details
```powershell
Get-ScheduledTask -TaskName "OmniRoute-Autostart" | Format-List *
```

## Alternative: Manual Task Scheduler Setup

If you prefer to set it up manually:

1. Open Task Scheduler (search "Task Scheduler" in Windows)
2. Click "Create Task" in the right panel
3. **General tab**: Name it "OmniRoute-Autostart", check "Run with highest privileges"
4. **Triggers tab**: New → "At log on" → OK
5. **Actions tab**: New → Start a program → Browse to `start-omniroute.bat` in this folder
6. **Settings tab**: Check "Allow task to be run on demand" and "Start the task only if the computer is on AC power" (uncheck if you want it on battery too)
7. Click OK

## Troubleshooting

**Task doesn't run?**
- Check Task Scheduler → Task Scheduler Library for "OmniRoute-Autostart"
- Right-click the task → Run to test it manually
- Check the "Last Run Result" column (0x0 means success)

**Can't see the server window?**
- It should open in a new command window titled "OmniRoute Server"
- Check your taskbar for the window

**Want to start it now without logging out?**
```bash
omniroute
```
Or double-click `start-omniroute.bat`
