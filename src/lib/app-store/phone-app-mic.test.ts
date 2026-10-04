import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The in-app dialer is a WebRTC call (@twilio/voice-sdk), so it needs the
 * microphone. Inside the phone app the WebView's request for it goes to
 * Capacitor, which asks Android for RECORD_AUDIO *and* MODIFY_AUDIO_SETTINGS
 * and denies the page unless both come back granted
 * (BridgeWebChromeClient.onPermissionRequest). A permission the manifest
 * never declares comes back denied without even asking, so every call from
 * the Android app failed before it rang (DECISIONS #109). iOS kills an app
 * that opens the microphone without a usage string.
 */

const mobile = join(import.meta.dirname, "..", "..", "..", "mobile");

test("the Android app declares both permissions Capacitor asks for the microphone", () => {
  const manifest = readFileSync(join(mobile, "android/app/src/main/AndroidManifest.xml"), "utf8");
  for (const permission of ["RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]) {
    assert.match(
      manifest,
      new RegExp(`<uses-permission\\s+android:name="android\\.permission\\.${permission}"`),
      permission
    );
  }
});

test("the iPhone app says why it wants the microphone", () => {
  const plist = readFileSync(join(mobile, "ios/App/App/Info.plist"), "utf8");
  assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]*call[^<]*<\/string>/);
});
