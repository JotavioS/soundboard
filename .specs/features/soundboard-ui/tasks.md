# Soundboard UI Tasks

**Design**: `.specs/features/soundboard-ui/design.md`
**Status**: Draft

---

## Execution Plan

### Phase 1: Foundation
T1: Initialize Tauri + React + TS App.

### Phase 2: Implementation (Sequential)
T2: Implement core CSS (Tokens, Glassmorphism, Animations).
T3: Create `SoundButton` component.
T4: Create the `App` grid layout with placeholder sounds.

---

## Task Breakdown

### T1: Initialize Tauri App
**What**: Run `create-tauri-app` in non-interactive mode.
**Where**: `src-ui/`
**Depends on**: None
**Reuses**: None
**Requirement**: SB-01

**Tools**: `run_command`

**Done when**:
- [ ] `src-ui` directory is populated with package.json and Tauri config.
- [ ] `npm install` runs successfully.
**Tests**: none
**Gate**: build

---

### T2: Implement Core CSS
**What**: Define modern web design CSS tokens (dark mode, glassmorphism, gradients).
**Where**: `src-ui/src/index.css`
**Depends on**: T1
**Reuses**: None
**Requirement**: SB-01

**Tools**: `filesystem`

**Done when**:
- [ ] Base CSS variables are defined.
- [ ] `button` and utility classes are written.
**Tests**: none
**Gate**: build

---

### T3: Create SoundButton Component
**What**: Create a React component for individual soundboard buttons with HTML5 Audio playback.
**Where**: `src-ui/src/components/SoundButton.tsx`
**Depends on**: T1, T2
**Reuses**: None
**Requirement**: SB-02

**Tools**: `filesystem`

**Done when**:
- [ ] Component renders with provided name.
- [ ] Plays audio when clicked using `new Audio()`.
**Tests**: none
**Gate**: build

---

### T4: Create App Grid Layout
**What**: Assemble the Soundboard using CSS Grid and load placeholder buttons.
**Where**: `src-ui/src/App.tsx`
**Depends on**: T3
**Reuses**: None
**Requirement**: SB-01

**Tools**: `filesystem`

**Done when**:
- [ ] Grid displays nicely responsive buttons.
- [ ] App compiles and runs via Tauri dev.
**Tests**: none
**Gate**: build
