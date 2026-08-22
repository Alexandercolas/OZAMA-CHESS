package com.ozamachess.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(OzamaSecureStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
