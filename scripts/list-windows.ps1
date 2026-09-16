$code = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WindowFinder {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public static List<string> GetTitles() {
        var titles = new List<string>();
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                var sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                var t = sb.ToString();
                if (!string.IsNullOrWhiteSpace(t)) {
                    titles.Add(t);
                }
            }
            return true;
        }, IntPtr.Zero);
        return titles;
    }
}
"@

Add-Type -TypeDefinition $code
[WindowFinder]::GetTitles() | Where-Object { $_ -like "*PrintIt*" -or $_ -like "*Control Center*" -or $_ -like "*Agent*" }
