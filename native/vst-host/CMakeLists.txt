cmake_minimum_required(VERSION 3.22)
project(PianoVstHost VERSION 0.1.0 LANGUAGES CXX)

include(FetchContent)
set(JUCE_BUILD_EXTRAS OFF CACHE BOOL "" FORCE)
set(JUCE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_Declare(juce
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.10
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(juce)

juce_add_console_app(PianoVstHost PRODUCT_NAME "PianoVstHost")
target_sources(PianoVstHost PRIVATE src/main.cpp)
target_compile_features(PianoVstHost PRIVATE cxx_std_17)
target_compile_definitions(PianoVstHost PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_VST=0
  JUCE_DISPLAY_SPLASH_SCREEN=0
  JUCE_REPORT_APP_USAGE=0
)
target_link_libraries(PianoVstHost PRIVATE
  juce::juce_audio_utils
  juce::juce_audio_processors
  juce::juce_audio_devices
  juce::juce_core
  juce::juce_events
)
if(MSVC)
  target_compile_options(PianoVstHost PRIVATE /W4 /permissive-)
else()
  target_compile_options(PianoVstHost PRIVATE -Wall -Wextra -Wpedantic)
endif()
