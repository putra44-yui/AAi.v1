package id.aai.personal;

import android.os.Bundle;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Preserve the existing Cloudflare Chatbot + registered native Companion.
        registerPlugin(AAiCompanionPlugin.class);
        super.onCreate(savedInstanceState);
        savePendingDraft(getIntent());
    }

    @Override
    protected void onResume() {
        super.onResume();
        setCompanionInApp(true);
    }

    @Override
    protected void onPause() {
        setCompanionInApp(false);
        super.onPause();
    }

    private void setCompanionInApp(boolean visible) {
        if (!CompanionOverlayService.isRunning()) return;
        Intent overlay = new Intent(this, CompanionOverlayService.class);
        overlay.setAction(visible
            ? CompanionOverlayService.ACTION_APP_FOREGROUND
            : CompanionOverlayService.ACTION_APP_BACKGROUND);
        try { startService(overlay); }
        catch (IllegalStateException | SecurityException ignored) {
            // Device policy may prevent service controls during transitions.
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        savePendingDraft(intent);
    }

    private void savePendingDraft(Intent intent) {
        if (intent == null) return;
        String draft = intent.getStringExtra("AAI_COMPANION_DRAFT");
        if (draft == null || draft.trim().isEmpty()) return;
        intent.removeExtra("AAI_COMPANION_DRAFT");
        // A fixed 250 ms WebView delay used to lose drafts on slow phones.
        // Store locally until the authenticated AAi web UI explicitly consumes it.
        String owner = intent.getStringExtra("AAI_COMPANION_OWNER");
        getSharedPreferences("aai_companion", MODE_PRIVATE)
            .edit()
            .putString("pendingDraft", draft.substring(0, Math.min(draft.length(), 700)))
            .putString("pendingDraftOwner", owner == null ? "" : owner)
            .putLong("pendingDraftAt", System.currentTimeMillis())
            .apply();
    }
}
