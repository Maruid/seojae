package io.github.maruid.seojae;

import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 서재 앱 전용 기능 (웹에서 window.Capacitor.Plugins.Seojae 로 부름)
 *   - setVolumeKeys({ on }): 볼륨키를 읽기 화면 넘기기로 쓸지
 *   - setKeepAwake({ on }): 화면 켜짐 유지
 *   - info(): 앱 쪽 기능 버전 (웹이 이 앱에서 쓸 수 있는 기능을 판단)
 */
@CapacitorPlugin(name = "Seojae")
public class SeojaePlugin extends Plugin {

    // 앱 쪽 기능이 바뀌면 올림 → 웹은 이 값으로 새 기능을 쓸지 정함
    static final int NATIVE_API = 1;

    static volatile boolean volumeKeys = false;

    @PluginMethod
    public void setVolumeKeys(PluginCall call) {
        volumeKeys = Boolean.TRUE.equals(call.getBoolean("on", false));
        call.resolve();
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("api", NATIVE_API);
        call.resolve(r);
    }
}
