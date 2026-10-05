package com.aibuildpros.crm;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The dialer's Speaker button (DECISIONS #111). A call from the CRM is
 * WebRTC inside the WebView, and a web page can't choose between the
 * earpiece and the loudspeaker, so the CRM asks the app. The WebView picks
 * the route itself when the call opens the microphone; this only switches
 * it and reports which one is live, so the button always tells the truth.
 * Needs MODIFY_AUDIO_SETTINGS, which the manifest declares for the dialer.
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

    @PluginMethod
    public void isSpeakerOn(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        AudioManager audio = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo target = find(audio, on ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE);
            if (target != null) {
                audio.setCommunicationDevice(target);
            } else if (!on) {
                // A tablet has no earpiece: hand the route back to Android.
                audio.clearCommunicationDevice();
            }
        } else {
            audio.setSpeakerphoneOn(on);
        }
        call.resolve(state());
    }

    private JSObject state() {
        JSObject ret = new JSObject();
        ret.put("on", speakerOn(audio()));
        return ret;
    }

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private static boolean speakerOn(AudioManager audio) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo device = audio.getCommunicationDevice();
            return device != null && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
        }
        return audio.isSpeakerphoneOn();
    }

    private static AudioDeviceInfo find(AudioManager audio, int type) {
        for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
            if (device.getType() == type) return device;
        }
        return null;
    }
}
