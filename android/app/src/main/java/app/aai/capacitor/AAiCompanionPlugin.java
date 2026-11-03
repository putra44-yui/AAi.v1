package id.aai.personal;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opt-in bridge; never reads other apps' screens or injects text into them. */
@CapacitorPlugin(name = "AAiCompanion")
public class AAiCompanionPlugin extends Plugin {
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O);
        result.put("overlayGranted", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && Settings.canDrawOverlays(getContext()));
        result.put("running", CompanionOverlayService.isRunning());
        call.resolve(result);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.reject("Android ini tidak mendukung izin yang dibutuhkan.");
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Pengaturan izin overlay tidak dapat dibuka.");
        }
    }

    @PluginMethod
    public void show(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Mode mengambang memerlukan Android 8 atau lebih baru.");
            return;
        }
        if (!Settings.canDrawOverlays(getContext())) {
            call.reject("Izin 'Tampilkan di atas aplikasi lain' belum diberikan.");
            return;
        }
        try {
            Intent service = new Intent(getContext(), CompanionOverlayService.class);
            service.setAction(CompanionOverlayService.ACTION_SHOW);
            service.putExtra("showComposer", call.getBoolean("showComposer", true));
            ContextCompat.startForegroundService(getContext(), service);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Android tidak mengizinkan AAi mengambang saat ini.");
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (!CompanionOverlayService.isRunning()) {
            JSObject result = new JSObject();
            result.put("updated", false);
            call.resolve(result);
            return;
        }
        String text = call.getString("text", "");
        if (text.length() > 8000) text = text.substring(0, 8000);
        try {
            Intent service = new Intent(getContext(), CompanionOverlayService.class);
            service.setAction(CompanionOverlayService.ACTION_UPDATE);
            service.putExtra("text", text);
            service.putExtra("streaming", call.getBoolean("streaming", false));
            getContext().startService(service);
            JSObject result = new JSObject();
            result.put("updated", true);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Overlay tidak bisa diperbarui.");
        }
    }

    @PluginMethod
    public void setComposer(PluginCall call) {
        try {
            Intent service = new Intent(getContext(), CompanionOverlayService.class);
            service.setAction(CompanionOverlayService.ACTION_COMPOSER);
            service.putExtra("visible", call.getBoolean("visible", true));
            getContext().startService(service);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Tampilan chat bawah belum tersedia.");
        }
    }

    @PluginMethod
    public void hide(PluginCall call) {
        try {
            Intent service = new Intent(getContext(), CompanionOverlayService.class);
            service.setAction(CompanionOverlayService.ACTION_STOP);
            getContext().startService(service);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Mode mengambang sudah berhenti atau tidak tersedia.");
        }
    }
}
