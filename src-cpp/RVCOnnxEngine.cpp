#define NOMINMAX
#include "RVCOnnxEngine.h"
#include <iostream>
#include <vector>
#include <cmath>
#include <algorithm>
#include <stdexcept>
#include <windows.h>
#include <chrono>
#include <onnxruntime_cxx_api.h>
#include "pocketfft_hdronly.h"
#include "mel_basis.h"
#include <random>

namespace {
void logAvailableExecutionProviders() {
    try {
        std::vector<std::string> providers = Ort::GetAvailableProviders();
        std::cout << "ONNX Runtime available providers:";
        for (const auto& provider : providers) {
            std::cout << " " << provider;
        }
        std::cout << std::endl;
    } catch (const std::exception& e) {
        std::cout << "Unable to enumerate ONNX Runtime providers: " << e.what() << std::endl;
    }
}

Ort::SessionOptions createCudaSessionOptions(const std::string& modelPath) {
    Ort::SessionOptions sessionOptions;
    sessionOptions.SetIntraOpNumThreads(4);
    sessionOptions.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_BASIC);

    sessionOptions.DisableMemPattern();
    sessionOptions.DisableCpuMemArena();

    try {
        OrtCUDAProviderOptions cuda_options{};
        cuda_options.device_id = 0;
        cuda_options.arena_extend_strategy = 1;
        cuda_options.cudnn_conv_algo_search = OrtCudnnConvAlgoSearchHeuristic;
        
        sessionOptions.AppendExecutionProvider_CUDA(cuda_options);
        std::cout << "CUDA Execution Provider requested for " << modelPath << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "CUDA Execution Provider unavailable for " << modelPath
                  << ": " << e.what() << std::endl;
        std::cerr << "Falling back to CPU for this session." << std::endl;
    }

    return sessionOptions;
}

Ort::SessionOptions createCpuSessionOptions() {
    Ort::SessionOptions sessionOptions;
    sessionOptions.SetIntraOpNumThreads(4);
    sessionOptions.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_BASIC);
    return sessionOptions;
}
}

// Basic Linear Resampler (48000 -> 16000 and 16000 -> 48000)
std::vector<float> RVCOnnxEngine::resample(const std::vector<float>& input, int inRate, int outRate) {
    if (inRate == outRate || input.empty()) return input;
    double ratio = (double)outRate / inRate;
    size_t outSize = (size_t)(input.size() * ratio);
    std::vector<float> output(outSize);
    for (size_t i = 0; i < outSize; ++i) {
        double srcIdx = i / ratio;
        size_t idx1 = (size_t)srcIdx;
        size_t idx2 = std::min(idx1 + 1, input.size() - 1);
        float frac = srcIdx - idx1;
        output[i] = input[idx1] * (1.0f - frac) + input[idx2] * frac;
    }
    return output;
}

// Compute Mel Spectrogram
std::vector<float> RVCOnnxEngine::computeMelSpectrogram(const std::vector<float>& audio16k) {
    int n_fft = 1024;
    int hop_length = 160;
    int pad = n_fft / 2; // 512
    
    std::vector<float> paddedAudio(audio16k.size() + 2 * pad);
    for(int i=0; i<pad; ++i) paddedAudio[pad - 1 - i] = audio16k[i];
    for(size_t i=0; i<audio16k.size(); ++i) paddedAudio[pad + i] = audio16k[i];
    for(int i=0; i<pad; ++i) paddedAudio[pad + audio16k.size() + i] = audio16k[audio16k.size() - 1 - i];
    
    int num_frames = 1 + (paddedAudio.size() - n_fft) / hop_length;
    int n_mels = 128;
    int n_freqs = n_fft / 2 + 1; // 513
    
    std::vector<float> melSpec(1 * n_mels * num_frames, 0.0f);
    
    pocketfft::shape_t shape = {(size_t)n_fft};
    pocketfft::stride_t stride = {sizeof(double)};
    pocketfft::stride_t stride_out = {2 * sizeof(double)};
    
    std::vector<double> in(n_fft);
    std::vector<std::complex<double>> out(n_freqs);
    
    for (int frame = 0; frame < num_frames; ++frame) {
        int start = frame * hop_length;
        for (int i = 0; i < n_fft; ++i) {
            in[i] = paddedAudio[start + i] * hann_window[i];
        }
        
        pocketfft::r2c(shape, stride, stride_out, 0, pocketfft::FORWARD, in.data(), out.data(), 1.0);
        
        std::vector<float> mag(n_freqs);
        for(int i=0; i<n_freqs; ++i) {
            mag[i] = std::sqrt(out[i].real()*out[i].real() + out[i].imag()*out[i].imag() + 1e-9f);
        }
        
        for (int m = 0; m < n_mels; ++m) {
            float sum = 0.0f;
            for (int f = 0; f < n_freqs; ++f) {
                sum += mel_basis[m][f] * mag[f];
            }
            sum = std::log(std::max(sum, 1e-5f));
            melSpec[m * num_frames + frame] = sum;
        }
    }
    
    return melSpec;
}

