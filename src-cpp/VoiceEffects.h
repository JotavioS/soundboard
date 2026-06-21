#pragma once
#include <vector>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846f
#endif

// Modulated delay line pitch shifter (time-domain crossfaded dual-tap)
class PitchShifter {
private:
    std::vector<float> delayBuffer;
    int writePtr = 0;
    float playPtr1 = 0;
    float playPtr2 = 0;
    int bufferSize = 8192;
    float windowSize = 1920.0f; // 40ms window at 48kHz is standard for vocal transposing
    
public:
    PitchShifter() {
        delayBuffer.resize(bufferSize, 0.0f);
        playPtr1 = 0.0f;
        playPtr2 = windowSize / 2.0f;
    }
    
    void reset() {
        std::fill(delayBuffer.begin(), delayBuffer.end(), 0.0f);
        writePtr = 0;
        playPtr1 = 0.0f;
        playPtr2 = windowSize / 2.0f;
    }
    
    float process(float input, float pitchRatio) {
        delayBuffer[writePtr] = input;
        
        float offset1 = playPtr1;
        float offset2 = playPtr2;
        
        float readPtr1 = (float)writePtr - offset1;
        while (readPtr1 < 0.0f) readPtr1 += (float)bufferSize;
        float readPtr2 = (float)writePtr - offset2;
        while (readPtr2 < 0.0f) readPtr2 += (float)bufferSize;
        
        // Linear interpolation for tap 1
        int ip1 = (int)readPtr1;
        float frac1 = readPtr1 - (float)ip1;
        int ip1_next = (ip1 + 1) % bufferSize;
        float val1 = delayBuffer[ip1] * (1.0f - frac1) + delayBuffer[ip1_next] * frac1;
        
        // Linear interpolation for tap 2
        int ip2 = (int)readPtr2;
        float frac2 = readPtr2 - (float)ip2;
        int ip2_next = (ip2 + 1) % bufferSize;
        float val2 = delayBuffer[ip2] * (1.0f - frac2) + delayBuffer[ip2_next] * frac2;
        
        // Raised cosine window for crossfade
        float phase1 = playPtr1 / windowSize;
        float weight1 = 0.5f - 0.5f * cosf(2.0f * M_PI * phase1);
        float weight2 = 1.0f - weight1;
        
        float output = val1 * weight1 + val2 * weight2;
        
        // Rate is (1.0 - pitchRatio)
        float rate = 1.0f - pitchRatio;
        playPtr1 += rate;
        if (playPtr1 >= windowSize) playPtr1 -= windowSize;
        if (playPtr1 < 0.0f) playPtr1 += windowSize;
        
        playPtr2 += rate;
        if (playPtr2 >= windowSize) playPtr2 -= windowSize;
        if (playPtr2 < 0.0f) playPtr2 += windowSize;
        
        writePtr = (writePtr + 1) % bufferSize;
        
        return output;
    }
};

// Modulated delay line chorus
class Chorus {
private:
    std::vector<float> delayBuffer;
    int writePtr = 0;
    int bufferSize = 8192;
    float lfoPhase = 0.0f;
    
public:
    Chorus() {
        delayBuffer.resize(bufferSize, 0.0f);
    }
    
    void reset() {
        std::fill(delayBuffer.begin(), delayBuffer.end(), 0.0f);
        writePtr = 0;
        lfoPhase = 0.0f;
    }
    
    float process(float input, float sampleRate, float rateHz, float depthMs, float mix) {
        delayBuffer[writePtr] = input;
        
        float nominalDelaySamples = 0.015f * sampleRate; // 15ms nominal delay
        float maxModSamples = (depthMs / 1000.0f) * sampleRate;
        
        float lfo = sinf(lfoPhase);
        float delaySamples = nominalDelaySamples + maxModSamples * lfo;
        
        // Update LFO phase
        lfoPhase += 2.0f * M_PI * rateHz / sampleRate;
        if (lfoPhase >= 2.0f * M_PI) lfoPhase -= 2.0f * M_PI;
        
        float readPtr = (float)writePtr - delaySamples;
        while (readPtr < 0.0f) readPtr += (float)bufferSize;
        
        int ip = (int)readPtr;
        float frac = readPtr - (float)ip;
        int ip_next = (ip + 1) % bufferSize;
        float delayedVal = delayBuffer[ip] * (1.0f - frac) + delayBuffer[ip_next] * frac;
        
        writePtr = (writePtr + 1) % bufferSize;
        
        return (1.0f - mix) * input + mix * delayedVal;
    }
};

// Smooth cubic waveshaper (C1 continuous at boundaries)
inline float saturate(float input, float drive) {
    float x = input * drive;
    if (x > 1.0f) return 1.0f;
    if (x < -1.0f) return -1.0f;
    return (x - (x * x * x) / 3.0f) * 1.5f;
}
