package io.github.maruid.seojae;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 서재 앱 전용 기능 (웹에서 registerPlugin('Seojae') 로 부름)
 *   1: setVolumeKeys · setKeepAwake · info
 *   2: setImmersive(전체 화면, 쓸어 꺼낸 바는 잠깐 보였다 들어감)
 *      dlInfo · dlList · dlStart · dlStatus · dlTakeResults · dlCancel · dlDelete · dlClear (화면이 꺼져도 받기)
 *      이벤트: dlProgress · dlEnd
 */
@CapacitorPlugin(name = "Seojae")
public class SeojaePlugin extends Plugin {

    // 앱 쪽 기능이 바뀌면 올림 → 웹은 이 값으로 새 기능을 쓸지 정함
    static final int NATIVE_API = 2;

    static volatile boolean volumeKeys = false;

    @Override
    public void load() {
        // 안드로이드 기본 스크롤 막대 끔 (읽기 화면은 웹이 회색 막대를 따로 그림 → 두 개가 겹쳐 보이던 문제)
        getActivity().runOnUiThread(() -> {
            android.webkit.WebView wv = getBridge().getWebView();
            if (wv != null) {
                wv.setVerticalScrollBarEnabled(false);
                wv.setHorizontalScrollBarEnabled(false);
            }
        });
        DownloadService.listener = new DownloadService.Listener() {
            @Override
            public void onProgress(JSONObject state) {
                emit("dlProgress", state, false);
            }

            @Override
            public void onEnd(JSONObject state) {
                emit("dlEnd", state, true);
            }
        };
    }

    private void emit(String event, JSONObject state, boolean retain) {
        try {
            notifyListeners(event, JSObject.fromJSONObject(state), retain);
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("api", NATIVE_API);
        call.resolve(r);
    }

    // ---- 볼륨키 · 화면 켜짐 ----
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

    // ---- 전체 화면: 상태 바·제스처 바 숨김. 가장자리에서 쓸면 잠깐 보였다 저절로 들어감 ----
    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            if (on) {
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                c.show(WindowInsetsCompat.Type.systemBars());
            }
        });
        call.resolve();
    }

    // ---- 화면이 꺼져도 받기 ----
    private Context ctx() {
        return getContext();
    }

    @PluginMethod
    public void dlInfo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("dir", DownloadService.dir(ctx()).getAbsolutePath());
        call.resolve(r);
    }

    @PluginMethod
    public void dlList(PluginCall call) {
        JSArray names = new JSArray();
        File[] files = DownloadService.dir(ctx()).listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.isFile() && !f.getName().startsWith(".")) names.put(f.getName());
            }
        }
        JSObject r = new JSObject();
        r.put("names", names);
        call.resolve(r);
    }

    @PluginMethod
    public void dlStart(PluginCall call) {
        if (DownloadService.running) {
            call.reject("BUSY");
            return;
        }
        JSArray tasks = call.getArray("tasks");
        if (tasks == null || tasks.length() == 0) {
            call.reject("NO_TASKS");
            return;
        }
        try {
            JSONObject job = new JSONObject();
            job.put("label", call.getString("label", ""));
            job.put("limit", call.getData().optLong("limit", -1L));   // getLong 은 작은 숫자(Integer)를 못 읽음
            job.put("tasks", tasks);
            try (FileOutputStream out = new FileOutputStream(DownloadService.jobFile(ctx()))) {
                out.write(job.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            call.reject("JOB_WRITE_FAILED");
            return;
        }
        // 안드로이드 13+: 알림 권한 (거절해도 받기는 계속, 알림만 안 보임)
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(ctx(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4803);
        }
        Intent i = new Intent(ctx(), DownloadService.class);
        ContextCompat.startForegroundService(ctx(), i);
        call.resolve();
    }

    @PluginMethod
    public void dlStatus(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(DownloadService.state()));
        } catch (Exception e) {
            call.reject("STATUS_FAILED");
        }
    }

    @PluginMethod
    public void dlTakeResults(PluginCall call) {
        JSONArray items = DownloadService.takeResults(ctx());
        JSObject r = new JSObject();
        r.put("items", items);
        call.resolve(r);
    }

    @PluginMethod
    public void dlCancel(PluginCall call) {
        DownloadService.cancel = true;
        call.resolve();
    }

    @PluginMethod
    public void dlDelete(PluginCall call) {
        JSArray names = call.getArray("names");
        File d = DownloadService.dir(ctx());
        if (names != null) {
            for (int i = 0; i < names.length(); i++) {
                String n = names.optString(i, "");
                if (n.isEmpty() || n.contains("/") || n.startsWith(".")) continue;
                new File(d, n).delete();
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void dlClear(PluginCall call) {
        DownloadService.cancel = true;
        File[] files = DownloadService.dir(ctx()).listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.isFile()) f.delete();
            }
        }
        call.resolve();
    }
}