std::vector<int64_t> RVCOnnxEngine::runRMVPE(const std::vector<float>& melSpec, int seqLen, std::vector<float>& outPitchf) {
    if (!session_rmvpe_ || melSpec.empty()) {
        outPitchf.assign(seqLen, 0.0f);
        return std::vector<int64_t>(seqLen, 0);
    }
    
    Ort::MemoryInfo memoryInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    
    int mel_frames = melSpec.size() / 128;
    
    // Pad mel frames to next multiple of 32 (RMVPE U-Net requirement)
    int padded_frames = ((mel_frames + 31) / 32) * 32;
    std::vector<float> inputData(128 * padded_frames, 0.0f);
    for (int m = 0; m < 128; ++m) {
        for (int t = 0; t < mel_frames; ++t) {
            inputData[m * padded_frames + t] = melSpec[m * mel_frames + t];
        }
    }
    std::vector<int64_t> inputShape = {1, 128, padded_frames};
    Ort::Value inputTensor = Ort::Value::CreateTensor<float>(memoryInfo, inputData.data(), inputData.size(), inputShape.data(), inputShape.size());
    
    const char* inputNames[] = {"input"};
    const char* outputNames[] = {"output"};
    
    try {
        auto outputTensors = session_rmvpe_->Run(Ort::RunOptions{nullptr}, inputNames, &inputTensor, 1, outputNames, 1);
        float* outData = outputTensors.front().GetTensorMutableData<float>();
        auto outShape = outputTensors.front().GetTensorTypeAndShapeInfo().GetShape();
        
        int out_frames = outShape[1];
        int num_bins = outShape[2]; // 360
        
        std::vector<int64_t> pitch(seqLen, 0);
        outPitchf.assign(seqLen, 0.0f);
        
        for (int i = 0; i < std::min(seqLen, out_frames); ++i) {
            float max_val = -1e9f;
            int max_idx = 0;
            for (int b = 0; b < num_bins; ++b) {
                float val = outData[i * num_bins + b];
                if (val > max_val) { max_val = val; max_idx = b; }
            }
            float f0 = 0.0f;
            if (max_val > 0.03f) {
                float product_sum = 0.0f;
                float weight_sum = 0.0f;
                for (int b = max_idx - 4; b <= max_idx + 4; ++b) {
                    if (b >= 0 && b < num_bins) {
                        float val = outData[i * num_bins + b];
                        float cent = 20.0f * (float)b + 1997.3794084376191f;
                        product_sum += val * cent;
                        weight_sum += val;
                    }
                }
                float cents_pred = (weight_sum > 0.0f) ? (product_sum / weight_sum) : 0.0f;
                if (cents_pred > 0.0f) {
                    f0 = 10.0f * std::pow(2.0f, cents_pred / 1200.0f);
                }
            }
            
            if (f0 > 0.0f && pitch_ != 0) {
                f0 *= std::pow(2.0f, pitch_ / 12.0f);
            }
            
            outPitchf[i] = f0;
            
            if (f0 > 0.0f) {
                double f0_mel = 1127.0 * std::log(1.0 + f0 / 700.0);
                double f0_mel_min = 1127.0 * std::log(1.0 + 50.0 / 700.0);
                double f0_mel_max = 1127.0 * std::log(1.0 + 1100.0 / 700.0);
                f0_mel = (f0_mel - f0_mel_min) * 254.0 / (f0_mel_max - f0_mel_min) + 1.0;
                
                int p = (int)std::round(f0_mel);
                if (p < 1) p = 1;
                if (p > 255) p = 255;
                pitch[i] = p;
            } else {
                pitch[i] = 0;
            }
        }
        return pitch;
    } catch (const std::exception& e) {
        std::cerr << "RMVPE Error: " << e.what() << std::endl;
        outPitchf.assign(seqLen, 0.0f);
        return std::vector<int64_t>(seqLen, 0);
    }
}

