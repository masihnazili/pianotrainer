#include <juce_audio_utils/juce_audio_utils.h>
#include <atomic>
#include <chrono>
#include <cmath>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace juce;
using Clock = std::chrono::steady_clock;

namespace {
struct ScheduledMidi {
    Clock::time_point due;
    MidiMessage message;
};

class NativeVstHost final : private AudioIODeviceCallback {
public:
    NativeVstHost() {
        formats.addFormat(new VST3PluginFormat());
        const auto error = deviceManager.initialise(0, 2, nullptr, true);
        deviceManager.addAudioCallback(this);
        const auto deviceName = deviceManager.getCurrentAudioDevice()
            ? deviceManager.getCurrentAudioDevice()->getName() : String("unavailable");
        DynamicObject::Ptr ready(new DynamicObject());
        ready->setProperty("event", "ready");
        ready->setProperty("audioDevice", deviceName);
        ready->setProperty("audioDeviceError", error);
        ready->setProperty("vst3Enabled", JUCE_PLUGINHOST_VST3 != 0);
        send(var(ready.get()));
    }

    ~NativeVstHost() override {
        deviceManager.removeAudioCallback(this);
        const ScopedLock lock(pluginLock);
        if (plugin) plugin->releaseResources();
        plugin.reset();
    }

    void command(const var& request) {
        const auto* obj = request.getDynamicObject();
        if (obj == nullptr) return;
        const auto cmd = obj->getProperty("cmd").toString();
        const auto requestId = obj->getProperty("requestId").toString();

        if (cmd == "status") {
            DynamicObject::Ptr out(new DynamicObject());
            out->setProperty("event", "status");
            out->setProperty("loaded", plugin != nullptr);
            out->setProperty("pluginName", loadedPluginName);
            out->setProperty("audioDevice", deviceManager.getCurrentAudioDevice()
                ? deviceManager.getCurrentAudioDevice()->getName() : String("unavailable"));
            reply(requestId, var(out.get()));
        } else if (cmd == "scan") {
            scanPlugins(requestId);
        } else if (cmd == "load") {
            loadPlugin(obj->getProperty("file").toString(), requestId);
        } else if (cmd == "unload") {
            {
                const ScopedLock lock(pluginLock);
                if (plugin) plugin->releaseResources();
                plugin.reset();
                loadedPluginName.clear();
            }
            replyOk(requestId, "unloaded");
        } else if (cmd == "noteOn") {
            const int note = jlimit(0, 127, (int) obj->getProperty("midi"));
            const float velocity = jlimit(0.0f, 1.0f, (float) (double) obj->getProperty("velocity"));
            queueMidi(MidiMessage::noteOn(1, note, (juce::uint8) jlimit(1, 127, (int) std::round(velocity * 127.0f))),
                      (double) obj->getProperty("delayMs"));
            replyOk(requestId, "noteOnQueued");
        } else if (cmd == "noteOff") {
            const int note = jlimit(0, 127, (int) obj->getProperty("midi"));
            queueMidi(MidiMessage::noteOff(1, note), (double) obj->getProperty("delayMs"));
            replyOk(requestId, "noteOffQueued");
        } else if (cmd == "sustain") {
            const bool down = (bool) obj->getProperty("down");
            queueMidi(MidiMessage::controllerEvent(1, 64, down ? 127 : 0), (double) obj->getProperty("delayMs"));
            replyOk(requestId, "sustainQueued");
        } else if (cmd == "allNotesOff") {
            queueMidi(MidiMessage::allNotesOff(1), 0.0);
            queueMidi(MidiMessage::controllerEvent(1, 64, 0), 0.0);
            replyOk(requestId, "allNotesOffQueued");
        } else if (cmd == "volume") {
            masterVolume.store(jlimit(0.0f, 1.5f, (float) (double) obj->getProperty("value")));
            replyOk(requestId, "volumeUpdated");
        } else if (cmd == "quit") {
            shouldQuit.store(true);
            replyOk(requestId, "quitting");
        } else {
            DynamicObject::Ptr out(new DynamicObject());
            out->setProperty("event", "error");
            out->setProperty("message", "Unknown command: " + cmd);
            reply(requestId, var(out.get()));
        }
    }

