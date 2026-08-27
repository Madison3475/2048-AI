# net_check.ps1 —— 网络一键诊断脚本
# 用法:  powershell -ExecutionPolicy Bypass -File tools\net_check.ps1
# 功能:  检查本地代理(FlClash)连通性、GitHub 可达性、出口 IP 与归属地
# 说明:  默认代理端口 7890（FlClash 混合端口），可通过 $Proxy 修改
$ErrorActionPreference = 'SilentlyContinue'
$Proxy = "http://127.0.0.1:7890"

function Test-ViaProxy([string]$label, [string]$url) {
  $code = curl.exe -x $Proxy -s -o NUL -w "%{http_code}" -m 6 $url
  $ok = $code -match '^[2-3]\d\d$'
  Write-Host ("  {0,-18} {1}" -f $label, ($(if ($ok) { "OK    HTTP $code" } else { "FAIL  $code" })))
  return $ok
}

function Test-Direct([string]$label, [string]$url) {
  $code = curl.exe -s -o NUL -w "%{http_code}" -m 6 $url
  $ok = $code -match '^[2-3]\d\d$'
  Write-Host ("  {0,-18} {1}" -f $label, ($(if ($ok) { "OK    HTTP $code" } else { "FAIL  $code" })))
  return $ok
}

Write-Host "==== 1. 代理通道检查（经 $Proxy）====`n"
$g1 = Test-ViaProxy "google.com" "https://www.google.com/generate_204"
$g2 = Test-ViaProxy "github.com"  "https://github.com/"
$g3 = Test-ViaProxy "cloudflare"  "https://www.cloudflare.com/"

Write-Host "`n==== 2. 直连检查（不带代理，对照组）====`n"
Test-Direct "github.com" "https://github.com/"

Write-Host "`n==== 3. 代理出口 IP ====`n"
$ip = curl.exe -x $Proxy -s -m 8 "https://api.ipify.org"
if ($ip) {
  $geo = curl.exe -x $Proxy -s -m 8 "https://ipwho.is/$ip"
  Write-Host "  出口 IP: $ip"
  if ($geo) { Write-Host "  归属地:  $geo" }
} else {
  Write-Host "  出口 IP 查询失败（代理可能未启动或无节点）"
}

Write-Host "`n==== 4. 诊断结论 ====`n"
if ($g1 -and $g2) {
  Write-Host "  ✅ 代理与 GitHub 均正常，可以直接 git push。"
} elseif ($g1 -and -not $g2) {
  Write-Host "  ⚠️  代理可用但 GitHub 不通：FlClash 规则/节点把 github.com 分流到坏出口。"
  Write-Host "     请操作：模式切到 Global 测试；或自定义规则加 DOMAIN-SUFFIX,github.com,PROXY 后重启 FlClash。"
} elseif ($g2) {
  Write-Host "  ⚠️  直连可达而代理不通：检查 FlClash 是否在运行、节点是否可用。"
} else {
  Write-Host "  ❌ 代理通道不可用：检查 FlClash 是否启动、订阅是否过期、节点是否在线。"
}
Write-Host ""
