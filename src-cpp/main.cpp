#define NOMINMAX
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

#include "json.hpp"
#include <iostream>
#include <RtAudio.h>
#include <zmq.hpp>
#include <cstring>
#include <thread>
#include <mutex>
#include <vector>
#include <deque>
#include <cmath>
#include <atomic>
#include "RVCOnnxEngine.h"
#include "rnnoise.h"
#include "VoiceEffects.h"

#ifdef _WIN32
#include <windows.h>
#endif

using json = nlohmann::json;

std::mutex audioMutex;
std::vector<float> soundBuffer;
size_t soundPlayIndex = 0;
bool isSoundPlaying = false;
std::atomic<bool> useVoiceChanger(false);
std::atomic<bool> hearMyself(false);
std::atomic<bool> useSatanic1(false);
std::atomic<bool> useSatanic2(false);
std::atomic<bool> useSatanic3(false);
std::atomic<bool> useNoiseSuppression(true);
float soundVolume = 1.0f;
std::atomic<bool> running(true);
std::atomic<bool> deviceChangeRequested(false);
std::string targetInputDeviceName = "";

std::mutex ringMutex;
std::deque<float> hearMyselfRingBuffer;
const size_t MAX_RING_BUFFER_SIZE = 48000; // max 1 second of drift

// Global RVC Engine
std::unique_ptr<RVCOnnxEngine> rvcEngine;

// Voice Changer ring buffers (must be global so callback + worker + IPC thread can all access)
std::mutex vcInMutex, vcOutMutex;
std::deque<float> vcInputRing;
std::deque<float> vcOutputRing;
std::condition_variable vcInputCV;
std::atomic<size_t> vcChunkFrames(30720);
const size_t VC_INPUT_MAX = 48000 * 3;
const size_t VC_OUTPUT_MAX = 48000 * 3;
std::atomic<size_t> vcOutputPreroll(12000); // 250 ms jitter buffer at 48 kHz
bool vcOutputPrimed = false;
std::atomic<uint64_t> vcUnderruns(0);

// Pending model path - IPC sets it, worker thread loads it between inference passes
std::mutex pendingModelMutex;
std::string pendingModelPath;
std::string loadedModelPath;
std::atomic<bool> hasPendingModel(false);

std::string currentEmbedder = "hubert_base";
std::string appDataDirStr = "C:/development/soundboard";

