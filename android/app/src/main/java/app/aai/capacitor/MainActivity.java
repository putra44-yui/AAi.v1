package id.aai.personal;

import android.os.Bundle;
import android.content.Intent;
import org.json.JSONObject;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Explicitly register the native overlay interface. The main chatbot
        // remains the same Capacitor web experience / Cloudflare backend.
        registerPlugin(AAiCompanionPlugin.class);
        super.onCreate(savedInstanceState);
        acceptCompanionDraft(getIntent());
    }
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        acceptCompanionDraft(intent);
    }
    private void acceptCompanionDraft(Intent intent) {
        if (intent == null) return;
        String draft = intent.getStringExtra("AAI_COMPANION_DRAFT");
        if (draft == null || draft.trim().isEmpty()) return;
        intent.removeExtra("AAI_COMPANION_DRAFT");
        final String safeJs = "window.AAiCompanionBridge && window.AAiCompanionBridge.acceptNativeDraft("
            + JSONObject.quote(draft.substring(0, Math.min(draft.length(), 700))) + ");";
        // Wait for WebView readiness; do not execute arbitrary JS from intent text.
        getWindow().getDecorView().postDelayed(() -> {
            try { if (getBridge() != null && getBridge().getWebView() != null)
                getBridge().getWebView().evaluateJavascript(safeJs, null);
            } catch (Exception ignored) { }
        }, 250);
    }
}
