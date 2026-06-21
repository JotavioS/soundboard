#include <onnxruntime_cxx_api.h>
#include <iostream>
#include <vector>

int main() {
    Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "test");
    Ort::SessionOptions sessionOptions;
    Ort::Session session(env, L"C:\\Users\\jogso\\AppData\\Roaming\\soundboard\\models\\lula.onnx", sessionOptions);

    Ort::MemoryInfo memoryInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);

    int seqLen = 24;
    int hubertDim = 768;

    std::vector<int64_t> phoneShape = {1, seqLen, hubertDim};
    std::vector<float> phoneData(1 * seqLen * hubertDim, 0.0f);
    Ort::Value phoneTensor = Ort::Value::CreateTensor<float>(memoryInfo, phoneData.data(), phoneData.size(), phoneShape.data(), phoneShape.size());

    std::vector<int64_t> phoneLengthsShape = {1};
    std::vector<int64_t> phoneLengthsData = {seqLen};
    Ort::Value phoneLengthsTensor = Ort::Value::CreateTensor<int64_t>(memoryInfo, phoneLengthsData.data(), phoneLengthsData.size(), phoneLengthsShape.data(), phoneLengthsShape.size());

    std::vector<int64_t> pitchShape = {1, seqLen};
    std::vector<int64_t> pitchData(1 * seqLen, 0);
    Ort::Value pitchTensor = Ort::Value::CreateTensor<int64_t>(memoryInfo, pitchData.data(), pitchData.size(), pitchShape.data(), pitchShape.size());

    std::vector<int64_t> nsff0Shape = {1, seqLen};
    std::vector<float> nsff0Data(1 * seqLen, 0.0f);
    Ort::Value nsff0Tensor = Ort::Value::CreateTensor<float>(memoryInfo, nsff0Data.data(), nsff0Data.size(), nsff0Shape.data(), nsff0Shape.size());

    std::vector<int64_t> sidShape = {1};
    std::vector<int64_t> sidData = {0};
    Ort::Value sidTensor = Ort::Value::CreateTensor<int64_t>(memoryInfo, sidData.data(), sidData.size(), sidShape.data(), sidShape.size());

    const char* inputNames[] = {"phone", "phone_lengths", "pitch", "nsff0", "sid"};
    Ort::Value inputTensors[] = {std::move(phoneTensor), std::move(phoneLengthsTensor), std::move(pitchTensor), std::move(nsff0Tensor), std::move(sidTensor)};

    const char* outputNames[] = {"audio"};

    try {
        auto outputTensors = session.Run(Ort::RunOptions{nullptr}, inputNames, inputTensors, 5, outputNames, 1);
        std::cout << "SUCCESS" << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "ERROR: " << e.what() << std::endl;
    }
    return 0;
}
