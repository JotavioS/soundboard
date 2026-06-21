# Installer Specification

## Problem Statement

Currently, the Tauri frontend launches the C++ backend (`SoundboardCore.exe`) from a hardcoded development path:
`c:/development/soundboard/build-cpp/Release/SoundboardCore.exe`

To generate a working standalone installer (MSI/NSIS on Windows), we must package `SoundboardCore.exe` along with its required runtime dependencies (DLLs, models) as Tauri resources. The Rust backend of Tauri must dynamically resolve the path to `SoundboardCore.exe` depending on whether it is running in development mode (using the local CMake build output) or production mode (resolving from packaged resources).

## Goals

- [ ] Support dynamic resolution of `SoundboardCore.exe` path in `src-ui/src-tauri/src/main.rs`.
- [ ] Configure `src-ui/src-tauri/tauri.conf.json` to bundle a `core` resource folder containing the C++ executable and its dependent DLLs.
- [ ] Populate the `src-ui/src-tauri/core` resource folder with the necessary release artifacts from the C++ build.
- [ ] Build the Tauri application in production mode to generate the final installer.

---

## User Stories

### P1: Dynamic C++ Engine Path Resolution
**User Story**: As a user running the packaged app, I want the GUI to successfully launch the C++ audio core from its installed resources rather than crashing because of a hardcoded development path.

**Acceptance Criteria**:
1. In debug mode (`cfg!(debug_assertions)`), the Rust main process launches `SoundboardCore.exe` from `c:/development/soundboard/build-cpp/Release/SoundboardCore.exe`.
2. In release/production mode, the Rust main process resolves the `SoundboardCore.exe` path using Tauri's resource resolver API (`app.path().resolve("core/SoundboardCore.exe", BaseDirectory::Resource)`).
3. The C++ process launches correctly in both environments.

---

### P1: Packaging Dependencies and Installer Generation
**User Story**: As a developer, I want all required DLLs to be bundled alongside `SoundboardCore.exe` in the installer so the app works on a fresh machine without dynamic library errors.

**Acceptance Criteria**:
1. A resource folder `src-ui/src-tauri/core` is created and populated with:
   - `SoundboardCore.exe`
   - `onnxruntime.dll`
   - `onnxruntime_providers_shared.dll`
   - `rtaudio.dll`
   - `libzmq-v145-mt-4_3_6.dll`
   *(Note: CUDA execution provider DLLs like `onnxruntime_providers_cuda.dll` and cuBLAS/cuDNN are heavy; we will copy the direct CPU runtime DLLs first, or allow GPU acceleration if the user has CUDA/cuDNN on the PATH, or bundle the core dynamic libraries).*
2. The Tauri configuration (`tauri.conf.json`) bundles the `core/**/*` directory under `resources`.
3. Running the build command compiles the front-end, the Rust Tauri back-end, and outputs a valid installer.

---

## Requirement Traceability

| Requirement ID | Story                                | Phase  | Status  |
| -------------- | ------------------------------------ | ------ | ------- |
| INST-01        | Dynamic Path Resolution in Rust      | Specify| Pending |
| INST-02        | Resource Folder Configuration        | Specify| Pending |
| INST-03        | Bundle C++ Core and Core DLLs        | Specify| Pending |
| INST-04        | Production Installer Compilation     | Specify| Pending |

---

## Success Criteria

- [ ] Running the installer build command produces a `.msi` or `.exe` installer.
- [ ] Running the installed application launches both the UI and the C++ engine correctly.
