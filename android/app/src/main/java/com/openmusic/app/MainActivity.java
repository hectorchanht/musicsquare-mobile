package com.openmusic.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the hand-written local MediaStore plugin (D-11 public-music-mediastore;
        // no npm/git dependency — T-999.1-07 mitigation) BEFORE super.onCreate so the bridge
        // picks it up when it initializes the WebView (Capacitor 8 registration mechanism).
        registerPlugin(MediaStoreSaverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
