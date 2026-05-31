# raw_print.ps1 — Gửi raw bytes tới Windows printer bằng winspool API
# Usage: powershell -File raw_print.ps1 -PrinterName "POS-58" -DataHex "1B40..."

param(
  [string]$PrinterName = "POS-58",
  [string]$DataHex     = ""
)

$code = @"
using System;
using System.Runtime.InteropServices;

public class WinSpoolPrint {
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern int StartDocPrinter(IntPtr hPrinter, int Level, IntPtr pDocInfo);

    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
"@

Add-Type -TypeDefinition $code -Language CSharp

# Parse hex string -> byte array
$bytes = [byte[]]($DataHex -split '(?<=\G.{2})(?=.)' | ForEach-Object { [Convert]::ToByte($_, 16) })

$hPrinter = [IntPtr]::Zero
$ok = [WinSpoolPrint]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)
if (-not $ok -or $hPrinter -eq [IntPtr]::Zero) {
    Write-Error "Không mở được printer: $PrinterName (lỗi: $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    exit 1
}

# Build DOCINFO_W struct in memory
$docName  = [System.Runtime.InteropServices.Marshal]::StringToHGlobalUni("TikTok Chot Don")
$dataType = [System.Runtime.InteropServices.Marshal]::StringToHGlobalUni("RAW")
$docInfo  = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(24) # 3 pointers x8 bytes
[System.Runtime.InteropServices.Marshal]::WriteInt64($docInfo, 0,  $docName.ToInt64())
[System.Runtime.InteropServices.Marshal]::WriteInt64($docInfo, 8,  [IntPtr]::Zero.ToInt64())
[System.Runtime.InteropServices.Marshal]::WriteInt64($docInfo, 16, $dataType.ToInt64())

[WinSpoolPrint]::StartDocPrinter($hPrinter, 1, $docInfo) | Out-Null
[WinSpoolPrint]::StartPagePrinter($hPrinter) | Out-Null

$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
$written = 0
$ok2 = [WinSpoolPrint]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$written)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)

[WinSpoolPrint]::EndPagePrinter($hPrinter) | Out-Null
[WinSpoolPrint]::EndDocPrinter($hPrinter) | Out-Null
[WinSpoolPrint]::ClosePrinter($hPrinter) | Out-Null

[System.Runtime.InteropServices.Marshal]::FreeHGlobal($docName)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($dataType)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($docInfo)

if ($ok2) {
    Write-Output "OK:$written"
} else {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Error "WritePrinter failed: error $err"
    exit 1
}
