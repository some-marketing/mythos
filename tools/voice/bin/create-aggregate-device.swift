// create-aggregate-device.swift
//
// Mythos voice calm-room — Core Audio aggregate output device CLI.
//
// Creates a macOS aggregate output device that fans a single audio stream to
// multiple physical output devices (e.g. two Bluetooth speakers) and exposes a
// stable known-output reference for acoustic echo cancellation on the mic.
//
// No GUI, no Screen Recording permission, no AppleScript. Pure Core Audio so it
// runs headless / unattended.
//
// Build:
//   swiftc -O create-aggregate-device.swift -o create-aggregate-device \
//     -framework CoreAudio -framework AudioToolbox
//
// Usage:
//   create-aggregate-device --list
//   create-aggregate-device --name "SM Aggregate" \
//                           --sub-devices "soundcore Boom 2,Rave Party 2" \
//                           [--master "soundcore Boom 2"] \
//                           [--drift-correction true]
//   create-aggregate-device --destroy "SM Aggregate"
//
// Idempotent: if an aggregate with the requested name already exists it is
// destroyed and recreated.

import Foundation
import CoreAudio
import AudioToolbox

// MARK: - Logging helpers

@inline(__always)
func errln(_ s: String) {
    FileHandle.standardError.write((s + "\n").data(using: .utf8) ?? Data())
}

@inline(__always)
func outln(_ s: String) {
    print(s)
}

// MARK: - OSStatus helpers

func osStatusString(_ status: OSStatus) -> String {
    // Try to render as 4-char code if printable, otherwise as numeric.
    var s = status.bigEndian
    let data = Data(bytes: &s, count: 4)
    let bytes = [UInt8](data)
    let printable = bytes.allSatisfy { $0 >= 0x20 && $0 < 0x7f }
    if printable, let str = String(data: data, encoding: .ascii) {
        return "'\(str)' (\(status))"
    }
    return "\(status)"
}

// MARK: - Core Audio device introspection

struct AudioDeviceInfo {
    let id: AudioObjectID
    let name: String
    let uid: String
    let hasOutput: Bool
}

func cfStringProperty(
    objectID: AudioObjectID,
    selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain
    )
    var size = UInt32(MemoryLayout<CFString?>.size)
    var cfString: CFString? = nil
    let status = withUnsafeMutablePointer(to: &cfString) { ptr -> OSStatus in
        ptr.withMemoryRebound(to: UInt8.self, capacity: Int(size)) { rawPtr in
            AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, rawPtr)
        }
    }
    if status != noErr { return nil }
    return cfString as String?
}

func deviceHasOutputStreams(_ deviceID: AudioObjectID) -> Bool {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreamConfiguration,
        mScope: kAudioObjectPropertyScopeOutput,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    var status = AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size)
    if status != noErr || size == 0 { return false }

    let buffer = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 8)
    defer { buffer.deallocate() }
    status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, buffer)
    if status != noErr { return false }

    let bufferList = buffer.assumingMemoryBound(to: AudioBufferList.self)
    let abl = UnsafeMutableAudioBufferListPointer(bufferList)
    var totalChannels: UInt32 = 0
    for buf in abl {
        totalChannels += buf.mNumberChannels
    }
    return totalChannels > 0
}

func enumerateAudioDevices() -> [AudioDeviceInfo] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    var status = AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
    if status != noErr || size == 0 {
        errln("error: AudioObjectGetPropertyDataSize(devices) failed: \(osStatusString(status))")
        return []
    }
    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    var ids = [AudioObjectID](repeating: 0, count: count)
    status = ids.withUnsafeMutableBufferPointer { bufPtr -> OSStatus in
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, bufPtr.baseAddress!)
    }
    if status != noErr {
        errln("error: AudioObjectGetPropertyData(devices) failed: \(osStatusString(status))")
        return []
    }

    var result: [AudioDeviceInfo] = []
    result.reserveCapacity(ids.count)
    for id in ids {
        let name = cfStringProperty(objectID: id, selector: kAudioObjectPropertyName) ?? "(unknown)"
        let uid = cfStringProperty(objectID: id, selector: kAudioDevicePropertyDeviceUID) ?? ""
        let hasOutput = deviceHasOutputStreams(id)
        result.append(AudioDeviceInfo(id: id, name: name, uid: uid, hasOutput: hasOutput))
    }
    return result
}

// MARK: - Aggregate UID + naming