// Thread function for IPC Command loop (ZMQ REP on 5556)
void ipcCommandThread(zmq::context_t* context) {
    zmq::socket_t socket(*context, zmq::socket_type::rep);
    socket.bind("tcp://127.0.0.1:5556");
    std::cout << "IPC Command Thread listening on tcp://127.0.0.1:5556" << std::endl;
    
    while(true) {
        zmq::message_t request;
        auto res = socket.recv(request, zmq::recv_flags::none);
        if (res) {
            std::string msg(static_cast<char*>(request.data()), request.size());
            try {
                auto j = json::parse(msg);
                std::string cmd = j.value("cmd", "");
                
                if (cmd == "PLAY_SOUND") {
                    std::string path = j.value("path", "");
                    float volume = j.value("volume", 1.0f);
                    float startTime = j.value("startTime", 0.0f);
                    float endTime = j.value("endTime", 0.0f);
                    
                    std::cout << "PLAY_SOUND: " << path << std::endl;
                    
                    // Decode using miniaudio
                    ma_decoder decoder;
                    ma_decoder_config config = ma_decoder_config_init(ma_format_f32, 1, 48000);
                    
                    ma_result result;
#ifdef _WIN32
                    int wlen = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, NULL, 0);
                    std::wstring wpath(wlen, 0);
                    MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, &wpath[0], wlen);
                    result = ma_decoder_init_file_w(wpath.c_str(), &config, &decoder);
#else
                    result = ma_decoder_init_file(path.c_str(), &config, &decoder);
#endif
                    
                    if (result == MA_SUCCESS) {
                        ma_uint64 totalFrames;
                        ma_decoder_get_length_in_pcm_frames(&decoder, &totalFrames);
                        
                        std::vector<float> tempBuf(totalFrames);
                        ma_decoder_read_pcm_frames(&decoder, tempBuf.data(), totalFrames, NULL);
                        ma_decoder_uninit(&decoder);
                        
                        // Apply volume and trim
                        size_t startFrame = static_cast<size_t>(startTime * 48000);
                        size_t endFrame = (endTime > 0.0f) ? static_cast<size_t>(endTime * 48000) : totalFrames;
                        if (startFrame >= totalFrames) startFrame = 0;
                        if (endFrame > totalFrames) endFrame = totalFrames;
                        if (endFrame < startFrame) endFrame = totalFrames;
                        
                        std::lock_guard<std::mutex> lock(audioMutex);
                        soundBuffer.clear();
                        soundBuffer.insert(soundBuffer.end(), tempBuf.begin() + startFrame, tempBuf.begin() + endFrame);
                        soundVolume = volume;
                        soundPlayIndex = 0;
                        isSoundPlaying = true;
                    } else {
                        std::cout << "Failed to decode audio file: " << path << std::endl;
                        zmq::message_t reply(5);
                        memcpy(reply.data(), "ERROR", 5);
                        socket.send(reply, zmq::send_flags::none);
                        continue;
                    }
                } else if (cmd == "STOP_SOUND") {
                    std::lock_guard<std::mutex> lock(audioMutex);
                    isSoundPlaying = false;
                } else if (cmd == "SET_VOICE_CHANGER") {
                    bool enabled = j.value("enabled", false);
                    useVoiceChanger.store(enabled);
                    std::cout << "Voice Changer set to: " << enabled << std::endl;
                    if (enabled) {
                        std::lock_guard<std::mutex> lock(vcOutMutex);
                        vcOutputRing.clear();
                        vcOutputPrimed = false;
                        vcUnderruns = 0;
                    }
                    vcInputCV.notify_one(); // Wake worker thread
                } else if (cmd == "SET_HEAR_MYSELF") {
                    bool hm = j.value("enabled", false);
                    hearMyself.store(hm);
                    std::cout << "Hear Myself set to: " << hm << std::endl;
                } else if (cmd == "SET_SATANIC_1") {
                    bool enabled = j.value("enabled", false);
                    useSatanic1.store(enabled);
                    if (enabled) {
                        useSatanic2.store(false);
                        useSatanic3.store(false);
                    }
                    std::cout << "Satanic 1 set to: " << enabled << std::endl;
                } else if (cmd == "SET_SATANIC_2") {
                    bool enabled = j.value("enabled", false);
                    useSatanic2.store(enabled);
                    if (enabled) {
                        useSatanic1.store(false);
                        useSatanic3.store(false);
                    }
                    std::cout << "Satanic 2 set to: " << enabled << std::endl;
                } else if (cmd == "SET_SATANIC_3") {
                    bool enabled = j.value("enabled", false);
                    useSatanic3.store(enabled);
                    if (enabled) {
                        useSatanic1.store(false);
                        useSatanic2.store(false);
                    }
                    std::cout << "Satanic 3 set to: " << enabled << std::endl;
                } else if (cmd == "SET_NOISE_SUPPRESSION") {
                    bool enabled = j.value("enabled", true);
                    useNoiseSuppression.store(enabled);
                    std::cout << "Noise Suppression set to: " << enabled << std::endl;
                } else if (cmd == "GET_INPUT_DEVICES") {
                    RtAudio audio_temp;
                    std::vector<std::string> device_names;
                    std::vector<unsigned int> ids = audio_temp.getDeviceIds();
                    for (unsigned int id : ids) {
                        RtAudio::DeviceInfo info = audio_temp.getDeviceInfo(id);
                        if (info.inputChannels > 0) {
                            device_names.push_back(info.name);
                        }
                    }
                    json response = {
                        {"status", "OK"},
                        {"devices", device_names}
                    };
                    std::string resp_str = response.dump();
                    zmq::message_t reply(resp_str.size());
                    std::memcpy(reply.data(), resp_str.data(), resp_str.size());
                    socket.send(reply, zmq::send_flags::none);
                    continue;
                } else if (cmd == "TRIM_AUDIO") {
                    std::string sourcePath = j.value("sourcePath", "");
                    std::string destPath = j.value("destPath", "");
                    float startTime = j.value("startTime", 0.0f);
                    float endTime = j.value("endTime", 0.0f);
                    
                    std::cout << "TRIM_AUDIO: " << sourcePath << " -> " << destPath 
                              << " [" << startTime << "s to " << endTime << "s]" << std::endl;
                    
                    ma_decoder decoder;
                    ma_decoder_config config = ma_decoder_config_init(ma_format_f32, 1, 48000);
                    ma_result result;
                    
#ifdef _WIN32
                    int wlen_src = MultiByteToWideChar(CP_UTF8, 0, sourcePath.c_str(), -1, NULL, 0);
                    std::wstring wsourcePath(wlen_src, 0);
                    MultiByteToWideChar(CP_UTF8, 0, sourcePath.c_str(), -1, &wsourcePath[0], wlen_src);
                    result = ma_decoder_init_file_w(wsourcePath.c_str(), &config, &decoder);
#else
                    result = ma_decoder_init_file(sourcePath.c_str(), &config, &decoder);
#endif

                    if (result != MA_SUCCESS) {
                        std::cerr << "TRIM_AUDIO failed: Cannot open/decode source file" << std::endl;
                        zmq::message_t reply(5);
                        memcpy(reply.data(), "ERROR", 5);
                        socket.send(reply, zmq::send_flags::none);
                        continue;
                    }

                    ma_uint64 totalFrames;
                    ma_decoder_get_length_in_pcm_frames(&decoder, &totalFrames);
                    std::vector<float> tempBuf(totalFrames);
                    ma_decoder_read_pcm_frames(&decoder, tempBuf.data(), totalFrames, NULL);
                    ma_decoder_uninit(&decoder);

                    size_t startFrame = static_cast<size_t>(startTime * 48000.0f);
                    size_t endFrame = static_cast<size_t>(endTime * 48000.0f);
                    if (startFrame >= totalFrames) startFrame = 0;
                    if (endFrame > totalFrames || endFrame == 0) endFrame = totalFrames;
                    if (endFrame < startFrame) endFrame = totalFrames;

                    size_t slicedFrames = endFrame - startFrame;
                    std::vector<float> slicedBuf(slicedFrames);
                    std::copy(tempBuf.begin() + startFrame, tempBuf.begin() + endFrame, slicedBuf.begin());

                    ma_encoder_config encoderConfig = ma_encoder_config_init(ma_encoding_format_wav, ma_format_f32, 1, 48000);
                    ma_encoder encoder;
                    ma_result initResult;

#ifdef _WIN32
                    int wlen_dest = MultiByteToWideChar(CP_UTF8, 0, destPath.c_str(), -1, NULL, 0);
                    std::wstring wdestPath(wlen_dest, 0);
                    MultiByteToWideChar(CP_UTF8, 0, destPath.c_str(), -1, &wdestPath[0], wlen_dest);
                    initResult = ma_encoder_init_file_w(wdestPath.c_str(), &encoderConfig, &encoder);
#else
                    initResult = ma_encoder_init_file(destPath.c_str(), &encoderConfig, &encoder);
#endif

                    if (initResult != MA_SUCCESS) {
                        std::cerr << "TRIM_AUDIO failed: Cannot open dest file for writing" << std::endl;
                        zmq::message_t reply(5);
                        memcpy(reply.data(), "ERROR", 5);
                        socket.send(reply, zmq::send_flags::none);
                        continue;
                    }

                    ma_encoder_write_pcm_frames(&encoder, slicedBuf.data(), slicedFrames, NULL);
                    ma_encoder_uninit(&encoder);

                    zmq::message_t reply(2);
                    memcpy(reply.data(), "OK", 2);
                    socket.send(reply, zmq::send_flags::none);
                    continue;
                } else if (cmd == "SET_INPUT_DEVICE") {
                    std::string deviceName = j.value("device_name", "");
                    if (!deviceName.empty()) {
                        targetInputDeviceName = deviceName;
                        deviceChangeRequested = true;
                        std::cout << "SET_INPUT_DEVICE requested: " << deviceName << std::endl;
                    }
                } else if (cmd == "SET_VOICE_MODEL") {
                    std::string path = j.value("path", "");
                    std::cout << "SET_VOICE_MODEL requested: " << path << std::endl;
                    // Queue model load to be done on the worker thread (safe: no concurrent ONNX use)
                    {
                        std::lock_guard<std::mutex> lock(pendingModelMutex);
                        pendingModelPath = path;
                        hasPendingModel.store(true);
                    }
                    vcInputCV.notify_one(); // Wake worker to process the pending load
                } else if (cmd == "SET_PITCH") {
                    int pitch = j.value("pitch", 0);
                    std::cout << "SET_PITCH requested: " << pitch << std::endl;
                    if (rvcEngine) {
                        rvcEngine->setPitch(pitch);
                    }
                } else if (cmd == "SET_VOICE_CONTROL") {
                    std::string estimator = j.value("pitch_estimator", "rmvpe");
                    float indexRate = j.value("index_rate", 0.7f);
                    size_t chunkFrames = j.value("chunk_frames", 30720);
                    size_t extraFrames = j.value("extra_frames", 12000);
                    std::string embedder = j.value("embedder", "hubert_base");
                    
                    std::cout << "SET_VOICE_CONTROL: " 
                              << " estimator=" << estimator 
                              << " chunk=" << chunkFrames 
                              << " extra=" << extraFrames 
                              << " embedder=" << embedder << std::endl;
                              
                    vcChunkFrames.store(chunkFrames);
                    vcOutputPreroll.store(extraFrames);
                    
                    if (embedder != currentEmbedder) {
                        std::cout << "Loading new embedder: " << embedder << std::endl;
                        try {
                            rvcEngine->loadHubert(appDataDirStr + "/models/" + embedder + ".onnx");
                            currentEmbedder = embedder;
                        } catch (const std::exception& e) {
                            std::cerr << "Failed to load new embedder: " << e.what() << std::endl;
                        }
                    }
                    
                    // RVC engine handles dynamic sizing naturally if process() is called with the requested chunk size.
                    // (Ignoring FAISS Index and alternate pitch estimators for now since they are not compiled in yet)
                } else {
                    std::cout << "Unknown IPC Command: " << cmd << std::endl;
                    zmq::message_t reply(3);
                    std::memcpy(reply.data(), "ERR", 3);
                    socket.send(reply, zmq::send_flags::none);
                    continue;
                }
                
                zmq::message_t reply(2);
                std::memcpy(reply.data(), "OK", 2);
                socket.send(reply, zmq::send_flags::none);
                
            } catch(const std::exception& e) {
                std::cerr << "IPC Error: " << e.what() << std::endl;
                zmq::message_t reply(3);
                std::memcpy(reply.data(), "ERR", 3);
                socket.send(reply, zmq::send_flags::none);
            }
        }
    }
}

