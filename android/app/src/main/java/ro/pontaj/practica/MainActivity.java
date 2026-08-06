package ro.pontaj.practica;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before the bridge initializes.
        registerPlugin(MockLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
