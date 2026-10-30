# A holder run from its per-build copy survives a reinstall

Spike 1.3 of `native-windows-desktop`, for ADR-0081 §2. Script:
`scripts/windows-spikes/holder-survival.mjs`, bundled with esbuild and run as
`node holder-survival.bundle.mjs <installer.exe>`.

- Date: 2026-10-30
- Machine: Windows 11 ARM64 10.0.26100 (UTM VM), 4 GB RAM, as a standard
  user's interactive account; the spike ran over OpenSSH
- Build: `Terminay-Windows-0.0.0-Setup.exe`, NSIS x64 one-click per-user,
  built on that machine with `electron-builder --win nsis --x64`. Terminay ran
  under x64 emulation; the spike's own Node was v24.15.0 arm64.
- Installation: `%LOCALAPPDATA%\Programs\Terminay`

## Method

1. Install Terminay with `Setup.exe /S`.
2. `prepareHolderRuntime` copies the installation into
   `<dataRoot>\holder-runtime\<sha256(buildId)[:16]>\`, with `Terminay.exe`
   renamed `terminay-session-holder.exe`.
3. A server starts a holder from the copy with `ELECTRON_RUN_AS_NODE=1`, the
   user's SID addressing and mutual proof required. It then creates a
   `powershell.exe` session and waits for `echo "marker-$(40+2)"` to print
   `marker-42`.
4. The server shuts down and leaves the holder running. `Setup.exe /S` runs over
   the installation.
5. A second server adopts the held session, waits for `echo "back-$(2+3)"` to
   print `back-5`, and compares the shell's pid.
6. The server ends every holder. `pruneHolderRuntimes` runs before the holder
   process has exited, and again after it has.

## Results

| Check | Result |
| --- | --- |
| Runtime copy | 232–274 ms |
| Reinstall over the installation | 31.4 s, exit 0, `Terminay.exe` present afterwards |
| Sessions held after the reinstall | `s1` |
| Shell pid before and after | 3412 and 3412 |
| Survived | yes |
| Prune while the holder process was still exiting | copy kept (the running image cannot be deleted) |
| Holder exit after `endAll` | 109 ms |
| Prune after the holder exited | copy removed |

## The copied file set

204 files, 333,614,726 bytes (318 MiB). The installation holds 379 files,
715,454,512 bytes. The holder copy leaves out `locales\`, `resources\app.asar`,
the WebRTC runtime and the uninstaller.

The top level of the installation, excluding `Uninstall Terminay.exe`:

| File | Bytes |
| --- | --- |
| `terminay-session-holder.exe` (`Terminay.exe`) | 235,128,832 |
| `dxcompiler.dll` | 25,637,888 |
| `LICENSES.chromium.html` | 20,367,775 |
| `icudtl.dat` | 10,876,560 |
| `libGLESv2.dll` | 8,024,576 |
| `resources.pak` | 6,875,967 |
| `vk_swiftshader.dll` | 5,529,600 |
| `d3dcompiler_47.dll` | 4,741,488 |
| `ffmpeg.dll` | 3,057,152 |
| `dxil.dll` | 1,509,760 |
| `vulkan-1.dll` | 925,696 |
| `v8_context_snapshot.bin` | 721,176 |
| `libEGL.dll` | 478,208 |
| `snapshot_blob.bin` | 346,432 |
| `chrome_200_percent.pak` | 197,073 |
| `chrome_100_percent.pak` | 119,889 |
| `LICENSE.electron.txt` | 1,096 |
| `vk_swiftshader_icd.json` | 106 |
| `.complete` (marker) | 4 |

`app\` holds 185 files, 9,075,448 bytes:

- `app\dist-electron\`, from `resources\app.asar.unpacked\dist-electron`.
- `app\node_modules\node-pty\`, from the unpacked `node-pty`, including its
  `win32-x64` conpty prebuilds.

The copy takes every top-level file rather than a measured minimum. Some files,
such as the GPU DLLs and the licence text, are probably not needed under
`ELECTRON_RUN_AS_NODE`. Dropping them would save about 70 MB per build. Each
file dropped would have to be proven unnecessary on every Windows version.

## Found along the way

- Windows npm scripts run under `cmd.exe`, which does not honour single quotes.
  `build:app` therefore split its `run-together.mjs` arguments and never exited.
  It now uses double quotes, and `run-together.mjs` stops its children with
  `taskkill /t /f` on Windows. With both changes `build:app` finished in 48 s on
  this machine.
- electron-builder converted `public/terminay.png` to `.ico` in WebAssembly, and
  the conversion failed for lack of memory on this machine. The Windows build now
  uses a checked-in `public/terminay.ico`.
- A one-click per-user NSIS install is named after the package, so it landed in
  `Programs\terminay-workspace`. `build/installer.nsh` now seeds the per-user
  `InstallLocation` with `Programs\Terminay` in `preInit`. A first install lands
  there, and later installs find it through that record.
- The NSIS **arm64** installer, built on this ARM64 machine, installed every
  data file but none of the root `.exe` or `.dll` files. Its embedded archive
  held them. The result was the same under a Defender exclusion and from the
  interactive session. Terminay ships x64 only, and the x64 installer installed
  every file, so the arm64 installer was not investigated further.
