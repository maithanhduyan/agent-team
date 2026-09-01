# Owner failure report — install-dsh (Q3 evidence)
Reported 2026-08-29 on the owner's Windows 11 laptop (EFS-encrypted profile).
- install-dsh returned exit code 0 but C:\Users\owner\.dsh\bin\dsh.exe is missing
- sc.exe query shows DSH Agent in state STOPPED with error 1069 on first login after install
