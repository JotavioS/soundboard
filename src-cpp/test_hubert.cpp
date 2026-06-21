#include <iostream>
#include <vector>
#include <onnxruntime_cxx_api.h>

int main() {
    Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "test");
    Ort::SessionOptions sessionOptions;
    
    std::string modelPath = "C:/Users/jogso/AppData/Roaming/soundboard/models/hubert_base.onnx";
    std::wstring w_path(modelPath.begin(), modelPath.end());
    Ort::Session session(env, w_path.c_str(), sessionOptions);
    
    std::vector<int> baseLengths = {4000, 8000, 10240, 16000};
    
    for (int L : baseLengths) {
        bool found = false;
        for (int pad = 0; pad <= 1000; pad += 10) {
            int padded_L = L + pad;
            std::vector<float> paddedAudio(padded_L, 0.0f);
            Ort::MemoryInfo memoryInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
            std::vector<int64_t> inputShape = {1, (int64_t)padded_L};
            Ort::Value sourceTensor = Ort::Value::CreateTensor<float>(memoryInfo, paddedAudio.data(), paddedAudio.size(), inputShape.data(), inputShape.size());
            
            std::vector<uint8_t> maskData(padded_L, 0);
            Ort::Value paddingTensor = Ort::Value::CreateTensor<bool>(memoryInfo, (bool*)maskData.data(), maskData.size(), inputShape.data(), inputShape.size());
            
            const char* inputNames[] = {"source", "padding_mask"};
            Ort::Value inputTensors[] = {std::move(sourceTensor), std::move(paddingTensor)};
            const char* outputNames[] = {"features"};
            
            try {
                auto outputTensors = session.Run(Ort::RunOptions{nullptr}, inputNames, inputTensors, 2, outputNames, 1);
                std::cout << "Base: " << L << " -> Works with padded length: " << padded_L << " (pad=" << pad << ")" << std::endl;
                found = true;
                break;
            } catch (...) {}
        }
        if (!found) {
            std::cout << "Base: " << L << " -> FAILED TO FIND PADDING <= 1000" << std::endl;
        }
    }
    return 0;
}
