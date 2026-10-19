// The app updates itself from the Finad website: downloads/android.json says the newest version, its file and its
// SHA-256 (written by the workflow that builds it). A newer one is downloaded, checked and installed with Android's
// package installer. The first time, Android asks to let Finad install apps; from Android 12 it then updates without
// asking.
package io.github.shamoug.finad;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.OutputStream;
import java.security.MessageDigest;

public class Updater extends BroadcastReceiver {
    static final String INFO = "https://shamoug.github.io/finad/downloads/android.json";
    static final long EVERY_MS = 6 * 3600 * 1000L;

    static void checkIfDue(Context c) throws Exception { check(c, false); }

    /** Returns the newer version's name when one was found (and is being installed), else null. */
    static synchronized String check(Context c, boolean now) throws Exception {
        SharedPreferences prefs = Feed.prefs(c);
        if (!now && System.currentTimeMillis() - prefs.getLong("updateAt", 0) < EVERY_MS) return null;
        prefs.edit().putLong("updateAt", System.currentTimeMillis()).apply();
        JSONObject j = new JSONObject(Feed.get(INFO + "?t=" + System.currentTimeMillis()));
        int code = j.optInt("versionCode");
        if (code <= BuildConfig.VERSION_CODE) return null;
        String name = j.optString("versionName", String.valueOf(code));
        if (Build.VERSION.SDK_INT >= 26 && !c.getPackageManager().canRequestPackageInstalls()) {
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + c.getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Feed.show(c, Feed.APP, 2, "Finad " + name + " is ready",
                "Tap to let Finad install its updates (once). It then installs this one.",
                PendingIntent.getActivity(c, 2, allow, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            prefs.edit().putLong("updateAt", 0).apply();
            return name;
        }
        byte[] apk = Feed.read(new java.net.URL(j.getString("url")).openStream());
        String sha = hex(MessageDigest.getInstance("SHA-256").digest(apk));
        if (!sha.equalsIgnoreCase(j.optString("sha256"))) throw new Exception("The download does not match its SHA-256");
        install(c, apk, name);
        return name;
    }

    static void install(Context c, byte[] apk, String name) throws Exception {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        p.setAppPackageName(c.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = pi.createSession(p);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (OutputStream out = s.openWrite("finad.apk", 0, apk.length)) { out.write(apk); s.fsync(out); }
            Intent done = new Intent(c, Updater.class).putExtra("name", name);
            s.commit(PendingIntent.getBroadcast(c, id, done, PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0)).getIntentSender());
        }
    }

    @Override
    public void onReceive(Context c, Intent i) {
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(i.getAction())) {
            Notices.schedule(c);
            Feed.show(c, Feed.APP, 2, "Finad is up to date", "Version " + BuildConfig.VERSION_NAME + " is installed.",
                PendingIntent.getActivity(c, 4, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE));
            return;
        }
        int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String name = i.getStringExtra("name");
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm == null) return;
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Feed.show(c, Feed.APP, 2, "Update Finad to " + name, "Downloaded and checked. Tap to install it.",
                PendingIntent.getActivity(c, 3, confirm, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            Feed.prefs(c).edit().putLong("updateAt", 0).apply();
        }
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }
}