std::vector<float> RVCOnnxEngine::runHubert(const std::vector<float>& audio16k, int& outSeqLen) {
    if (!session_hubert_ || audio16k.empty()) {
        outSeqLen = audio16k.size() / 320; // HubERT reduces length by ~320
        if (outSeqLen == 0) outSeqLen = 1;
        return std::vector<float>(1 * 256 * outSeqLen, 0.0f);
    }
    
    std::vector<float> paddedAudio = audio16k;
    int L = paddedAudio.size();
    int pad = 0;
    
    // Known safe paddings for UI chunkSec presets
    if (L == 4000) pad = 0;
    else if (L == 8000) pad = 0;
    else if (L == 10240) pad = 80;
    else if (L == 16000) pad = 80;
    else {
        // Fallback for unknown sizes: pad to next multiple of 400, then test if +80 is needed
        // (Just a generic fallback, should rarely be hit since UI only sends these 4 sizes)
        int mod = L % 640;
        if (mod < 80 || mod > 380) {
            int needed = (200 - mod);
            if (needed < 0) needed += 640;
            pad = needed;
        }
    }
    
    if (pad > 0) {
        paddedAudio.resize(L + pad, 0.0f);
    }
    
    // HubERT ONNX Inference
    Ort::MemoryInfo memoryInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    std::vector<int64_t> inputShape = {1, (int64_t)paddedAudio.size()};
    
    // Create tensors from data
    Ort::Value sourceTensor = Ort::Value::CreateTensor<float>(memoryInfo, paddedAudio.data(), paddedAudio.size(), inputShape.data(), inputShape.size());
    
    std::vector<uint8_t> maskData(paddedAudio.size(), 0);
    Ort::Value paddingTensor = Ort::Value::CreateTensor<bool>(memoryInfo, (bool*)maskData.data(), maskData.size(), inputShape.data(), inputShape.size());
    
    size_t numInputs = session_hubert_->GetInputCount();
    
    Ort::Value inputTensors[2] = {std::move(sourceTensor), std::move(paddingTensor)};
    std::vector<const char*> inputNames;
    std::vector<Ort::Value> runTensors;
    std::vector<const char*> outputNames;
    
    if (numInputs == 1) {
        // New exported model without padding_mask, output is "embed"
        inputNames.push_back("source");
        runTensors.push_back(std::move(inputTensors[0]));
        outputNames.push_back("embed");
    } else {
        // Original model with padding_mask, output is "features"
        inputNames.push_back("source");
        inputNames.push_back("padding_mask");
        runTensors.push_back(std::move(inputTensors[0]));
        runTensors.push_back(std::move(inputTensors[1]));
        outputNames.push_back("features");
    }
    
    try {
        auto outputTensors = session_hubert_->Run(Ort::RunOptions{nullptr}, inputNames.data(), runTensors.data(), inputNames.size(), outputNames.data(), 1);
        float* outData = outputTensors.front().GetTensorMutableData<float>();
        auto outShape = outputTensors.front().GetTensorTypeAndShapeInfo().GetShape();
        // HubERT output shape is [1, seq_len, 256]
        outSeqLen = outShape[1];
        size_t totalElements = outShape[0] * outShape[1] * outShape[2];
        return std::vector<float>(outData, outData + totalElements);
    } catch (const std::exception& e) {
        std::cerr << "HubERT Error: " << e.what() << std::endl;
        outSeqLen = audio16k.size() / 320;
        return std::vector<float>(1 * 768 * outSeqLen, 0.0f); // Defaulting to 768 for v2 fallback
    }
}