    bool quitting() const { return shouldQuit.load(); }

private:
    AudioPluginFormatManager formats;
    KnownPluginList knownPlugins;
    AudioDeviceManager deviceManager;
    CriticalSection pluginLock;
    std::unique_ptr<AudioPluginInstance> plugin;
    String loadedPluginName;
    CriticalSection midiLock;
    std::vector<ScheduledMidi> scheduledMidi;
    std::atomic<float> masterVolume { 0.8f };
    std::atomic<bool> shouldQuit { false };
    std::atomic<double> currentSampleRate { 44100.0 };
    std::atomic<int> currentBlockSize { 512 };

    static void send(const var& value) {
        const auto line = JSON::toString(value, false);
        std::cout << line << std::endl;
    }
    static void reply(const String& requestId, const var& value) {
        DynamicObject::Ptr out(new DynamicObject());
        if (const auto* src = value.getDynamicObject()) {
            for (const auto& p : src->getProperties()) out->setProperty(p.name, p.value);
        }
        out->setProperty("requestId", requestId);
        send(var(out.get()));
    }
    static void replyOk(const String& id, const String& message) {
        DynamicObject::Ptr out(new DynamicObject());
        out->setProperty("event", "result"); out->setProperty("ok", true); out->setProperty("message", message);
        reply(id, var(out.get()));
    }
    static void replyError(const String& id, const String& message) {
        DynamicObject::Ptr out(new DynamicObject());
        out->setProperty("event", "error"); out->setProperty("message", message);
        reply(id, var(out.get()));
    }

    void scanPlugins(const String& requestId) {
        knownPlugins.clear();
        Array<File> roots;
        roots.add(File::getSpecialLocation(File::globalApplicationsDirectory).getChildFile("Common Files/VST3"));
        roots.add(File("C:/Program Files/Common Files/VST3"));
        roots.add(File::getSpecialLocation(File::userHomeDirectory).getChildFile("AppData/Local/Programs/Common/VST3"));
        roots.add(File::getSpecialLocation(File::userApplicationDataDirectory).getChildFile("Programs/Common/VST3"));

        StringArray scannedPaths;
        for (const auto& root : roots) {
            if (!root.isDirectory() || scannedPaths.contains(root.getFullPathName())) continue;
            scannedPaths.add(root.getFullPathName());
            Array<File> bundles;
            root.findChildFiles(bundles, File::findFilesAndDirectories, true, "*.vst3");
            AudioPluginFormat* vst3Format = nullptr;
            for (int i = 0; i < formats.getNumFormats(); ++i) {
                auto* candidate = formats.getFormat(i);
                if (candidate->getName().containsIgnoreCase("VST3")) { vst3Format = candidate; break; }
            }
            if (vst3Format == nullptr) continue;
            for (const auto& bundle : bundles) {
                OwnedArray<PluginDescription> descriptions;
                vst3Format->findAllTypesForFile(descriptions, bundle.getFullPathName());
                for (auto* d : descriptions) knownPlugins.addType(*d);
            }
        }

        Array<var> items;
        for (const PluginDescription* d : knownPlugins.getTypes()) {
            DynamicObject::Ptr item(new DynamicObject());
            item->setProperty("name", d->name);
            item->setProperty("manufacturer", d->manufacturerName);
            item->setProperty("format", d->pluginFormatName);
            item->setProperty("file", d->fileOrIdentifier);
            item->setProperty("identifier", d->createIdentifierString());
            item->setProperty("instrument", d->isInstrument);
            items.add(var(item.get()));
        }
        DynamicObject::Ptr out(new DynamicObject());
        out->setProperty("event", "scanResult"); out->setProperty("plugins", var(items));
        out->setProperty("count", items.size());
        reply(requestId, var(out.get()));
    }

