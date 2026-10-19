// The phone's copy of Finad's feed: fetched from the read-only link of the free JSON store (textdb.dev) that Finad on
// the computer writes after every update, kept in the app's files so it opens offline, and turned into notifications
// for alerts the phone has not shown yet.
package io.github.shamoug.finad;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class Feed {
    static final String STORE = "https://textdb.dev/api/data/";
    static final String ALERTS = "alerts", APP = "app";

    private Feed() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("finad", Context.MODE_PRIVATE); }

    static String id(Context c) { return prefs(c).getString("feed", null); }

    /** Links the phone to a computer's feed. Alerts older than now are not notified. */
    static void pair(Context c, String id) {
        prefs(c).edit().putString("feed", id).putLong("seenAt", System.currentTimeMillis()).apply();
        cacheFile(c).delete();
    }

    static void unpair(Context c) {
        prefs(c).edit().remove("feed").apply();
        cacheFile(c).delete();
    }

    static boolean validId(String id) { return id != null && id.matches("[0-9A-Fa-f]{64}"); }

    private static File cacheFile(Context c) { return new File(c.getFilesDir(), "feed.json"); }

    /** The last feed fetched, or null. */
    static String cached(Context c) {
        File f = cacheFile(c);
        if (!f.exists()) return null;
        try { return new String(read(new FileInputStream(f)), StandardCharsets.UTF_8); } catch (Exception e) { return null; }
    }

    /** Fetches the feed, keeps it, and notifies the alerts that came in since the last ones shown. */
    static synchronized String fetch(Context c, boolean notify) throws Exception {
        String id = id(c);
        if (id == null) return null;
        String body = get(STORE + id);
        JSONObject feed = new JSONObject(body);   // throws on anything that isn't JSON
        try (FileOutputStream out = new FileOutputStream(cacheFile(c))) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
        prefs(c).edit().putLong("fetchedAt", System.currentTimeMillis()).apply();
        if (notify) notifyNew(c, feed);
        return body;
    }

    /** The alerts the app has shown on screen count as seen: no notification for them later. */
    static void markSeen(Context c) {
        try {
            String s = cached(c);
            if (s == null) return;
            long top = newest(new JSONObject(s).optJSONArray("alerts"));
            if (top > prefs(c).getLong("seenAt", 0)) prefs(c).edit().putLong("seenAt", top).apply();
        } catch (Exception e) { /* nothing to mark */ }
    }

    private static long newest(JSONArray list) {
        long top = 0;
        for (int i = 0; list != null && i < list.length(); i++) top = Math.max(top, list.optJSONObject(i).optLong("at"));
        return top;
    }

    private static void notifyNew(Context c, JSONObject feed) {
        SharedPreferences p = prefs(c);
        long seen = p.getLong("seenAt", 0);
        JSONArray list = feed.optJSONArray("alerts");
        if (list == null) return;
        int shown = 0, more = 0;
        for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a == null || a.optLong("at") <= seen) continue;
            if (shown < 6) {
                show(c, ALERTS, 100 + (a.optString("id").hashCode() & 0xffff), a.optString("title", "Finad"), a.optString("body", ""), open(c, a.optString("sym", "")));
                shown++;
            } else more++;
        }
        if (more > 0) show(c, ALERTS, 99, "Finad: " + more + " more alerts", "Open Finad to see them all.", open(c, ""));
        long top = newest(list);
        if (top > seen) p.edit().putLong("seenAt", top).apply();
    }

    static PendingIntent open(Context c, String sym) {
        Intent i = new Intent(c, MainActivity.class).setAction(Intent.ACTION_VIEW).putExtra("sym", sym)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, sym.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void show(Context c, String channel, int id, String title, String body, PendingIntent tap) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(ALERTS, "Sell and buy alerts", NotificationManager.IMPORTANCE_HIGH));
            nm.createNotificationChannel(new NotificationChannel(APP, "App updates", NotificationManager.IMPORTANCE_LOW));
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_notify).setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(tap)
            .setColor(0xFF2EC27E);
        try { nm.notify(id, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
    }

    static String get(String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(10000); h.setReadTimeout(20000);
        h.setRequestProperty("Accept", "application/json");
        h.setRequestProperty("User-Agent", "FinadAndroid/" + BuildConfig.VERSION_NAME);
        try {
            if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
            return new String(read(h.getInputStream()), StandardCharsets.UTF_8);
        } finally { h.disconnect(); }
    }

    static byte[] read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        for (int n; (n = in.read(b)) > 0; ) out.write(b, 0, n);
        in.close();
        return out.toByteArray();
    }
}
