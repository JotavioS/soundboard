# RVC Inference Integration Specification

## Problem Statement

Currently, the Python engine only applies a dummy volume reduction to the audio stream. To fulfill the core value proposition of the soundboard, the Python engine must process the audio chunks through a pre-trained RVC (Retrieval-based Voice Conversion) ONNX model in real-time, matching the desired pitch and timbre.

## Goals

- [ ] Load an ONNX-format RVC model and its associated metadata/index.
- [ ] Implement F0 (pitch) extraction on the incoming audio chunk (e.g., using RMVPE or a fast Crepe alternative).
- [ ] Run the ONNX inference to generate the converted audio.
- [ ] Maintain processing time per chunk under 50ms to ensure the overall <100ms latency goal is met.

## Out of Scope

- Model Training (strictly inference only).
- Dynamic model switching via IPC commands (for now, we hardcode the model path to prove the pipeline works, then we add the dynamic IPC commands later).

---

## User Stories

### P1: Real-time Voice Conversion ⭐ MVP

**User Story**: As a user, I want my voice to be altered by the AI model in real-time so that I sound like the loaded persona.

**Why P1**: This is the main feature of the application.

**Acceptance Criteria**:

1. WHEN the Python server starts THEN it SHALL load the ONNX model into memory (using CUDA/DirectML if available, else CPU).
2. WHEN an audio chunk is received THEN the server SHALL extract its fundamental frequency (F0).
3. WHEN the F0 and audio features are passed to the model THEN the system SHALL output the converted audio chunk.
4. WHEN the audio is sent back to C++ THEN it SHALL sound continuous and glitch-free (requires overlapping or stateful inference if chunks are too small, though for MVP we'll start with stateless).

**Independent Test**: Can run `server.py` and pass a pre-recorded `.wav` file through it, receiving a valid converted `.wav` file back in < 50ms per chunk.

---

## Requirement Traceability

| Requirement ID | Story       | Phase  | Status  |
| -------------- | ----------- | ------ | ------- |
| RVC-01         | P1: ONNX Inference | Design | Pending |
| RVC-02         | P1: F0 Extraction  | Design | Pending |
