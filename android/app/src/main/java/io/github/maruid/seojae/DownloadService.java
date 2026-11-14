package io.github.maruid.seojae;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 화면이 꺼져도 계속 받는 다운로드 (포그라운드 서비스 + 알림)
 *   - 웹이 서명 주소(로그인 없이 받을 수 있는 주소)와 저장할 파일 이름을 .job.json 에 넣고 시작
 *   - files/dl/<이름> 에 저장, 끝난 것은 .results.jsonl 에 한 줄씩 → 웹이 나중에 가져가 기록(IndexedDB)·사용량 반영
 *   - 받은 양이 한도(limit)에 닿으면 멈춤, 알림의 [취소]로 멈춤
 */
public class DownloadService extends Service {

    static final String CHANNEL = "seojae_download";
    static final int NOTI_ID = 4801;
    static final int NOTI_DONE_ID = 4802;
    static final String ACTION_CANCEL = "io.github.maruid.seojae.DL_CANCEL";

    interface Listener {
        void onProgress(JSONObject state);
        void onEnd(JSONObject state);
    }

    static volatile Listener listener;

    static volatile boolean running = false;
    static volatile boolean cancel = false;
    static volatile String label = "";
    static volatile String stopped = null;
    static volatile int total = 0;
    static final AtomicInteger done = new AtomicInteger();
    static final AtomicInteger failed = new AtomicInteger();
    static final AtomicLong bytes = new AtomicLong();
    private static final Object RESULTS_LOCK = new Object();

