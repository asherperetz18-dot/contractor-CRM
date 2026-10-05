package com.aibuildpros.crm;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin, behind the dialer's Speaker button
        // (DECISIONS #111). Registered first: super.onCreate starts the bridge.
        registerPlugin(CallAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