// Worker thread: pulls from vcInputRing, runs RNNoise + RVC, pushes to vcOutputRing
void voiceChangerWorker() {
#ifdef _WIN32
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
#endif

    DenoiseState* rnnoise_state = rnnoise_create(NULL);

    while (running.load()) {
        // Check if there's a pending model to load (on worker thread = safe, no concurrent ONNX use)
        {
            std::string pathToLoad;
            {
                std::lock_guard<std::mutex> lock(pendingModelMutex);
                if (hasPendingModel.load()) {
                    pathToLoad = pendingModelPath;
                    hasPendingModel.store(false);
                }
            }
            if (!pathToLoad.empty() && rvcEngine) {
                if (pathToLoad == loadedModelPath) {
                    continue;
                }
                std::cout << "Worker: loading model " << pathToLoad << std::endl;
                if (rvcEngine->loadModel(pathToLoad)) {
                    loadedModelPath = pathToLoad;
                }
                // Clear rings so we start fresh with the new model
                { std::lock_guard<std::mutex> lk(vcInMutex); vcInputRing.clear(); }
                {
                    std::lock_guard<std::mutex> lk(vcOutMutex);
                    vcOutputRing.clear();
                    vcOutputPrimed = false;
                }
            }
        }

        std::vector<float> chunk;
        {
            std::unique_lock<std::mutex> lock(vcInMutex);
            size_t currentChunkFrames = vcChunkFrames.load();
            vcInputCV.wait(lock, [&]{
                return !running.load() || hasPendingModel.load() || (!useVoiceChanger.load()) || vcInputRing.size() >= currentChunkFrames;
            });
            if (!running.load()) break;
            if (hasPendingModel.load()) continue; // loop back to load model first
            if (!useVoiceChanger.load() || vcInputRing.size() < currentChunkFrames) continue;
            
            chunk.assign(vcInputRing.begin(), vcInputRing.begin() + currentChunkFrames);
            vcInputRing.erase(vcInputRing.begin(), vcInputRing.begin() + currentChunkFrames);
        }
        
        if (rvcEngine && !chunk.empty()) {
            // Apply RNNoise before RVC inference
            // RNNoise processes 10ms (480 frames at 48kHz) and expects 16-bit PCM float range (-32768 to 32767)
            for (size_t i = 0; i < chunk.size(); i += 480) {
                float rnn_buf[480];
                for (int j = 0; j < 480; j++) {
                    rnn_buf[j] = chunk[i + j] * 32768.0f;
                }
                rnnoise_process_frame(rnnoise_state, rnn_buf, rnn_buf);
                for (int j = 0; j < 480; j++) {
                    chunk[i + j] = rnn_buf[j] / 32768.0f;
                }
            }
            
            // Calculate RMS to mute completely when not speaking (Noise Gate)
            // This prevents the AI model from hallucinating faint static on pure silence.
            float sumSquares = 0.0f;
            for (float s : chunk) {
                sumSquares += s * s;
            }
            float rms = std::sqrt(sumSquares / chunk.size());
            
            if (rms < 0.001f) { // Approx -60dB
                std::lock_guard<std::mutex> lock(vcOutMutex);
                for (size_t i = 0; i < chunk.size(); ++i) {
                    vcOutputRing.push_back(0.0f);
                }
                while (vcOutputRing.size() > VC_OUTPUT_MAX) vcOutputRing.pop_front();
                continue;
            }
            
            try {
                auto processed = rvcEngine->process(chunk);
                std::lock_guard<std::mutex> lock(vcOutMutex);
                for (float s : processed) vcOutputRing.push_back(s);
                while (vcOutputRing.size() > VC_OUTPUT_MAX) vcOutputRing.pop_front();
            } catch (...) {
                // On error, push weak static instead of leaking mic or total silence
                std::lock_guard<std::mutex> lock(vcOutMutex);
                for (size_t i = 0; i < chunk.size(); ++i) {
                    float noise = ((rand() % 20000) / 10000.0f - 1.0f) * 0.00005f;
                    vcOutputRing.push_back(noise);
                }
                while (vcOutputRing.size() > VC_OUTPUT_MAX) vcOutputRing.pop_front();
            }
        }
    }
    
    rnnoise_destroy(rnnoise_state);
}

