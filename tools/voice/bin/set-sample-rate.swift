// set-sample-rate.swift
//
// Mythos audio-output — set the nominal sample rate of a named output device.
// User-space Core Audio; no sudo, no daemon, no persistent install.
//
// Build:
//   swiftc -O set-sample-rate.swift -o set-sample-rate -framework CoreAudio
//
// Usage:
//   set-sample-rate --name "MacBook Pro Speakers" --hz 44100
//   set-sample-rate --name "soundcore Boom 2" --hz 48000
//   set-sample-rate --list-rates --name "SM Aggregate"

import Foundation
import CoreAudio

@inline(__always) func errln(_ s: String) {
    FileHandle.standardError.write((s + "\n").data(using: .utf8) ?? Data())
}

func osStatusString(_ status: OSStatus) -> String {
    var s = status.bigEndian
    let data = Data(bytes: &s, count: 4)
    let bytes = [UInt8](data)
    if bytes.allSatisfy({ $0 >= 0x20 && $0 < 0x7f }), let str = String(data: data, encoding: .ascii) {
        return "'\(str)' (\(status))"
    }
    return "\(status)"
}

func allDeviceIDs() -> [AudioObjectID] {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    var ids = [AudioObjectID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

func deviceName(_ id: AudioObjectID) -> String {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioObjectPropertyName,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<CFString?>.size)
    var cfName: Unmanaged<CFString>?
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &cfName) == noErr, let n = cfName else { return "" }
    return n.takeRetainedValue() as String
}

func findDeviceID(byName name: String) -> AudioObjectID? {
    for id in allDeviceIDs() where deviceName(id) == name { return id }
    return nil
}

func availableRates(_ id: AudioObjectID) -> [Double] {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyAvailableNominalSampleRates,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr else { return [] }
    let count = Int(size) / MemoryLayout<AudioValueRange>.size
    var ranges = [AudioValueRange](repeating: AudioValueRange(mMinimum: 0, mMaximum: 0), count: count)
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &ranges) == noErr else { return [] }
    var rates: Set<Double> = []
    for r in ranges {
        rates.insert(r.mMinimum)
        if r.mMaximum != r.mMinimum { rates.insert(r.mMaximum) }
    }
    return rates.sorted()
}

func currentRate(_ id: AudioObjectID) -> Double? {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyNominalSampleRate,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<Double>.size)
    var rate: Double = 0
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &rate) == noErr else { return nil }
    return rate
}

func setRate(_ id: AudioObjectID, hz: Double) -> OSStatus {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyNominalSampleRate,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var rate = hz
    return AudioObjectSetPropertyData(id, &addr, 0, nil, UInt32(MemoryLayout<Double>.size), &rate)
}

// --- CLI ---

var args = CommandLine.arguments
args.removeFirst()

var name: String?
var hz: Double?
var listRates = false

var i = 0
while i < args.count {
    switch args[i] {
    case "--name": i += 1; if i < args.count { name = args[i] }
    case "--hz":   i += 1; if i < args.count { hz = Double(args[i]) }
    case "--list-rates": listRates = true
    case "-h", "--help":
        print("Usage:")
        print("  set-sample-rate --name NAME --hz RATE")
        print("  set-sample-rate --name NAME --list-rates")
        exit(0)
    default:
        errln("unknown arg: \(args[i])")
        exit(2)
    }
    i += 1
}

guard let deviceName = name else {
    errln("error: --name is required")
    exit(2)
}
guard let id = findDeviceID(byName: deviceName) else {
    errln("error: device not found: \(deviceName)")
    exit(3)
}

if listRates {
    let cur = currentRate(id) ?? 0
    let rates = availableRates(id)
    print("device: \(deviceName)")
    print("current: \(cur) Hz")
    print("available: \(rates.map { String(Int($0)) }.joined(separator: ", ")) Hz")
    exit(0)
}

guard let targetHz = hz else {
    errln("error: --hz is required (or pass --list-rates)")
    exit(2)
}

let before = currentRate(id) ?? 0
let status = setRate(id, hz: targetHz)
if status != noErr {
    errln("error: set failed: \(osStatusString(status))")
    let rates = availableRates(id)
    errln("hint: available rates for \(deviceName): \(rates.map { String(Int($0)) }.joined(separator: ", "))")
    exit(1)
}
let after = currentRate(id) ?? 0
print("device: \(deviceName)")
print("rate: \(before) -> \(after) Hz")
exit(0)
