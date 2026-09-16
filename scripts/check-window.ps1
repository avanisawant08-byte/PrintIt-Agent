Get-Process | Where-Object { $_.MainWindowTitle -like "*PrintIt*" } | Select-Object Id, ProcessName, MainWindowTitle
