# Roadmap

**Current Milestone:** Core Infrastructure & Audio Pipeline
**Status:** Planning

---

## Core Infrastructure & Audio Pipeline

**Goal:** Establish the foundational C++ audio capture/routing core and the Python RVC inference engine with basic IPC.
**Target:** MVP Proof of Concept

### Features

**Audio Capture & Routing (C++)** - PLANNED
- Interface with Physical Microphone
- Output to Virtual Audio Cable & Monitor
- Manage low-latency ring buffers

**RVC Inference Engine (Python)** - PLANNED
- Load .pth and .index models
- Implement F0 extraction (RMVPE/Harvest/Crepe)
- Perform real-time voice conversion inference (ONNX/TensorRT)

**IPC Communication** - PLANNED
- Implement gRPC/WebSocket bridge between C++ Core and Python Engine
- Ensure thread safety and real-time capability

---

## UI & Soundboard Integration

**Goal:** Provide the user interface and soundboard capabilities, merging all features into a cohesive application.

### Features

**User Interface (Tauri/React)** - PLANNED
- Device selection (Input, Output, Monitor)
- Model management and parameter tuning (Pitch, F0 algorithm, Index Rate)

**Soundboard System** - PLANNED
- Audio file loading and playback
- Volume controls and ducking/bypass feature
- Global hotkeys integration

---

## Polish & Optimization

**Goal:** Ensure the app is stable, uses minimal resources, and is easy to configure.

### Features

**Performance Optimization** - PLANNED
- Profile and reduce VRAM footprint
- Ensure end-to-end latency < 100ms

**Profile Management** - PLANNED
- Save and load user presets (hotkeys, soundboard sounds, active RVC models)

---

## Future Considerations

- Custom VST plugin support
- Integration with Text-to-Speech (TTS) capabilities
- Built-in noise suppression/gate
