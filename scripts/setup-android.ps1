# One-shot Android toolchain setup into F:\qwen ai\android-tools (no admin needed)
$ErrorActionPreference = 'Stop'
$tools = 'F:\qwen ai\android-tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null

Write-Output 'downloading JDK (Temurin 21)...'
Invoke-WebRequest -Uri 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse' -OutFile "$tools\jdk.zip" -UseBasicParsing
Write-Output ("jdk zip bytes: " + (Get-Item "$tools\jdk.zip").Length)
Expand-Archive -Path "$tools\jdk.zip" -DestinationPath "$tools\jdk" -Force

Write-Output 'downloading Android cmdline-tools (latest build from repo index)...'
$xml = (Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/repository2-3.xml' -UseBasicParsing).Content
$m = [regex]::Matches($xml, 'commandlinetools-win-(\d+)_latest\.zip')
$best = ($m | ForEach-Object { [int]$_.Groups[1].Value } | Sort-Object -Descending | Select-Object -First 1)
$url = "https://dl.google.com/android/repository/commandlinetools-win-$best" + '_latest.zip'
Write-Output "cmdline url: $url"
Invoke-WebRequest -Uri $url -OutFile "$tools\cmdline-tools.zip" -UseBasicParsing
New-Item -ItemType Directory -Force -Path "$tools\android-sdk\cmdline-tools" | Out-Null
Expand-Archive -Path "$tools\cmdline-tools.zip" -DestinationPath "$tools\cmd-tmp" -Force
if (Test-Path "$tools\android-sdk\cmdline-tools\latest") { Remove-Item -Recurse -Force "$tools\android-sdk\cmdline-tools\latest" }
Move-Item "$tools\cmd-tmp\cmdline-tools" "$tools\android-sdk\cmdline-tools\latest"

$javaDir = Get-ChildItem "$tools\jdk" -Directory | Where-Object { Test-Path "$($_.FullName)\bin\java.exe" } | Select-Object -First 1
$env:JAVA_HOME = $javaDir.FullName
$env:ANDROID_HOME = "$tools\android-sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
Write-Output "JAVA_HOME=$env:JAVA_HOME"
$jh = & "$env:JAVA_HOME\bin\java.exe" -version 2>&1 | Out-String
Write-Output "java: $($jh.Substring(0, [Math]::Min(120, $jh.Length)))"

$sdk = "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat"
Write-Output 'accepting licenses...'
$yes = (1..30 | ForEach-Object { 'y' }) -join "`r`n"
$lo = ($yes | & $sdk --licenses 2>&1) | Out-String
Write-Output "licenses tail: $($lo.Substring([Math]::Max(0, $lo.Length - 200)))"
Write-Output 'installing platform-tools, platforms android-34/35, build-tools...'
$inst = (& $sdk 'platform-tools' 'platforms;android-35' 'platforms;android-34' 'build-tools;35.0.0' 2>&1) | Out-String
Write-Output "install tail: $($inst.Substring([Math]::Max(0, $inst.Length - 200)))"
Write-Output 'SETUP DONE'
