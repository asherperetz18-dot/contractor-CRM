import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The dialer's Speaker button (DECISIONS #111). A call in the phone app is
 * WebRTC inside a WebView, and a web page can't choose between the earpiece
 * and the loudspeaker. The app does it: a small plugin of its own,
 * CallAudioPlugin.java, reached from the CRM through Capacitor by name.
 * Nothing checks that name or its methods across the two languages, and a
 * mismatch fails silently (the button just never appears), so this does.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const appJava = "../../mobile/android/app/src/main/java/com/aibuildpros/crm/";
const plugin = read(appJava + "CallAudioPlugin.java");
const activity = read(appJava + "MainActivity.java");
const bridge = read("./call-audio.ts");

test("the CRM and the app call the plugin by the same name", () => {
  const name = bridge.match(/CALL_AUDIO_PLUGIN = "([^"]+)"/)?.[1];
  assert.ok(name, "call-audio.ts names the plugin");
  assert.match(plugin, new RegExp(`@CapacitorPlugin\\(name = "${name}"\\)`));
});

test("every method the CRM calls exists in the app", () => {
  const methods = [...bridge.matchAll(/^\s+(\w+)\(.*\): Promise</gm)].map((m) => m[1]);
  assert.deepEqual(methods.sort(), ["isSpeakerOn", "setSpeaker"]);
  for (const m of methods) {
    assert.match(plugin, new RegExp(`@PluginMethod\\s+public void ${m}\\(PluginCall call\\)`), m);
  }
});

test("the app registers the plugin before Capacitor starts", () => {
  const register = activity.indexOf("registerPlugin(CallAudioPlugin.class)");
  const start = activity.indexOf("super.onCreate(");
  assert.ok(register !== -1, "MainActivity registers CallAudioPlugin");
  assert.ok(start !== -1 && register < start, "before super.onCreate, which starts the bridge");
});

test("the Speaker button shows only where the speaker can be switched, and says whether it's on", () => {
  const dialer = read("../app/(app)/voice-dialer.tsx");
  assert.match(bridge, /isPluginAvailable\(CALL_AUDIO_PLUGIN\)/, "an app built before the plugin shows no button");
  assert.match(dialer, /speakerSwitchAvailable/);
  assert.match(dialer, /aria-pressed=\{speakerOn\}/);
});