// Duplex audio callback
int audioCallback(void *outputBuffer, void *inputBuffer, unsigned int nBufferFrames,
                  double streamTime, RtAudioStreamStatus status, void *userData) {
    if (status) {
        std::cerr << "Stream over/underflow detected." << std::endl;
    }
    
    float *in = static_cast<float *>(inputBuffer);
    float *out = static_cast<float *>(outputBuffer);
    
    if (in == nullptr || out == nullptr) return 0;
    
    // --- Real-Time Noise Suppression ---
    static RealTimeDenoise denoiser;
    if (useNoiseSuppression.load()) {
        denoiser.process(in, nBufferFrames);
    } else {
        denoiser.reset();
    }
    
    size_t numBytes = nBufferFrames * sizeof(float);
    
    bool voiceChangerEnabled = useVoiceChanger.load();
    bool hearMyselfEnabled = hearMyself.load();

    if (voiceChangerEnabled && rvcEngine) {
        // Enqueue mic samples for background processing (non-blocking)
        {
            std::lock_guard<std::mutex> lock(vcInMutex);
            if (vcInputRing.size() < VC_INPUT_MAX) {
                for (unsigned int i = 0; i < nBufferFrames; ++i)
                    vcInputRing.push_back(in[i]);
            }
            // else: drop to avoid runaway lag
        }
        vcInputCV.notify_one();
        
        // Read processed output (non-blocking) 
        {
            std::lock_guard<std::mutex> lock(vcOutMutex);
            size_t currentPreroll = vcOutputPreroll.load();
            if (!vcOutputPrimed && vcOutputRing.size() >= currentPreroll) {
                vcOutputPrimed = true;
            }

            if (vcOutputPrimed && vcOutputRing.size() >= nBufferFrames) {
                for (unsigned int i = 0; i < nBufferFrames; ++i) {
                    out[i] = vcOutputRing.front();
                    vcOutputRing.pop_front();
                }
            } else {
                if (vcOutputPrimed) {
                    uint64_t underruns = ++vcUnderruns;
                    if (underruns <= 5 || underruns % 50 == 0) {
                        std::cerr << "Voice changer output underrun. buffered="
                                  << vcOutputRing.size() << " frames, needed="
                                  << nBufferFrames << std::endl;
                    }
                }
                vcOutputPrimed = false;
                // Keep the mic alive if conversion falls behind, but output weak static to avoid leaking real voice.
                for (unsigned int i = 0; i < nBufferFrames; ++i) {
                    out[i] = ((rand() % 20000) / 10000.0f - 1.0f) * 0.00005f;
                }
            }
        }
    } else {
        // Passthrough
        std::memcpy(out, in, numBytes);
        // Clear VC rings when disabled
        {
            std::lock_guard<std::mutex> lock(vcInMutex);
            vcInputRing.clear();
        }
        {
            std::lock_guard<std::mutex> lock(vcOutMutex);
            vcOutputRing.clear();
            vcOutputPrimed = false;
        }
    }
    
    // --- Apply Voice Effects (Satanic 1 / Satanic 2 / Satanic 3) ---
    static PitchShifter pitchShifter1;
    static Chorus chorus1;
    
    static PitchShifter pitchShifter2;
    static float ringModPhase = 0.0f;
    
    static PitchShifter pitchShifter3_1;
    static PitchShifter pitchShifter3_2;
    static Chorus chorus3;
    static float ringModPhase3 = 0.0f;
    
    static float currentMix1 = 0.0f;
    static float currentMix2 = 0.0f;
    static float currentMix3 = 0.0f;
    
    float targetMix1 = useSatanic1.load() ? 1.0f : 0.0f;
    float targetMix2 = useSatanic2.load() ? 1.0f : 0.0f;
    float targetMix3 = useSatanic3.load() ? 1.0f : 0.0f;
    float sampleRate = 48000.0f;
    
    for (unsigned int i = 0; i < nBufferFrames; ++i) {
        float sample = out[i];
        float processed = sample;
        
        currentMix1 += (targetMix1 - currentMix1) * 0.005f;
        currentMix2 += (targetMix2 - currentMix2) * 0.005f;
        currentMix3 += (targetMix3 - currentMix3) * 0.005f;
        
        float fx1 = sample;
        if (currentMix1 > 0.0001f) {
            fx1 = pitchShifter1.process(fx1, 0.65f);
            fx1 = chorus1.process(fx1, sampleRate, 1.5f, 5.0f, 0.5f);
            fx1 = saturate(fx1, 1.5f);
        }
        
        float fx2 = sample;
        if (currentMix2 > 0.0001f) {
            float carrier = sinf(ringModPhase);
            ringModPhase += 2.0f * M_PI * 45.0f / sampleRate;
            if (ringModPhase >= 2.0f * M_PI) ringModPhase -= 2.0f * M_PI;
            
            float modulated = sample * carrier;
            float grave = pitchShifter2.process(sample, 0.55f);
            fx2 = 0.6f * grave + 0.4f * modulated;
            
            if (fx2 > 0.8f) fx2 = 0.8f;
            else if (fx2 < -0.8f) fx2 = -0.8f;
        }
        
        float fx3 = sample;
        if (currentMix3 > 0.0001f) {
            float layer1 = pitchShifter3_1.process(fx3, 0.60f);
            layer1 = chorus3.process(layer1, sampleRate, 1.5f, 5.0f, 0.5f);
            
            float carrier = sinf(ringModPhase3);
            ringModPhase3 += 2.0f * M_PI * 40.0f / sampleRate;
            if (ringModPhase3 >= 2.0f * M_PI) ringModPhase3 -= 2.0f * M_PI;
            float modulated = fx3 * carrier;
            float layer2 = pitchShifter3_2.process(modulated, 0.70f);
            
            fx3 = 0.6f * layer1 + 0.4f * layer2;
            fx3 = saturate(fx3, 1.8f);
            if (fx3 > 0.85f) fx3 = 0.85f;
            else if (fx3 < -0.85f) fx3 = -0.85f;
        }
        
        if (currentMix1 > 0.0001f) {
            processed = (1.0f - currentMix1) * processed + currentMix1 * fx1;
        }
        if (currentMix2 > 0.0001f) {
            processed = (1.0f - currentMix2) * processed + currentMix2 * fx2;
        }
        if (currentMix3 > 0.0001f) {
            processed = (1.0f - currentMix3) * processed + currentMix3 * fx3;
        }
        
        out[i] = processed;
    }
    
    // Mix in Soundboard audio and prepare local mix
    std::vector<float> localMix(nBufferFrames, 0.0f);
    
    {
        std::lock_guard<std::mutex> lock(audioMutex);
        for (unsigned int i = 0; i < nBufferFrames; ++i) {
            float micSample = out[i];
            float soundSample = 0.0f;
            
            if (isSoundPlaying && soundPlayIndex < soundBuffer.size()) {
                soundSample = soundBuffer[soundPlayIndex++] * soundVolume;
            } else {
                isSoundPlaying = false;
            }
            
            // Virtual Cable Output (Mic + Sound)
            out[i] = micSample + soundSample;
            if (out[i] > 1.0f || out[i] < -1.0f) {
                out[i] = std::tanh(out[i]);
            }
            
            // Local Headset Output (Sound + Optional Mic)
            localMix[i] = soundSample;
            if (hearMyselfEnabled) {
                localMix[i] += micSample;
            }
            if (localMix[i] > 1.0f || localMix[i] < -1.0f) {
                localMix[i] = std::tanh(localMix[i]);
            }
        }
    }
    
    // Always push to secondary output ring buffer
    {
        std::lock_guard<std::mutex> rLock(ringMutex);
        if (hearMyselfRingBuffer.size() > MAX_RING_BUFFER_SIZE) {
            hearMyselfRingBuffer.erase(hearMyselfRingBuffer.begin(), hearMyselfRingBuffer.begin() + (hearMyselfRingBuffer.size() / 2));
        }
        for (unsigned int i = 0; i < nBufferFrames; ++i) {
            hearMyselfRingBuffer.push_back(localMix[i]);
        }
    }
    
    return 0;
}


