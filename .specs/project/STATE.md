# State Memory

**Current Phase:** Feature Development

## Decisions

- **Virtual Audio Output:** For v1 and general release, the system will require the user to install a third-party Virtual Audio Cable (e.g., VB-Audio Cable). Developing and distributing a custom Windows WDM/KS kernel audio driver requires Extended Validation (EV) code signing certificates and passing WHQL to bypass strict Windows security checks (Secure Boot/Test Mode), which is too complex and costly for an initial MVP. The C++ Core Audio will be designed with an abstraction layer so a custom driver can be adopted seamlessly in the future if needed.
- **Voice Effects DSP falling back from FMOD:** Because FMOD is a proprietary commercial library requiring user-authenticated account downloads and licensing, we implemented the voice effects DSP logic (Pitch Shift, Chorus, Waveshaping Saturation) natively in C++ inside the audio core thread. This keeps the build process fully open-source and out-of-the-box.

## Blockers

- None currently.

## Lessons Learned

- Modulated delay line pitch shifting and chorus can be written in extremely low-latency time-domain loops in C++, achieving sub-1ms DSP processing time.
- Sample-by-sample linear interpolation (lerp) on effect gain prevents pops and clicks when enabling/disabling real-time voice effects.

## To-Dos

- Integrate Python inference engine boilerplate.
- Add more voice effects profiles (reverb, echo, flanger).

## Deferred Ideas

- Custom WDM/KS Virtual Audio Driver.
- Text-to-Speech (TTS) integration.
- VST Plugin Hosting.
