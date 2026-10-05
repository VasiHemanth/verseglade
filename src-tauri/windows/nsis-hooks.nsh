; NSIS installer hooks for Verseglade
; Enforces explicit Add/Remove Programs (ARP) metadata for Microsoft Store and WACK compliance

!macro NSIS_HOOK_PREINSTALL
  ; Pre-install verification
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Explicitly ensure machine-wide Add/Remove Programs keys match Microsoft Partner Center
  SetShellVarContext all
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Verseglade" "DisplayName" "Verseglade"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Verseglade" "Publisher" "Hemanth Vasi"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Pre-uninstall tasks
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Clean up registry keys if any remain
  SetShellVarContext all
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Verseglade"
!macroend