func slugify(_ s: String) -> String {
    var out = ""
    for ch in s.lowercased() {
        if ch.isLetter || ch.isNumber {
            out.append(ch)
        } else if ch == " " || ch == "-" || ch == "_" {
            out.append("-")
        }
    }
    while out.contains("--") {
        out = out.replacingOccurrences(of: "--", with: "-")
    }
    return out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
}

func deterministicUID(forName name: String) -> String {
    return "com.mythos.voice.aggregate.\(slugify(name))"
}

// MARK: - Find / destroy aggregate by name

func findDeviceID(byName name: String) -> AudioObjectID? {
    for dev in enumerateAudioDevices() {
        if dev.name == name { return dev.id }
    }
    return nil
}

func destroyAggregate(named name: String) -> Bool {
    guard let id = findDeviceID(byName: name) else { return false }
    let status = AudioHardwareDestroyAggregateDevice(id)
    if status != noErr {
        errln("error: AudioHardwareDestroyAggregateDevice failed for '\(name)': \(osStatusString(status))")
        return false
    }
    return true
}

// MARK: - Create aggregate

struct CreateOptions {
    let name: String
    let subDeviceNames: [String]
    let masterName: String?
    let driftCorrection: Bool
    let stacked: Bool
}

func runCreate(_ opts: CreateOptions) -> Int32 {
    if opts.subDeviceNames.isEmpty {
        errln("error: --sub-devices must list at least one device name")
        return 2
    }

    let allDevices = enumerateAudioDevices()
    let outputs = allDevices.filter { $0.hasOutput }

    // Resolve sub-device UIDs by current name. Warn on missing, continue with rest.
    var resolved: [(name: String, uid: String)] = []
    var missing: [String] = []
    for wanted in opts.subDeviceNames {
        if let dev = outputs.first(where: { $0.name == wanted }) {
            if dev.uid.isEmpty {
                errln("warning: device '\(wanted)' has no UID, skipping")
                missing.append(wanted)
            } else {
                resolved.append((wanted, dev.uid))
            }
        } else {
            errln("warning: sub-device '\(wanted)' not currently connected, skipping")
            missing.append(wanted)
        }
    }

    if resolved.isEmpty {
        errln("error: no requested sub-devices are currently connected; cannot create aggregate")
        return 3
    }

    // Idempotent: if existing aggregate with same name, destroy then recreate.
    if findDeviceID(byName: opts.name) != nil {
        errln("note: aggregate '\(opts.name)' already exists, destroying and recreating")
        if !destroyAggregate(named: opts.name) {
            errln("error: failed to destroy existing aggregate '\(opts.name)'")
            return 4
        }
    }

    // Master sub-device UID
    var masterUID: String? = nil
    if let masterName = opts.masterName {
        if let m = resolved.first(where: { $0.name == masterName }) {
            masterUID = m.uid
        } else {
            errln("warning: requested master '\(masterName)' is not among connected sub-devices; using first sub-device as master")
        }
    }
    if masterUID == nil {
        masterUID = resolved.first?.uid
    }

    // Build sub-device dict array.
    let subDeviceDicts: [[String: Any]] = resolved.map { entry in
        var d: [String: Any] = [
            kAudioSubDeviceUIDKey as String: entry.uid
        ]
        if opts.driftCorrection {
            d[kAudioSubDeviceDriftCompensationKey as String] = 1 as UInt32
        }
        return d
    }

    var description: [String: Any] = [
        kAudioAggregateDeviceNameKey as String: opts.name,
        kAudioAggregateDeviceUIDKey as String: deterministicUID(forName: opts.name),
        kAudioAggregateDeviceSubDeviceListKey as String: subDeviceDicts,
        kAudioAggregateDeviceIsPrivateKey as String: 0 as UInt32,
        kAudioAggregateDeviceIsStackedKey as String: (opts.stacked ? 1 : 0) as UInt32
    ]
    if let masterUID = masterUID {
        description[kAudioAggregateDeviceMasterSubDeviceKey as String] = masterUID
    }

    var aggregateID: AudioObjectID = 0
    let status = AudioHardwareCreateAggregateDevice(description as CFDictionary, &aggregateID)
    if status != noErr {
        errln("error: AudioHardwareCreateAggregateDevice failed: \(osStatusString(status))")
        return 5
    }

    // Report.
    outln("created aggregate device:")
    outln("  name           : \(opts.name)")
    outln("  uid            : \(deterministicUID(forName: opts.name))")
    outln("  audio object id: \(aggregateID)")
    outln("  master         : \(masterUID ?? "(none)")")
    outln("  drift correct  : \(opts.driftCorrection)")
    outln("  sub-devices    :")
    for entry in resolved {
        let isMaster = (entry.uid == masterUID) ? " [master]" : ""
        outln("    - \(entry.name) (\(entry.uid))\(isMaster)")
    }
    if !missing.isEmpty {
        outln("  missing        :")
        for m in missing {
            outln("    - \(m)")
        }
    }
    return 0
}

