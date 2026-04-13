package com.arnold.health;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HealthConnectPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