// Secondary audio output callback (Headset)
int hearMyselfCallback(void *outputBuffer, void *inputBuffer, unsigned int nBufferFrames,
                  double streamTime, RtAudioStreamStatus status, void *userData) {
    float *out = static_cast<float *>(outputBuffer);
    if (out == nullptr) return 0;
    
    size_t numBytes = nBufferFrames * sizeof(float);
    
    std::lock_guard<std::mutex> rLock(ringMutex);
    if (hearMyselfRingBuffer.size() >= nBufferFrames) {
        for (unsigned int i = 0; i < nBufferFrames; ++i) {
            out[i] = hearMyselfRingBuffer.front();
            hearMyselfRingBuffer.pop_front();
        }
    } else {
        // Underflow
        std::memset(out, 0, numBytes);
    }
    
    return 0;
}

int main() {
    std::cout << "--- SoundboardCore Audio Engine ---" << std::endl;
    
    // Monitor stdin. When the parent GUI process dies, the stdin pipe closes.
    std::thread stdinMonitor([]() {
        std::string line;
        while (std::getline(std::cin, line)) {}
        std::cout << "Stdin pipe closed (GUI likely crashed/closed). Shutting down engine..." << std::endl;
        running.store(false);
    });
    stdinMonitor.detach();

    // Initialize ZMQ Context for IPC
    zmq::context_t context(1);
    std::thread ipcThread(ipcCommandThread, &context);
    ipcThread.detach();
    
    // Initialize RVC ONNX Engine
    rvcEngine = std::make_unique<RVCOnnxEngine>();
    
    // Try loading default base models
    if (const char* appData = std::getenv("APPDATA")) {
        appDataDirStr = std::string(appData);
        for (char& c : appDataDirStr) if (c == '\\') c = '/';
        appDataDirStr += "/soundboard";
    }

    rvcEngine->loadHubert(appDataDirStr + "/models/hubert_base.onnx");
    rvcEngine->loadRmvpe(appDataDirStr + "/models/rmvpe.onnx");
    
    // Start voice changer worker thread
    std::thread vcWorkerThread(voiceChangerWorker);
    vcWorkerThread.detach();
    
    RtAudio audio;
    if (audio.getDeviceCount() < 1) {
        std::cout << "No audio devices found!" << std::endl;
        return 1;
    }
    
    RtAudio::StreamParameters iParams, oParams;
    iParams.deviceId = audio.getDefaultInputDevice();
    iParams.nChannels = 1;
    iParams.firstChannel = 0;
    
    oParams.deviceId = audio.getDefaultOutputDevice();
    std::vector<unsigned int> deviceIds = audio.getDeviceIds();
    for (unsigned int id : deviceIds) {
        RtAudio::DeviceInfo info = audio.getDeviceInfo(id);
        if (info.outputChannels > 0) {
            std::string name = info.name;
            std::transform(name.begin(), name.end(), name.begin(), ::tolower);
            if (name.find("cable") != std::string::npos || name.find("virtual") != std::string::npos) {
                oParams.deviceId = id;
                std::cout << "Auto-selected Virtual Cable for output: " << info.name << std::endl;
                break;
            }
        }
    }
    oParams.nChannels = 1;
    oParams.firstChannel = 0;
    
    unsigned int sampleRate = 48000;
    unsigned int bufferFrames = 512;
    
    try {
        audio.openStream(&oParams, &iParams, RTAUDIO_FLOAT32,
                         sampleRate, &bufferFrames, &audioCallback, nullptr);
        audio.startStream();
    } catch (const std::exception& e) {
        std::cerr << "RtAudio Error: " << e.what() << std::endl;
        return 1;
    }
    
    // Secondary stream for Hear Myself
    RtAudio hearAudio;
    RtAudio::StreamParameters hearParams;
    hearParams.deviceId = hearAudio.getDefaultOutputDevice();
    hearParams.nChannels = 1;
    hearParams.firstChannel = 0;
    
    try {
        hearAudio.openStream(&hearParams, NULL, RTAUDIO_FLOAT32,
                             sampleRate, &bufferFrames, &hearMyselfCallback, NULL);
        hearAudio.startStream();
        std::cout << "Hear Myself stream started on default output device." << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "RtAudio Secondary Stream Error: " << e.what() << std::endl;
        // Don't exit, this is non-fatal for the main app
    }
    
    std::cout << "Audio stream started. Ready for commands." << std::endl;
    
    while (running.load()) {
        if (deviceChangeRequested) {
            std::cout << "Restarting audio stream with new input device: " << targetInputDeviceName << std::endl;
            deviceChangeRequested = false;
            
            try {
                audio.stopStream();
                if (audio.isStreamOpen()) {
                    audio.closeStream();
                }
                
                std::string targetLower = targetInputDeviceName;
                std::transform(targetLower.begin(), targetLower.end(), targetLower.begin(), ::tolower);
                
                std::vector<unsigned int> ids = audio.getDeviceIds();
                bool found = false;
                for (unsigned int id : ids) {
                    RtAudio::DeviceInfo info = audio.getDeviceInfo(id);
                    if (info.inputChannels > 0) {
                        std::string infoLower = info.name;
                        std::transform(infoLower.begin(), infoLower.end(), infoLower.begin(), ::tolower);
                        if (infoLower.find(targetLower) != std::string::npos || targetLower.find(infoLower) != std::string::npos) {
                            iParams.deviceId = id;
                            std::cout << "Successfully matched input device: " << info.name << std::endl;
                            found = true;
                            break;
                        }
                    }
                }
                if (!found) {
                    std::cout << "Warning: Could not find requested device name, keeping current." << std::endl;
                }
                
                audio.openStream(&oParams, &iParams, RTAUDIO_FLOAT32, sampleRate, &bufferFrames, &audioCallback, nullptr);
                audio.startStream();
                std::cout << "Stream restarted successfully." << std::endl;
                
            } catch (const std::exception& e) {
                std::cerr << "RtAudio Error on restart: " << e.what() << std::endl;
            }
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    try {
        audio.stopStream();
        if (audio.isStreamOpen()) {
            audio.closeStream();
        }
    } catch (const std::exception& e) {
        std::cerr << "RtAudio Error on close: " << e.what() << std::endl;
    }

    try {
        hearAudio.stopStream();
        if (hearAudio.isStreamOpen()) {
            hearAudio.closeStream();
        }
    } catch (const std::exception& e) {
        std::cerr << "RtAudio Secondary Stream Error on close: " << e.what() << std::endl;
    }
    
    return 0;
}
