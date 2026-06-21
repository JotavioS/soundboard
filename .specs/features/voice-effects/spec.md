# Voice Effects Specification

## Problem Statement

The user wants to add voice effects (Efeitos de Voz) to the soundboard application. Specifically, they want a "Demonic Voice" (Voz Demônica) effect inspired by tutorials that use pitch shifting, chorus, delay, distortion, and ring modulation. Two options need to be implemented for comparison/testing:
- **Satanic 1**: A DSP pipeline containing Pitch Shift, Chorus, and Distortion.
- **Satanic 2**: A raw buffer DSP pipeline containing Ring Modulation, Dual Layer Mix, and Soft Clipping.

These effects must be toggleable from a new UI tab called "Efeitos de Voz", with smooth linear interpolation (lerp) to prevent clicks and pops when switching the effects on/off.

## Goals

- [ ] Add a new "Efeitos de Voz" tab in the UI sidebar.
- [ ] Provide independent toggles for "Satanic 1" and "Satanic 2".
- [ ] Implement the Satanic 1 effect in the C++ backend using custom or standard DSP (Pitch Shifter + Chorus + Distortion).
- [ ] Implement the Satanic 2 effect in the C++ backend using raw buffer manipulation (Ring Modulation + Dual Layer Mix + Soft Clipping).
- [ ] Implement linear interpolation (lerp)/smoothing for the effect mix to eliminate clicks and pops on toggling.
- [ ] Support IPC command exchanges between the Tauri UI and the C++ backend to enable/disable these effects.

---

## User Stories

### P1: Voice Effects Tab in UI
**User Story**: As a user, I want a dedicated "Efeitos de Voz" tab in the sidebar where I can toggle different voice effects in real-time.

**Acceptance Criteria**:
1. Sidebar has a new tab named "Efeitos de Voz" (with an icon like 👿 or 👹).
2. Selecting the tab shows two cards: "Satanic 1 (DSP Chain)" and "Satanic 2 (Ring Mod & Mix)".
3. Each card has a toggle button/indicator showing its active state.
4. Clicking the toggle changes the state and sends the corresponding command to the backend.

---

### P1: Satanic 1 DSP Pipeline (FMOD-inspired C++ implementation)
**User Story**: As a user, I want the "Satanic 1" effect to apply Pitch Shifting down, Chorus, and Saturation/Distortion to my voice in real-time.

**Acceptance Criteria**:
1. When Satanic 1 is active, the C++ audio callback processes the microphone buffer through a DSP chain.
2. The chain includes:
   - Pitch Shift down (target pitch ratio around 0.65x).
   - Chorus / Delay modulation (rate ~1.5 Hz, mix for voice duplication).
   - Distortion (harmonic saturation, level ~0.15).
3. The transition of the effect on/off is smoothed to avoid crackles.

---

### P1: Satanic 2 Raw Buffer DSP Pipeline
**User Story**: As a user, I want the "Satanic 2" effect to apply Ring Modulation, a Dual Layer Mix, and Soft Clipping to my voice.

**Acceptance Criteria**:
1. When Satanic 2 is active, the C++ audio callback processes the buffer.
2. The processing includes:
   - Ring Modulation with a low-frequency carrier wave (30 Hz - 60 Hz).
   - Dual Layer Mix: 60% pitched down / grave original voice + 40% ring-modulated voice.
   - Soft Clipping: limiting peaks at ±0.8 to create aggressive distortion.
3. The transition is smoothed to avoid clicks.

---

## Requirement Traceability

| Requirement ID | Story                                | Phase  | Status  |
| -------------- | ------------------------------------ | ------ | ------- |
| VFX-01         | Voice Effects Tab in UI              | Specify| Pending |
| VFX-02         | Satanic 1 DSP C++ Implementation     | Specify| Pending |
| VFX-03         | Satanic 2 Raw Buffer DSP             | Specify| Pending |
| VFX-04         | Smooth Lerp transition (anti-click)  | Specify| Pending |
| VFX-05         | IPC Commands and State Sync          | Specify| Pending |

---

## Success Criteria

- [ ] The app compiles and runs.
- [ ] Clicking "Satanic 1" or "Satanic 2" modifies the real-time voice capture immediately.
- [ ] No audio pops, crackles, or glitches are introduced when toggling the effects.