std::vector<float> RVCOnnxEngine::runNetG(const std::vector<float>& hubertFeatures, const std::vector<int64_t>& pitch, const std::vector<float>& pitchf, int seqLen) {
    if (!session_model_ || hubertFeatures.empty()) {
        return std::vector<float>(seqLen * 320, 0.0f);
    }
    
    Ort::MemoryInfo memoryInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    
    int hubertDim = hubertFeatures.size() / seqLen;
    
    std::vector<int64_t> phoneShape = {1, seqLen, hubertDim};
    std::vector<float> phoneData = hubertFeatures;
    Ort::Value phoneTensor = Ort::Value::CreateTensor<float>(memoryInfo, phoneData.data(), phoneData.size(), phoneShape.data(), phoneShape.size());
    
    std::vector<int64_t> phoneLengthsShape = {1};
    std::vector<int64_t> phoneLengthsData = {seqLen};
    Ort::Value phoneLengthsTensor = Ort::Value::CreateTensor<int64_t>(memoryInfo, phoneLengthsData.data(), phoneLengthsData.size(), phoneLengthsShape.data(), phoneLengthsShape.size());
    
    std::vector<int64_t> pitchShape = {1, seqLen};
    std::vector<int64_t> pitchData = pitch;
    Ort::Value pitchTensor = Ort::Value::CreateTensor<int64_t>(memoryInfo, pitchData.data(), pitchData.size(), pitchShape.data(), pitchShape.size());
    
    std::vector<int64_t> nsff0Shape = {1, seqLen};
    std::vector<float> nsff0Data = pitchf;
    Ort::Value nsff0Tensor = Ort::Value::CreateTensor<float>(memoryInfo, nsff0Data.data(), nsff0Data.size(), nsff0Shape.data(), nsff0Shape.size());
    
    std::vector<int64_t> sidShape = {1};
    std::vector<int64_t> sidData = {0}; // default speaker 0
    Ort::Value sidTensor = Ort::Value::CreateTensor<int64_t>(memoryInfo, sidData.data(), sidData.size(), sidShape.data(), sidShape.size());
    
    const char* inputNames[] = {"phone", "phone_lengths", "pitch", "nsff0", "sid"};
    Ort::Value inputTensors[] = {std::move(phoneTensor), std::move(phoneLengthsTensor), std::move(pitchTensor), std::move(nsff0Tensor), std::move(sidTensor)};
    
    const char* outputNames[] = {"audio"};
    
    try {
        auto outputTensors = session_model_->Run(Ort::RunOptions{nullptr}, inputNames, inputTensors, 5, outputNames, 1);
        float* outData = outputTensors.front().GetTensorMutableData<float>();
        auto outShape = outputTensors.front().GetTensorTypeAndShapeInfo().GetShape();
        size_t samples = outShape[2];
        return std::vector<float>(outData, outData + samples);
    } catch (const std::exception& e) {
        std::cerr << "Net_G Error: " << e.what() << std::endl;
        return {};
    }
}

RVCOnnxEngine::RVCOnnxEngine() {
    try {
        env_ = std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_WARNING, "RVCEngine");
        std::cout << "ONNX Runtime Initialized." << std::endl;
        logAvailableExecutionProviders();
    } catch (const std::exception& e) {
        std::cerr << "Failed to initialize ONNX Runtime: " << e.what() << std::endl;
    }
}

RVCOnnxEngine::~RVCOnnxEngine() = default;

bool RVCOnnxEngine::loadModel(const std::string& modelPath) {
    if (!env_) return false;
    try {
        Ort::SessionOptions sessionOptions = createCudaSessionOptions(modelPath);
        std::wstring w_path(modelPath.begin(), modelPath.end());
        session_model_ = std::make_unique<Ort::Session>(*env_, w_path.c_str(), sessionOptions);
        std::cout << "Successfully loaded RVC ONNX model: " << modelPath << std::endl;
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Error loading RVC ONNX model: " << e.what() << std::endl;
        return false;
    }
}

bool RVCOnnxEngine::loadHubert(const std::string& hubertPath) {
    if (!env_) return false;
    try {
        Ort::SessionOptions sessionOptions = createCudaSessionOptions(hubertPath);
        std::wstring w_path(hubertPath.begin(), hubertPath.end());
        session_hubert_ = std::make_unique<Ort::Session>(*env_, w_path.c_str(), sessionOptions);
        std::cout << "Successfully loaded HubERT ONNX model: " << hubertPath << std::endl;
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Error loading HubERT ONNX model: " << e.what() << std::endl;
        return false;
    }
}

