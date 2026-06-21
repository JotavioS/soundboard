# RVC Inference Tasks

**Design**: `.specs/features/rvc-inference/design.md`
**Status**: Draft

---

## Execution Plan

### Phase 1: Engine Skeleton
T1: Create `RVCEngine` class.

### Phase 2: Buffering & Integration
T2: Implement 250ms accumulation buffer in `server.py`.
T3: Integrate `RVCEngine.process()` into `server.py`.

---

## Task Breakdown

### T1: Create RVCEngine Class
**What**: Create `rvc_engine.py` with ONNX session initialization logic.
**Where**: `src-python/soundboard_engine/rvc_engine.py`
**Depends on**: None
**Reuses**: None
**Requirement**: RVC-01

**Tools**: `filesystem`

**Done when**:
- [ ] Class loads ONNX model safely (with fallback dummy).
- [ ] Provides `process` method.
**Tests**: none
**Gate**: build

---

### T2: Implement Accumulation Buffer
**What**: Update `server.py` to collect multiple 10.6ms chunks before processing to allow accurate F0 extraction.
**Where**: `src-python/server.py`
**Depends on**: None
**Reuses**: Existing `server.py` structure
**Requirement**: RVC-02

**Tools**: `filesystem`

**Done when**:
- [ ] Array queues are used to buffer incoming frames.
- [ ] Triggers processing only when threshold is reached.
**Tests**: none
**Gate**: build

---

### T3: Integrate Engine Processing
**What**: Instantiate `RVCEngine` in `server.py` and call `process()` when buffer is full.
**Where**: `src-python/server.py`
**Depends on**: T1, T2
**Reuses**: None
**Requirement**: RVC-01

**Tools**: `filesystem`

**Done when**:
- [ ] Chunks are passed to `RVCEngine` and returned to C++.
**Tests**: none
**Gate**: build
