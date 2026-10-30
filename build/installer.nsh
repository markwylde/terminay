; A one-click per-user install is named after the package (terminay-workspace)
; unless a previous install recorded where it lives. Seed that record so a
; first install lands in %LOCALAPPDATA%\Programs\Terminay, and every later
; install and update finds it there (native-windows-desktop, design decision 3).
!macro preInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 == ""
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
  ${endif}
!macroend