bool RVCOnnxEngine::loadRmvpe(const std::string& rmvpePath) {
    if (!env_) return false;
    try {
        Ort::SessionOptions sessionOptions = createCudaSessionOptions(rmvpePath);
        std::wstring w_path(rmvpePath.begin(), rmvpePath.end());
        session_rmvpe_ = std::make_unique<Ort::Session>(*env_, w_path.c_str(), sessionOptions);
        std::cout << "Successfully loaded RMVPE ONNX model: " << rmvpePath << std::endl;
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Error loading RMVPE ONNX model: " << e.what() << std::endl;
        return false;
    }
}

void RVCOnnxEngine::setPitch(int pitch) {
    pitch_ = pitch;
}

std::vector<float> RVCOnnxEngine::process(const std::vector<float>& inputAudio) {
    if (!session_model_ || !session_hubert_ || !session_rmvpe_) {
        std::vector<float> out(inputAudio.size());
        for (size_t i = 0; i < inputAudio.size(); ++i) out[i] = inputAudio[i] * 0.5f;
        return out;
    }

    audioBuffer_.insert(audioBuffer_.end(), inputAudio.begin(), inputAudio.end());
    
    size_t currentChunkSize = inputAudio.size();
    
    if (audioBuffer_.size() < currentChunkSize) {
        return std::vector<float>(inputAudio.size(), 0.0f);
    }

    std::vector<float> blockToProcess(audioBuffer_.begin(), audioBuffer_.begin() + currentChunkSize);
    audioBuffer_.erase(audioBuffer_.begin(), audioBuffer_.begin() + currentChunkSize);

    // 1. Resample to 16kHz
    std::vector<float> audio16k = resample(blockToProcess, 48000, 16000);
    
    // 2. HubERT (runs at 50fps)
    auto t0 = std::chrono::high_resolution_clock::now();
    int seqLen50 = 0;
    std::vector<float> hubertFeats50 = runHubert(audio16k, seqLen50);
    auto t1 = std::chrono::high_resolution_clock::now();

    // Interpolate HubERT features to 100fps (repeat each frame twice)
    int hubertDim = (seqLen50 > 0) ? (hubertFeats50.size() / seqLen50) : 768;
    int seqLen100 = seqLen50 * 2;
    std::vector<float> hubertFeats100(seqLen100 * hubertDim, 0.0f);
    for (int i = 0; i < seqLen50; ++i) {
        for (int j = 0; j < hubertDim; ++j) {
            float val = hubertFeats50[i * hubertDim + j];
            hubertFeats100[(i * 2) * hubertDim + j] = val;
            hubertFeats100[(i * 2 + 1) * hubertDim + j] = val;
        }
    }

    // 3. RMVPE (runs natively at 100fps)
    std::vector<float> mel = computeMelSpectrogram(audio16k);
    std::vector<float> pitchf;
    std::vector<int64_t> pitch = runRMVPE(mel, seqLen100, pitchf);
    auto t2 = std::chrono::high_resolution_clock::now();

    // 4. Net_G (expects 100fps inputs)
    std::vector<float> outAudio = runNetG(hubertFeats100, pitch, pitchf, seqLen100);
    auto t3 = std::chrono::high_resolution_clock::now();
    if (outAudio.empty()) {
        return std::vector<float>(inputAudio.size(), 0.0f);
    }
    
    auto t_hub = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
    auto t_rmv = std::chrono::duration_cast<std::chrono::milliseconds>(t2 - t1).count();
    auto t_net = std::chrono::duration_cast<std::chrono::milliseconds>(t3 - t2).count();
    
    static int timingLogCounter = 0;
    if ((t_hub + t_rmv + t_net) > 550 || (++timingLogCounter % 20) == 0) {
        std::cout << "[Timing] HubERT: " << t_hub << "ms, RMVPE: " << t_rmv << "ms, Net_G: " << t_net << "ms" << std::endl;
    }

    // 5. Determine Net_G output sample rate and resample back to 48kHz
    int tgt_sr = 40000;
    if (seqLen100 > 0 && outAudio.size() > 0) {
        tgt_sr = (outAudio.size() * 100) / seqLen100;
    }
    std::vector<float> out48k = resample(outAudio, tgt_sr, 48000);
    
    std::vector<float> finalOut(inputAudio.size(), 0.0f);
    for(size_t i=0; i<std::min(finalOut.size(), out48k.size()); ++i) {
        finalOut[i] = out48k[i];
    }
    return finalOut;
}
