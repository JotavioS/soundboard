# Audio Core Pipeline Specification

## Problem Statement

The system needs to capture audio from the physical microphone in real-time, route it through an AI inference engine (RVC) with minimal latency, and inject the processed audio (along with optional soundboard clips) into a virtual audio output. If this pipeline has high latency or resource overhead, the application is unusable for gaming or streaming.

## Goals

- [ ] End-to-end latency under 100ms.
- [ ] Stable ring buffer management without audio stuttering (buffer underruns).
- [ ] Bidirectional IPC between C++ (Audio Core) and Python (Inference).

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature     | Reason         |
| ----------- | -------------- |
| Soundboard UI | We are focusing strictly on the backend audio and IPC pipeline first. |
| Model Training| Only inference is supported. |

---

## User Stories

### P1: Microphone Capture & Virtual Injection ⭐ MVP

**User Story**: As a user, I want the system to capture my physical microphone and route it to the virtual audio cable so that applications can hear my processed voice.

**Why P1**: This is the foundational audio routing loop.

**Acceptance Criteria**:

1. WHEN the audio core starts THEN system SHALL begin capturing audio from the default physical microphone.
2. WHEN audio frames are captured THEN system SHALL pass them to a ring buffer.
3. WHEN audio frames are in the ring buffer THEN system SHALL play them out to the virtual audio cable device.

**Independent Test**: Can compile a C++ executable that routes Mic -> Virtual Cable with <20ms base latency.

---

### P1: RVC Inference Integration ⭐ MVP

**User Story**: As a user, I want my voice to be processed by the RVC Python engine so that my voice pitch and timbre change.

**Why P1**: Core value proposition of the app.

**Acceptance Criteria**:

1. WHEN audio frames arrive THEN C++ core SHALL send them via IPC to the Python engine.
2. WHEN the Python engine receives frames THEN it SHALL run RVC inference (RMVPE F0 + ONNX Model) and return the audio.
3. WHEN the C++ core receives processed frames THEN it SHALL route them to the output.

**Independent Test**: Mic -> C++ -> Python (dummy model/echo first) -> C++ -> Output works without crashing.

---

## Requirement Traceability

| Requirement ID | Story       | Phase  | Status  |
| -------------- | ----------- | ------ | ------- |
| AUDIO-01       | P1: Mic Capture & Output | Design | Pending |
| AUDIO-02       | P1: IPC Bridge           | Design | Pending |
| AUDIO-03       | P1: RVC Inference Loop   | Design | Pending |

---

## Success Criteria

- [ ] Audio flows from Mic to Virtual Cable without crackling.
- [ ] IPC latency (C++ to Python and back) adds <15ms overhead.
- [ ] Python engine can load a basic ONNX model and run inference.
