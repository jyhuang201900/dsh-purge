#!/bin/sh
set -e
mkdir -p runs
C:\Users\Administrator\.dsh\redteam\toolkit\subfinder\subfinder.exe -d 10.0.2.0/24 -silent -timeout 10 | Select-Object -First 2000| Out-File -Encoding utf8 runs/subs.txt
Get-Content runs/subs.txt -TotalCount 200 | C:\Users\Administrator\.dsh\redteam\toolkit\dnsx\dnsx.exe -silent -a -resp| Out-File -Encoding utf8 runs/alive-sample.txt
C:\Users\Administrator\.dsh\redteam\toolkit\dnsx\dnsx.exe -l runs/subs.txt -silent -a -resp -t 200 -retry 1| Out-File -Encoding utf8 runs/alive.txt
C:\Users\Administrator\.dsh\redteam\toolkit\naabu\naabu.exe -list runs/alive.txt -top-ports 100 -silent -o runs/ports.txt
Get-Content runs/ports.txt | ForEach-Object { if ($_ -match ':(\d+)$') { $p = [int]$Matches[1]; $sc = if ($p -in 443,8443) { 'https' } else { 'http' }; "${sc}://$_" } } | Set-Content runs/urls.txt; C:\Users\Administrator\.dsh\redteam\toolkit\httpx\httpx.exe -l runs/urls.txt -title -status-code -tech-detect -silent -nc -ldp -nfs -o runs/httpx.txt -http-proxy http://127.0.0.1:10808
C:\Users\Administrator\.dsh\redteam\toolkit\nuclei\nuclei.exe -l runs/httpx.txt -severity critical,high -silent -nc -duc -c 25 -o runs/nuclei.txt
