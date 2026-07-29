#!/usr/bin/env swift

import Foundation
import Security

func fail(_ message: String, status: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(status)
}

guard CommandLine.arguments.count == 4 else {
    fail("usage: keychain-secret.swift <store|read> <service> <account>", status: 2)
}

let action = CommandLine.arguments[1]
let service = CommandLine.arguments[2]
let account = CommandLine.arguments[3]
let base: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account
]

switch action {
case "store":
    let secret = FileHandle.standardInput.readDataToEndOfFile()
    guard !secret.isEmpty else { fail("refusing to store an empty secret") }
    SecItemDelete(base as CFDictionary)
    var item = base
    item[kSecValueData as String] = secret
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else { fail("Keychain store failed with OSStatus \(status)") }
case "read":
    var query = base
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else {
        fail("Keychain read failed with OSStatus \(status)")
    }
    FileHandle.standardOutput.write(data)
default:
    fail("unknown action: \(action)", status: 2)
}
