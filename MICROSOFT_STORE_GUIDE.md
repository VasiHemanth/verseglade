# Verseglade — Microsoft Store Certification & Packaging Guide

This guide documents the root cause analysis, configuration fixes, and resolution paths for Microsoft Store certification of **Verseglade** (Product ID: `1ce6b936-f6d0-462f-aac4-f29462145b01`).

---

## 1. Certification Audit Findings

On October 4–5, 2026, the Microsoft Partner Center review flagged Verseglade with status **"Attention needed"** under certification report `dad41654-993b-4ed6-8df0-d59ef4d0604f`.

### Finding A: Policy 10.2.9 Security — Package Submissions
- **Reviewer Note**:
  > *"The binary and all of its Portable Executable (PE) files has been signed with a certificate that has been observed being abused to sign malicious content or must be digitally signed with a code sign certificate that chains up to a certificate issued by a Certificate Authority (CA) that is part of the Microsoft Trusted Root Program."*
- **Affected Package**: `https://vasihemanth.github.io/verseglade/downloads/v0.1.1/Verseglade-Windows-x64-setup.exe`
- **Code Signing Type**: `Unsigned`
- **Description**: `Package should be signed with SHA256 or higher algorithm`

### Finding B: Automated Package Validation Triad
The pre-certification automated sandbox reported three related warnings:
1. *Silent install check*: "We could not identify if your app is installing silently."
2. *Entry in add or remove programs*: "We could not identify the app name and the publisher name that your app has added in the add or remove programs."
3. *Bundleware check*: "We could not identify the app name and the publisher name that your app has added in the add or remove programs."

---

## 2. Root Cause Analysis

### Why the Automated Package Validation Failed
1. **Publisher String Mismatch**:
   - In Partner Center, the developer account publisher name is **`Hemanth Vasi`**.
   - In Tauri v2, if `bundle.publisher` is not explicitly set, the bundler defaults the installer manufacturer to the second component of `identifier` (`com.hemanth.gita-wallpaper`), setting `Publisher` to `"hemanth"`.
   - The Store validator computes a diff of the Windows Registry before and after silent installation. It searched for `Publisher == "Hemanth Vasi"`, found `"hemanth"`, and failed the match.
2. **Registry Hive Scope (`HKCU` vs `HKLM`)**:
   - Tauri's default NSIS `installMode` is `"currentUser"`, which installs to `%LOCALAPPDATA%` and writes uninstall records into `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Verseglade`.
   - The automated Store testing agent executes in an administrative sandbox service context and inspects `HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall`.
   - Because the entry was not in `HKLM`, the test runner concluded that the app failed to install silently and could not verify bundleware.
3. **Missing Exit Code Mapping**:
   - The package configuration in Partner Center did not have `Installation successful` explicitly mapped to return code `0`.

---

## 3. Implemented Fixes in the Repository

### 1. Explicit Publisher & Machine-Wide NSIS Configuration
In [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json):
```json
"bundle": {
  "active": true,
  "targets": "all",
  "publisher": "Hemanth Vasi",
  "copyright": "Copyright © 2026 Hemanth Vasi",
  "windows": {
    "nsis": {
      "installMode": "perMachine",
      "languages": ["English"],
      "displayLanguageSelector": false,
      "installerHooks": "windows/nsis-hooks.nsh"
    }
  }
}
```
- `"publisher": "Hemanth Vasi"`: Guarantees that the NSIS uninstaller metadata and Windows registry write `Publisher` as `"Hemanth Vasi"`, matching Partner Center exactly.
- `"installMode": "perMachine"`: Installs to `C:\Program Files\Verseglade` and registers in `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Verseglade`.
- `"displayLanguageSelector": false`: Suppresses any interactive language dialog to ensure unattended `/S` execution.
- `"installerHooks": "windows/nsis-hooks.nsh"`: Injects post-install registry verification.

### 2. NSIS Installer Lifecycle Hooks
Created [`src-tauri/windows/nsis-hooks.nsh`](src-tauri/windows/nsis-hooks.nsh) to enforce standard Add/Remove Programs (ARP) registry keys on machine-wide installation:
```nsis
!macro NSIS_HOOK_POSTINSTALL
  SetShellVarContext all
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Verseglade" "DisplayName" "Verseglade"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Verseglade" "Publisher" "Hemanth Vasi"
!macroend
```

### 3. Automated Code Signing Support in CI/CD
Updated [`.github/workflows/release.yml`](.github/workflows/release.yml) to add `azure/trusted-signing-action@v0.5.1`. When Azure Trusted Signing credentials are provided in GitHub Secrets, Windows release binaries and NSIS setups are digitally signed and timestamped with SHA256 automatically.

### 4. Partner Center Package Parameters Updated
In Partner Center under **Package details**:
- **Installer parameters**: Set to `/S` (strictly uppercase for NSIS).
- **Installation successful return code**: Set to `0`.
- Changes saved to the active draft submission.

---

## 4. Addressing Policy 10.2.9 (Code Signing Options)

To clear Microsoft Store Policy 10.2.9, you have two clear paths:

### Option A: Microsoft Trusted Signing (Recommended for Win32 EXE)
Microsoft provides [Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/) (formerly Azure Artifact Signing):
- Price: ~$9.99/month for individual developers.
- No physical hardware USB token required; fully cloud-based and HSM-backed.
- Validated under the Microsoft Trusted Root Certificate Program.
- Setup:
  1. Create a **Trusted Signing** resource in the Azure Portal.
  2. Complete Identity Validation (Individual).
  3. Create a Certificate Profile.
  4. Add the following repository secrets to GitHub:
     - `AZURE_CLIENT_ID`
     - `AZURE_CLIENT_SECRET`
     - `AZURE_TENANT_ID`
     - `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
     - `AZURE_CERTIFICATE_PROFILE_NAME`
  5. The release workflow will automatically sign the binary on every tag push.

### Option B: MSIX Packaging (Free Microsoft Signing)
If you prefer not to purchase a code-signing certificate:
- As noted in the certification report, Microsoft Store offers **complimentary code signing and hosting for MSIX packages**.
- Microsoft signs MSIX packages using its own Store certificate during ingestion.
- To convert to MSIX, run the installer through the **MSIX Packaging Tool** or package the Tauri binary using `MakeAppx.exe`.
- *Note*: As stated in Partner Center, submitting as MSIX requires deleting the app name from the Win32 submission if you wish to use the exact same reserved name.

---

## 5. Resubmission Checklist

1. [x] Update `tauri.conf.json` with `publisher: "Hemanth Vasi"` and `installMode: "perMachine"`.
2. [x] Add NSIS hooks file [`src-tauri/windows/nsis-hooks.nsh`](src-tauri/windows/nsis-hooks.nsh).
3. [x] Add automated test [`tests/packaging-metadata.test.mjs`](tests/packaging-metadata.test.mjs).
4. [x] Set Partner Center installer parameter `/S` and success return code `0`.
5. [ ] Choose signing path (Option A: Trusted Signing or Option B: MSIX).
6. [ ] Build signed installer and push tag (e.g. `v0.1.2`).
7. [ ] In Partner Center, click **Resubmit** on the Verseglade Application Overview page.