// MARK: - Subcommands

func runList() -> Int32 {
    let devices = enumerateAudioDevices().filter { $0.hasOutput }
    if devices.isEmpty {
        errln("error: no output-capable devices found")
        return 1
    }
    outln("output-capable audio devices:")
    for dev in devices {
        outln("  [\(dev.id)] \(dev.name)  uid=\(dev.uid)")
    }
    return 0
}

func runDestroy(name: String) -> Int32 {
    if findDeviceID(byName: name) == nil {
        errln("error: no audio device found with name '\(name)'")
        return 1
    }
    if destroyAggregate(named: name) {
        outln("destroyed aggregate device '\(name)'")
        return 0
    }
    return 1
}

// MARK: - Argument parsing

func usage() -> String {
    return """
    create-aggregate-device — Mythos Core Audio aggregate output device CLI

    Usage:
      create-aggregate-device --list
      create-aggregate-device --name NAME --sub-devices "DEV1,DEV2[,...]"
                              [--master NAME] [--drift-correction true|false]
      create-aggregate-device --destroy NAME

    Notes:
      - Sub-devices are resolved by current device name, so they survive re-pairing.
      - If a requested sub-device is not currently connected, a warning is printed
        and the aggregate is created with only the connected ones.
      - If an aggregate with the requested name already exists, it is destroyed
        and recreated (idempotent).
      - The aggregate UID is deterministic: com.mythos.voice.aggregate.<slug>
    """
}

func parseArgs(_ argv: [String]) -> Int32 {
    let args = Array(argv.dropFirst())
    if args.isEmpty || args.contains("-h") || args.contains("--help") {
        outln(usage())
        return args.isEmpty ? 2 : 0
    }

    if args.contains("--list") {
        return runList()
    }

    // --destroy NAME
    if let idx = args.firstIndex(of: "--destroy") {
        guard idx + 1 < args.count else {
            errln("error: --destroy requires a NAME argument")
            return 2
        }
        return runDestroy(name: args[idx + 1])
    }

    // --create form
    var name: String? = nil
    var subDevicesRaw: String? = nil
    var master: String? = nil
    var driftCorrection = false
    var stacked = false

    var i = 0
    while i < args.count {
        let a = args[i]
        switch a {
        case "--name":
            guard i + 1 < args.count else { errln("error: --name requires a value"); return 2 }
            name = args[i + 1]; i += 2
        case "--sub-devices":
            guard i + 1 < args.count else { errln("error: --sub-devices requires a value"); return 2 }
            subDevicesRaw = args[i + 1]; i += 2
        case "--master":
            guard i + 1 < args.count else { errln("error: --master requires a value"); return 2 }
            master = args[i + 1]; i += 2
        case "--drift-correction":
            guard i + 1 < args.count else { errln("error: --drift-correction requires a value"); return 2 }
            let v = args[i + 1].lowercased()
            driftCorrection = (v == "true" || v == "1" || v == "yes" || v == "on")
            i += 2
        case "--stacked":
            guard i + 1 < args.count else { errln("error: --stacked requires a value"); return 2 }
            let v = args[i + 1].lowercased()
            stacked = (v == "true" || v == "1" || v == "yes" || v == "on")
            i += 2
        default:
            errln("error: unknown argument '\(a)'")
            errln(usage())
            return 2
        }
    }

    guard let name = name, let raw = subDevicesRaw else {
        errln("error: --name and --sub-devices are required to create an aggregate")
        errln(usage())
        return 2
    }

    let subDeviceNames = raw
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }

    let opts = CreateOptions(
        name: name,
        subDeviceNames: subDeviceNames,
        masterName: master,
        driftCorrection: driftCorrection,
        stacked: stacked
    )
    return runCreate(opts)
}

exit(parseArgs(CommandLine.arguments))
