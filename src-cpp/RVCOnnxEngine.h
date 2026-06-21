#pragma once

#include <string>
#include <vector>
#include <memory>
#include <mutex>

// Forward declaration of ONNX Runtime environment and sessions
namespace Ort {
    class Env;
    class Session;
}

class RVCOnnxEngine {
public:
    RVCOnnxEngine();
    ~RVCOnnxEngine();

    bool loadModel(const std::string& modelPath);
    bool loadHubert(const std::string& hubertPath);
    bool loadRmvpe(const std::string& rmvpePath);

    void setPitch(int pitch);

    // Process a chunk of audio (48000Hz).
    // The input vector contains float samples [-1.0, 1.0].
    // Returns the processed audio.
    std::vector<float> process(const std::vector<float>& inputAudio);

private:
    std::unique_ptr<Ort::Env> env_;
    std::unique_ptr<Ort::Session> session_model_;
    std::unique_ptr<Ort::Session> session_hubert_;
    std::unique_ptr<Ort::Session> session_rmvpe_;

    int pitch_ = 0;
    
    // Internal buffer for accumulating audio
    std::vector<float> audioBuffer_;
    size_t requiredFrames_ = 30720; // 640ms at 48kHz to match main.cpp chunk size

    // DSP Methods
    std::vector<float> resample(const std::vector<float>& input, int inRate, int outRate);
    void initMelFilterbank(int sr, int n_fft, int n_mels, int fmin, int fmax);
    std::vector<float> computeMelSpectrogram(const std::vector<float>& audio16k);
    std::vector<int64_t> runRMVPE(const std::vector<float>& melSpec, int seqLen, std::vector<float>& outPitchf);
    std::vector<float> runHubert(const std::vector<float>& audio16k, int& outSeqLen);
    std::vector<float> runNetG(const std::vector<float>& hubertFeatures, const std::vector<int64_t>& pitch, const std::vector<float>& pitchf, int seqLen);

    // DSP Caches
    std::vector<float> hannWindow_;
    std::vector<std::vector<float>> melFilterbank_;
};
