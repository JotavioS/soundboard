# Audio Core Pipeline Tasks

**Design**: `.specs/features/audio-core/design.md`
**Status**: Draft

---

## Execution Plan

### Phase 1: Foundation (Parallel OK)
Set up the build systems and project structures for both C++ and Python.

```
  ┌→ T1 [P] (C++ Setup)
  └→ T3 [P] (Python Setup)
```

### Phase 2: Core Components (Parallel OK)
Implement the basic audio capture/playback and the python ZMQ server independently.

```
  T1 ──→ T2 [P] (C++ Loopback)
  T3 ──→ T4 [P] (Python ZMQ Server)
```

### Phase 3: Integration (Sequential)
Bridge C++ to Python via ZMQ.

```
  T2 ─┐
      ├─→ T5 (C++ ZMQ IPC Bridge)
  T4 ─┘
```

---

## Task Breakdown

### T1: Create C++ Project Foundation [P]
**What**: Setup CMakeLists.txt and fetch RtAudio & cppzmq.
**Where**: `src-cpp/CMakeLists.txt`
**Depends on**: None
**Reuses**: None
**Requirement**: AUDIO-01

**Tools**: 
- MCP: `filesystem`

**Done when**:
- [ ] CMakeLists.txt is created
- [ ] Dependencies (RtAudio, cppzmq) are downloaded/configured successfully.
- [ ] Can run CMake configure without errors.
**Tests**: none
**Gate**: build

---

### T2: Implement C++ Loopback Audio [P]
**What**: Implement basic audio capture from mic and playback to speaker using RtAudio.
**Where**: `src-cpp/main.cpp`
**Depends on**: T1
**Reuses**: None
**Requirement**: AUDIO-01

**Tools**: 
- MCP: `filesystem`

**Done when**:
- [ ] `main.cpp` is written with an RtAudio loopback implementation.
- [ ] Project compiles successfully.
**Tests**: none
**Gate**: build

---

### T3: Create Python Project Foundation [P]
**What**: Setup `pyproject.toml` and `uv` environment with dependencies.
**Where**: `src-python/pyproject.toml`
**Depends on**: None
**Reuses**: None
**Requirement**: AUDIO-03

**Tools**: 
- MCP: `filesystem`

**Done when**:
- [ ] `pyproject.toml` created with pyzmq, numpy, torch, onnxruntime.
- [ ] `uv` creates the virtual environment successfully.
**Tests**: none
**Gate**: build

---

### T4: Implement Python ZMQ Server [P]
**What**: Implement a python server that receives float32 arrays over ZeroMQ, scales them (dummy processing), and sends them back.
**Where**: `src-python/server.py`
**Depends on**: T3
**Reuses**: None
**Requirement**: AUDIO-03

**Tools**: 
- MCP: `filesystem`

**Done when**:
- [ ] `server.py` runs and binds to a local port.
**Tests**: none
**Gate**: quick

---

### T5: Implement C++ ZMQ IPC Bridge
**What**: Modify C++ core to send captured audio frames to the Python server via ZeroMQ and playback the returned frames.
**Where**: `src-cpp/ipc_client.cpp` & `src-cpp/main.cpp`
**Depends on**: T2, T4
**Reuses**: None
**Requirement**: AUDIO-02

**Tools**: 
- MCP: `filesystem`

**Done when**:
- [ ] ZMQ REQ socket implemented in C++ loop.
- [ ] Audio flows from Mic -> Python -> Output.
- [ ] No crashes under continuous stream.
**Tests**: integration
**Gate**: build

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | None | ✅ Match |
| T2 | T1 | T1 | ✅ Match |
| T3 | None | None | ✅ Match |
| T4 | T3 | T3 | ✅ Match |
| T5 | T2, T4 | T2, T4 | ✅ Match |