    private PowerManager.WakeLock wake;
    private volatile long lastNotify = 0;

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "dl");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static File jobFile(Context c) {
        return new File(dir(c), ".job.json");
    }

    static File resultsFile(Context c) {
        return new File(dir(c), ".results.jsonl");
    }

    static JSONObject state() {
        JSONObject o = new JSONObject();
        try {
            o.put("running", running);
            o.put("label", label);
            o.put("done", done.get());
            o.put("failed", failed.get());
            o.put("total", total);
            o.put("bytes", bytes.get());
            o.put("stopped", stopped == null ? JSONObject.NULL : stopped);
            o.put("cancelled", cancel);
        } catch (Exception ignored) {}
        return o;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "다운로드", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("오프라인으로 읽을 글을 받는 동안 보여요");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_CANCEL.equals(intent.getAction())) {
            cancel = true;
            return START_NOT_STICKY;
        }
        if (running) return START_NOT_STICKY;

        // 시작하자마자 알림과 함께 포그라운드로 (startForegroundService 뒤 몇 초 안에 해야 함)
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        ServiceCompat.startForeground(this, NOTI_ID, progressNotification(), type);

        final JSONObject job;
        try {
            job = new JSONObject(readText(jobFile(this)));
        } catch (Exception e) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        label = job.optString("label", "");
        total = job.optJSONArray("tasks") == null ? 0 : job.optJSONArray("tasks").length();
        done.set(0);
        failed.set(0);
        bytes.set(0);
        stopped = null;
        cancel = false;
        running = true;
        notify(NOTI_ID, progressNotification());

        new Thread(() -> runJob(job), "seojae-dl").start();
        return START_NOT_STICKY;
    }

    private void runJob(JSONObject job) {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "seojae:download");
            wake.acquire(2 * 60 * 60 * 1000L);
        }
        JSONArray tasks = job.optJSONArray("tasks");
        final long limit = job.optLong("limit", -1);
        ExecutorService pool = Executors.newFixedThreadPool(3);
        if (tasks != null) {
            for (int i = 0; i < tasks.length(); i++) {
                final JSONObject t = tasks.optJSONObject(i);
                if (t == null) continue;
                pool.execute(() -> one(t, limit));
            }
        }
        pool.shutdown();
        try {
            pool.awaitTermination(6, TimeUnit.HOURS);
        } catch (InterruptedException ignored) {}
        finish();
    }

    private void one(JSONObject t, long limit) {
        if (cancel || stopped != null) return;
        if (limit >= 0 && bytes.get() >= limit) {
            stopped = "quota";
            return;
        }
        String name = t.optString("name", "");
        String url = t.optString("url", "");
        if (name.isEmpty() || name.contains("/") || name.startsWith(".") || url.isEmpty()) {
            failed.incrementAndGet();
            return;
        }
        long size = -1;
        for (int attempt = 0; attempt < 3 && size < 0 && !cancel; attempt++) {
            try {
                size = fetch(url, name);
            } catch (HttpError e) {
                break; // 400·403·404 는 다시 해도 같음
            } catch (Exception e) {
                try {
                    Thread.sleep(700L * (attempt + 1));
                } catch (InterruptedException ignored) {}
            }
        }
        if (size >= 0) {
            done.incrementAndGet();
            bytes.addAndGet(size);
            appendResult(name, size, true);
        } else if (!cancel) {
            failed.incrementAndGet();
            appendResult(name, 0, false);
        }
        progress();
    }

    static class HttpError extends IOException {
        HttpError(int code) {
            super("HTTP " + code);
        }
    }

    private long fetch(String url, String name) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(30000);
        try {
            int code = conn.getResponseCode();
            if (code >= 400 && code < 500) throw new HttpError(code);
            if (code != 200) throw new IOException("HTTP " + code);
            File d = dir(this);
            File tmp = new File(d, ".tmp-" + name);
            long n = 0;
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[16384];
                int r;
                while ((r = in.read(buf)) > 0) {
                    if (cancel) throw new IOException("cancelled");
                    out.write(buf, 0, r);
                    n += r;
                }
            }
            File dest = new File(d, name);
            if (dest.exists()) dest.delete();
            if (!tmp.renameTo(dest)) throw new IOException("rename failed");
            return n;
        } finally {
            conn.disconnect();
        }
    }

    private void appendResult(String name, long size, boolean ok) {
        synchronized (RESULTS_LOCK) {
            try (FileWriter w = new FileWriter(resultsFile(this), true)) {
                JSONObject o = new JSONObject();
                o.put("name", name);
                o.put("size", size);
                o.put("ok", ok);
                w.write(o.toString());
                w.write("\n");
            } catch (Exception ignored) {}
        }
    }

    /** 끝난 것 목록을 꺼내고 비움 (플러그인이 부름) */
    static JSONArray takeResults(Context c) {
        JSONArray out = new JSONArray();
        synchronized (RESULTS_LOCK) {
            File f = resultsFile(c);
            if (!f.exists()) return out;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (line.trim().isEmpty()) continue;
                    try {
                        out.put(new JSONObject(line));
                    } catch (Exception ignored) {}
                }
            } catch (Exception ignored) {}
            f.delete();
        }
        return out;
    }

    private void progress() {
        long now = System.currentTimeMillis();
        if (now - lastNotify < 400) return;
        lastNotify = now;
        notify(NOTI_ID, progressNotification());
        Listener l = listener;
        if (l != null) l.onProgress(state());
    }

    private void finish() {
        running = false;
        if (wake != null && wake.isHeld()) wake.release();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        String text;
        if (cancel) text = done.get() + "개까지 받고 멈췄어요";
        else if ("quota".equals(stopped)) text = "이번 달 한도에 닿아 " + done.get() + "개까지 받았어요";
        else if (failed.get() > 0) text = done.get() + "개 받음 · " + failed.get() + "개 실패";
        else text = done.get() + "개 받았어요";
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("서재 · " + label)
            .setContentText(text)
            .setContentIntent(openApp())
            .setAutoCancel(true)
            .build();
        notify(NOTI_DONE_ID, n);
        Listener l = listener;
        if (l != null) l.onEnd(state());
        stopSelf();
    }

    private Notification progressNotification() {
        Intent ci = new Intent(this, DownloadService.class).setAction(ACTION_CANCEL);
        PendingIntent cancelPi = PendingIntent.getService(this, 1, ci, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        int d = done.get() + failed.get();
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("서재 · " + label)
            .setContentText(d + " / " + total + " 받는 중")
            .setProgress(Math.max(total, 1), d, total == 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp())
            .addAction(0, "취소", cancelPi)
            .build();
    }

    private PendingIntent openApp() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 2, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void notify(int id, Notification n) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(id, n);
        } catch (SecurityException ignored) {
            // 알림 권한이 없으면 알림만 안 보이고 받기는 계속
        }
    }

    static String readText(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            byte[] all = new byte[(int) f.length()];
            int off = 0;
            int r;
            while (off < all.length && (r = in.read(all, off, all.length - off)) > 0) off += r;
            return new String(all, 0, off, StandardCharsets.UTF_8);
        }
    }
}
