import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * The dialer's Speaker button (DECISIONS #111). A web page can't choose
 * between the phone's earpiece and its loudspeaker, so in the phone app
 * the CRM asks the app's own plugin
 * (mobile/android/app/src/main/java/com/aibuildpros/crm/CallAudioPlugin.java).
 * `call-audio.test.ts` holds the name and methods to the Java side.
 */

const CALL_AUDIO_PLUGIN = "CallAudio";

type CallAudioPlugin = {
  isSpeakerOn(): Promise<{ on: boolean }>;
  setSpeaker(options: { on: boolean }): Promise<{ on: boolean }>;
};

const CallAudio = registerPlugin<CallAudioPlugin>(CALL_AUDIO_PLUGIN);

/**
 * True only inside an app build that carries the plugin. The website, and
 * an app installed before the plugin shipped, get no Speaker button rather
 * than one that does nothing.
 */
export function speakerSwitchAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(CALL_AUDIO_PLUGIN);
}

/** Whether the call is on the loudspeaker right now. */
export async function isSpeakerOn(): Promise<boolean> {
  return (await CallAudio.isSpeakerOn()).on;
}

/** Switches the call to the loudspeaker (or back) and answers where it is now. */
export async function setSpeaker(on: boolean): Promise<boolean> {
  return (await CallAudio.setSpeaker({ on })).on;
}
