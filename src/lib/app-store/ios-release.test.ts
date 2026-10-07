import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The iPhone app reaches TestFlight from GitHub (DECISIONS #171). This
 * repository is public: anyone signed in can read a run's logs and download
 * its artifacts. So the signing certificate only ever leaves a job locked,
 * the store build only comes from main, and the key files are removed from
 * the runner whatever happens. The project settings the archive depends on
 * are pinned too, because each one fails an hour into a Mac build.
 */

const root = join(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const certificate = read(".github/workflows/ios-signing-certificate.yml");
const release = read(".github/workflows/ios-testflight.yml");
const testBuild = read(".github/workflows/ios-app.yml");
const pbxproj = read("mobile/ios/App/App.xcodeproj/project.pbxproj");
const plist = read("mobile/ios/App/App/Info.plist");

function steps(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*- (?:name: (.+)|uses: (.+))$/gm)].map((m) => m[1] ?? m[2]);
}
const stepIndex = (workflow: string, name: RegExp) => steps(workflow).findIndex((s) => name.test(s));

test("the certificate workflow refuses a short password and an accidental replace", () => {
  assert.match(certificate, /if \[ \$\{#PASS\} -lt 20 \]; then[\s\S]*?exit 1/);
  assert.match(certificate, /if \[ -n "\$EXISTING" \] && \[ "\$REPLACE" != "true" \]; then[\s\S]*?exit 1/);
});

test("the certificate is locked before it becomes an artifact, and the artifact lasts one day", () => {
  const lock = stepIndex(certificate, /lock/i);
  const upload = stepIndex(certificate, /upload-artifact/);
  assert.ok(lock >= 0 && lock < upload, "the lock step comes before the upload");
  assert.match(certificate, /gpg --batch[\s\S]*?--symmetric --cipher-algo AES256/);
  assert.match(certificate, /rm -f [^\n]*dist\.key[^\n]*dist\.p12/, "the unlocked key and p12 are deleted");
  assert.match(certificate, /retention-days: 1\n/);
});

test("a TestFlight build comes from main only, numbered by the run", () => {
  assert.match(release, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(release, /^\s+(push|pull_request):/m, "never on its own");
  assert.match(release, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(release, /CURRENT_PROJECT_VERSION=\$\{\{ github\.run_number \}\}/);
});

test("the release removes the keychain and the API key file even when a step fails", () => {
  const cleanup = release.slice(release.indexOf("- name: Remove the signing files"));
  assert.match(cleanup, /^\s+if: always\(\)/m);
  assert.match(cleanup, /security delete-keychain/);
  assert.match(cleanup, /AuthKey_/);
});

test("no workflow prints a secret", () => {
  for (const workflow of [certificate, release]) {
    assert.doesNotMatch(workflow, /echo[^\n]*\$\{\{ secrets\./, "secrets go through env, never into a command line");
    assert.doesNotMatch(workflow, /set -x/);
  }
});

test("the PR check builds the iPhone app without signing or secrets", () => {
  assert.match(testBuild, /pull_request:\s*\n\s+paths:[\s\S]*?"mobile\/\*\*"/);
  assert.match(testBuild, /CODE_SIGNING_ALLOWED=NO/);
  assert.doesNotMatch(testBuild, /secrets\./);
});

test("the App target's release build signs manually with the App Store profile, for this team", () => {
  const release = pbxproj.match(/504EC3181FED79650016851F \/\* Release \*\/ = \{[\s\S]*?name = Release;/)?.[0];
  assert.ok(release, "the App target's Release configuration");
  assert.match(release, /CODE_SIGN_STYLE = Manual;/);
  assert.match(release, /DEVELOPMENT_TEAM = 7U97978GD3;/);
  assert.match(release, /"CODE_SIGN_IDENTITY\[sdk=iphoneos\*\]" = "Apple Distribution";/);
  assert.match(release, /"PROVISIONING_PROFILE_SPECIFIER\[sdk=iphoneos\*\]" = "AI Build Pros CRM App Store";/);
  assert.match(release, /PRODUCT_BUNDLE_IDENTIFIER = com\.aibuildpros\.crm;/);
});

test("the workflow builds the profile name and the scheme the project uses", () => {
  assert.match(release, /--name "AI Build Pros CRM App Store"/);
  assert.ok(existsSync(join(root, "mobile/ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme")));
  assert.match(release, /-scheme App /);
  assert.match(read("mobile/ios/ExportOptions.plist"), /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
});

test("the iPhone app passes TestFlight's upload checks", () => {
  // HTTPS only, so no export-compliance paperwork holds each build.
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  // iOS 14 runs on 64-bit phones only; armv7 doesn't match the binary.
  assert.doesNotMatch(plist, /<string>armv7<\/string>/);
  assert.match(plist, /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64<\/string>/);
});

test("the iPhone app has no Speaker plugin, so the CRM shows it no Speaker button", () => {
  // speakerSwitchAvailable() asks Capacitor whether a native CallAudio
  // exists. registerPlugin is given no web implementation, so on an iPhone
  // without one the answer is false and the button never renders.
  const bridge = read("src/lib/call-audio.ts");
  assert.match(bridge, /registerPlugin<CallAudioPlugin>\(CALL_AUDIO_PLUGIN\);/);
  assert.match(bridge, /isPluginAvailable\(CALL_AUDIO_PLUGIN\)/);
  // When an iOS CallAudio lands, replace this with a name/method check
  // like call-audio.test.ts does for the Java side.
  assert.doesNotMatch(pbxproj, /CallAudio/, "the iPhone app carries no CallAudio plugin");
});