    void loadPlugin(const String& file, const String& requestId) {
        PluginDescription selected;
        bool found = false;
        for (const PluginDescription* d : knownPlugins.getTypes()) {
            if (d->fileOrIdentifier == file || d->createIdentifierString() == file) {
                selected = *d; found = true; break;
            }
        }
        if (!found) { replyError(requestId, "Plugin not found in the latest scan. Scan again and choose a VST3 instrument."); return; }
        String error;
        const auto sampleRate = currentSampleRate.load();
        const auto blockSize = currentBlockSize.load();
        auto instance = formats.createPluginInstance(selected, sampleRate, blockSize, error);
        if (!instance) { replyError(requestId, "Could not load plugin: " + error); return; }
        if (instance->getTotalNumOutputChannels() <= 0) { replyError(requestId, "This plugin has no audio output bus."); return; }
        instance->setPlayConfigDetails(0, jmin(2, instance->getTotalNumOutputChannels()), sampleRate, blockSize);
        instance->prepareToPlay(sampleRate, blockSize);
        {
            const ScopedLock lock(pluginLock);
            if (plugin) plugin->releaseResources();
            plugin = std::move(instance);
            loadedPluginName = selected.name;
        }
        DynamicObject::Ptr out(new DynamicObject());
        out->setProperty("event", "pluginLoaded"); out->setProperty("name", selected.name); out->setProperty("file", selected.fileOrIdentifier);
        reply(requestId, var(out.get()));
    }

    void queueMidi(const MidiMessage& message, double delayMs) {
        const auto delay = jlimit(0.0, 30000.0, delayMs);
        const ScopedLock lock(midiLock);
        scheduledMidi.push_back({ Clock::now() + std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double, std::milli>(delay)), message });
    }

    void audioDeviceAboutToStart(AudioIODevice* device) override {
        currentSampleRate.store(device->getCurrentSampleRate());
        currentBlockSize.store(device->getCurrentBufferSizeSamples());
        const ScopedLock lock(pluginLock);
        if (plugin) { plugin->releaseResources(); plugin->prepareToPlay(currentSampleRate.load(), currentBlockSize.load()); }
    }
    void audioDeviceStopped() override {
        const ScopedLock lock(pluginLock);
        if (plugin) plugin->releaseResources();
    }
    void audioDeviceIOCallbackWithContext(const float* const*, int, float* const* outputs, int outputChannels, int numSamples,
                                          const AudioIODeviceCallbackContext&) override {
        for (int ch = 0; ch < outputChannels; ++ch) if (outputs[ch]) FloatVectorOperations::clear(outputs[ch], numSamples);
        const ScopedLock pluginGuard(pluginLock);
        AudioBuffer<float> buffer(plugin ? jmax(1, plugin->getTotalNumOutputChannels()) : jmax(1, outputChannels), numSamples);
        buffer.clear();
        MidiBuffer midi;
        const auto now = Clock::now();
        const auto blockDuration = std::chrono::duration<double>(static_cast<double>(numSamples) / jmax(1.0, currentSampleRate.load()));
        const auto blockStart = now - std::chrono::duration_cast<Clock::duration>(blockDuration);
        const auto blockEnd = now + std::chrono::duration_cast<Clock::duration>(blockDuration);
        {
            const ScopedLock lock(midiLock);
            auto it = scheduledMidi.begin();
            while (it != scheduledMidi.end()) {
                if (it->due <= blockEnd) {
                    const auto delta = std::chrono::duration<double>(it->due - blockStart).count();
                    const int samplePos = jlimit(0, numSamples - 1, (int) std::llround(delta * currentSampleRate.load()));
                    midi.addEvent(it->message, samplePos);
                    it = scheduledMidi.erase(it);
                } else ++it;
            }
        }
        if (plugin) {
            const auto outChannels = jmin(buffer.getNumChannels(), plugin->getTotalNumOutputChannels());
            plugin->processBlock(buffer, midi);
            const float volume = masterVolume.load();
            for (int ch = 0; ch < outputChannels; ++ch) {
                if (!outputs[ch]) continue;
                if (ch < outChannels) FloatVectorOperations::copy(outputs[ch], buffer.getReadPointer(ch), numSamples);
                FloatVectorOperations::multiply(outputs[ch], volume, numSamples);
            }
        }
    }
};
}

int main() {
    ScopedJuceInitialiser_GUI juceInitialiser;
    NativeVstHost host;
    std::string line;
    while (!host.quitting() && std::getline(std::cin, line)) {
        const auto parsed = JSON::parse(line);
        if (parsed.isObject()) host.command(parsed);
    }
    return 0;
}
