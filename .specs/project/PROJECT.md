# Soundboard & RVC System

**Vision:** A low-latency, modular system that intercepts microphone audio to apply real-time RVC voice conversion and inject soundboard audio, routing the result to a virtual audio device for use in apps like Discord, OBS, and games.
**For:** Gamers, streamers, and content creators who want advanced voice modulation and soundboard capabilities in a single tool.
**Solves:** The need for a unified, high-performance voice changer and soundboard that efficiently manages GPU resources and provides sub-100ms latency without stuttering.

## Goals

- **Latency:** End-to-end audio processing latency must not exceed 50ms to 100ms.
- **Resource Efficiency:** Optimize VRAM and CPU usage so it can run alongside heavy games without causing performance degradation.
- **Stability:** Ensure stable real-time audio threading separate from UI and inference logic.

## Tech Stack

**Core:**
- **Interface (UI):** React / Vue + Tauri (Rust backend for low RAM footprint).
- **Engine de Inferência:** Python (PyTorch / ONNX Runtime) with ONNX/TensorRT for low-latency inference.
- **Core de Áudio:** C++ (WASAPI / RtAudio) for real-time ring buffer management and zero-GIL audio processing.
- **Comunicação (IPC):** gRPC or WebSockets for fast command exchange.

**Key dependencies:**
- ONNX Runtime / TensorRT (for RVC inference)
- RtAudio or WASAPI direct implementation (for C++ audio capture/injection)
- Tauri (for UI packaging)
- Third-party Virtual Audio Cable (e.g., VB-Cable) for routing.

## Scope

**v1 includes:**
- Real-time RVC inference with dynamic model loading and F0 algorithm selection (RMVPE, Harvest, Crepe).
- Soundboard with simultaneous playback, individual volume controls, and bypass/ducking functionality.
- Audio routing (Physical Mic -> Processing -> Virtual Output / Monitor).
- Global hotkeys for soundboard and profile toggling.
- Use of third-party Virtual Audio Cable (e.g., VB-Cable) for final output injection.

**Explicitly out of scope:**
- Development of a custom Windows WDM/KS kernel audio driver (due to WHQL and EV certificate requirements).
- Text-to-speech (TTS) features (unless planned for later).
- VST plugin hosting (for v1).

## Constraints
- **Technical:** Real-time priority threading is required for the C++ audio core. The Python engine must run efficiently without GIL locks stalling the audio pipeline.
- **Hardware:** Requires a GPU capable of running RVC inference, while leaving enough resources for the user's primary tasks (gaming/streaming).
