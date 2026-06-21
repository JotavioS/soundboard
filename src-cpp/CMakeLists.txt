cmake_minimum_required(VERSION 3.14)
project(SoundboardCore CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# Fetch RtAudio
FetchContent_Declare(
  RtAudio
  GIT_REPOSITORY https://github.com/thestk/rtaudio.git
  GIT_TAG        master
)
# RtAudio has its own CMake config, we disable its examples/tests
set(RTAUDIO_BUILD_TESTING OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(RtAudio)

# Fetch cppzmq (which requires libzmq)
FetchContent_Declare(
  libzmq
  GIT_REPOSITORY https://github.com/zeromq/libzmq.git
  GIT_TAG        master
)
set(ZMQ_BUILD_TESTS OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(libzmq)

FetchContent_Declare(
  cppzmq
  GIT_REPOSITORY https://github.com/zeromq/cppzmq.git
  GIT_TAG        master
)
set(CPPZMQ_BUILD_TESTS OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(cppzmq)

# Fetch RNNoise (werman fork supports MSVC natively by replacing VLAs)
FetchContent_Declare(
  rnnoise
  GIT_REPOSITORY https://github.com/werman/noise-suppression-for-voice.git
  GIT_TAG        master
)
FetchContent_Populate(rnnoise)
add_subdirectory(${rnnoise_SOURCE_DIR}/external/rnnoise ${rnnoise_BINARY_DIR}/external/rnnoise)


# Fetch ONNX Runtime GPU package. The CPU package exports the CUDA API surface,
# but it does not ship the CUDA execution provider DLLs needed at runtime.
set(ONNXRUNTIME_VERSION "1.16.3")
FetchContent_Declare(
  onnxruntime
  URL "https://github.com/microsoft/onnxruntime/releases/download/v${ONNXRUNTIME_VERSION}/onnxruntime-win-x64-gpu-${ONNXRUNTIME_VERSION}.zip"
)
FetchContent_MakeAvailable(onnxruntime)

set(CUDA_RUNTIME_DLL_DIR "${CMAKE_BINARY_DIR}/cuda_dlls_8" CACHE PATH "Directory containing CUDA/cuDNN runtime DLLs for ONNX Runtime CUDA EP")

# Create executable
add_executable(SoundboardCore main.cpp RVCOnnxEngine.cpp)

# Include directories
target_include_directories(SoundboardCore PRIVATE 
  ${onnxruntime_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}
)

# Link libraries
target_link_libraries(SoundboardCore PRIVATE 
  rtaudio 
  cppzmq 
  RnNoise
  ${onnxruntime_SOURCE_DIR}/lib/onnxruntime.lib
)

add_executable(TestNetG test_netg.cpp)
target_include_directories(TestNetG PRIVATE ${onnxruntime_SOURCE_DIR}/include)
target_link_libraries(TestNetG PRIVATE ${onnxruntime_SOURCE_DIR}/lib/onnxruntime.lib) 

add_executable(test_hubert test_hubert.cpp)
target_include_directories(test_hubert PRIVATE ${onnxruntime_SOURCE_DIR}/include)
target_link_libraries(test_hubert PRIVATE ${onnxruntime_SOURCE_DIR}/lib/onnxruntime.lib)

# Copy ONNX Runtime DLLs to the build directory so the executable can find the
# CUDA execution provider. The provider also needs CUDA 11.8 + cuDNN 8 DLLs.
file(GLOB ONNXRUNTIME_DLLS "${onnxruntime_SOURCE_DIR}/lib/*.dll")
add_custom_command(TARGET SoundboardCore POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    ${ONNXRUNTIME_DLLS}
    $<TARGET_FILE_DIR:SoundboardCore>
)

# Copy missing DLLs from FetchContent dependencies (Windows only)
if(WIN32)
  add_custom_command(TARGET SoundboardCore POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      $<TARGET_FILE:rtaudio>
      $<TARGET_FILE_DIR:SoundboardCore>
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      $<TARGET_FILE:libzmq>
      $<TARGET_FILE_DIR:SoundboardCore>
  )
endif()

if(EXISTS "${CUDA_RUNTIME_DLL_DIR}")
  file(GLOB_RECURSE CUDA_RUNTIME_DLLS "${CUDA_RUNTIME_DLL_DIR}/*.dll")
  if(CUDA_RUNTIME_DLLS)
    add_custom_command(TARGET SoundboardCore POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
        ${CUDA_RUNTIME_DLLS}
        $<TARGET_FILE_DIR:SoundboardCore>
    )
  endif()
endif()


