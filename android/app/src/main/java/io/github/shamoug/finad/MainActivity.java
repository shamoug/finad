// Finad for Android: shows the signals, alerts, world drivers and news that Finad on the computer publishes, in a
// window of its own (the page is in the app's assets). The page reads the feed through the bridge below; the feed
// itself comes from the read-only link of a free JSON store (Feed.java). It links to a computer with the QR code in
// Finad's Phone page: scanned in the app (Google's code scanner) or opened from the camera.
package io.github.shamoug.finad;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String PAGE = "file:///android_asset/index.html";
    private WebView web;
    private SwipeRefreshLayout pull;
    private volatile boolean sheetOpen;
    private boolean loaded;
    private String pendingSym;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0A101D"));
        // Pulling down at the top of the page refreshes everything: the feed and the app version.
        pull = new SwipeRefreshLayout(this);
        pull.addView(web);
        pull.setColorSchemeColors(0xFF2EC27E);
        pull.setProgressBackgroundColorSchemeColor(0xFF1A2333);
        pull.setOnChildScrollUpCallback((parent, child) -> sheetOpen || web.canScrollVertically(-1));
        pull.setOnRefreshListener(this::refreshAll);
        setContentView(pull);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowContentAccess(false);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "FinadApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("file".equals(u.getScheme())) return false;
                if (pair(u)) return true;
                external(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loaded = true;
                if (Feed.id(MainActivity.this) == null) pull.setRefreshing(false);   // linked: the page's own refresh stops it
                if (pendingSym != null) { js("window.finadOpen && finadOpen(" + JSONObject.quote(pendingSym) + ")"); pendingSym = null; }
            }
        });

        Notices.schedule(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        new Thread(() -> { try { Updater.checkIfDue(getApplicationContext()); } catch (Exception e) { /* next time */ } }).start();

        handle(getIntent());
        web.loadUrl(PAGE);
    }

    /** A pairing link or a tapped notification. */
    private void handle(Intent i) {
        if (i == null) return;
        String sym = i.getStringExtra("sym");
        if (sym != null && !sym.isEmpty()) {
            if (loaded) js("window.finadOpen && finadOpen(" + JSONObject.quote(sym) + ")"); else pendingSym = sym;
        }
        if (i.getData() != null) pair(i.getData());
    }

    /**
     * Links to a computer's feed: https://shamoug.github.io/finad/open.html#feed=ID (the QR code) or finad://pair?feed=ID.
     */
    private boolean pair(Uri u) {
        if (u == null) return false;
        String id = null;
        if ("https".equals(u.getScheme()) && "shamoug.github.io".equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/finad/open")) {
            String f = u.getFragment();
            if (f != null && f.startsWith("feed=")) id = f.substring(5);
        } else if ("finad".equals(u.getScheme())) {
            id = u.getQueryParameter("feed");
        } else return false;
        if (!Feed.validId(id)) { toast("That is not a Finad link. Scan the QR code on Finad's Phone page on your computer."); return true; }
        Feed.pair(this, id.toUpperCase());
        toast("Linked to Finad on your computer");
        refreshThen("window.finadPaired && finadPaired()");
        return true;
    }

    /** Like Ctrl+F5: empties the page's cache and reloads it, fetches the feed afresh (the reloaded page asks for it) and
     *  looks for a new version of the app. */
    private void refreshAll() {
        new Thread(() -> { try { Updater.check(getApplicationContext(), true); } catch (Exception e) { /* next time */ } }).start();
        sheetOpen = false;
        loaded = false;
        web.clearCache(true);
        web.loadUrl(PAGE);
    }

    private void refreshThen(String script) {
        new Thread(() -> {
            String err = null;
            try { Feed.fetch(getApplicationContext(), false); } catch (Exception e) { err = e.getMessage(); }
            String e2 = err;
            runOnUiThread(() -> {
                if (pull != null) pull.setRefreshing(false);
                if (e2 != null) toast("Could not refresh: " + e2);
                js("window.onFeed && onFeed(" + (e2 == null ? "null" : JSONObject.quote(e2)) + ")");
                if (script != null) js(script);
            });
        }).start();
    }

    private void js(String code) { if (web != null) web.evaluateJavascript(code, null); }
    private void toast(String t) { Toast.makeText(this, t, Toast.LENGTH_LONG).show(); }
    private void external(Uri u) { try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException e) { /* nothing can open it */ } }

    /** What the page may ask of the app. */
    public class Bridge {
        @JavascriptInterface public String feed() { String s = Feed.cached(getApplicationContext()); return s == null ? "" : s; }
        @JavascriptInterface public String feedId() { String s = Feed.id(getApplicationContext()); return s == null ? "" : s; }
        @JavascriptInterface public long fetchedAt() { return Feed.prefs(getApplicationContext()).getLong("fetchedAt", 0); }
        @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public void refresh() { runOnUiThread(() -> refreshThen(null)); }
        @JavascriptInterface public void sheet(boolean open) { sheetOpen = open; }
        @JavascriptInterface public void markSeen() { Feed.markSeen(getApplicationContext()); }
        @JavascriptInterface public void scan() { runOnUiThread(MainActivity.this::scan); }
        @JavascriptInterface public void pairCode(String text) { runOnUiThread(() -> { if (!pair(Uri.parse(text.trim()))) { if (Feed.validId(text.trim())) pair(Uri.parse("finad://pair?feed=" + text.trim())); else toast("That is not a Finad link or code."); } }); }
        @JavascriptInterface public void unpair() { Feed.unpair(getApplicationContext()); }
        @JavascriptInterface public void open(String url) { runOnUiThread(() -> external(Uri.parse(url))); }
        @JavascriptInterface public void checkUpdate() {
            new Thread(() -> {
                String msg;
                try { String n = Updater.check(getApplicationContext(), true); msg = n == null ? "Finad is up to date (" + BuildConfig.VERSION_NAME + ")." : "Installing Finad " + n + "…"; }
                catch (Exception e) { msg = "Could not check for updates: " + e.getMessage(); }
                String m = msg;
                runOnUiThread(() -> toast(m));
            }).start();
        }
    }

    private void scan() {
        GmsBarcodeScannerOptions opts = new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build();
        GmsBarcodeScanning.getClient(this, opts).startScan()
            .addOnSuccessListener(code -> {
                String v = code.getRawValue() == null ? "" : code.getRawValue().trim();
                if (!pair(Uri.parse(v))) toast("That is not a Finad code. Scan the one on Finad's Phone page on your computer.");
            })
            .addOnFailureListener(e -> toast("The scanner is not available on this phone: paste the link instead."));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (Feed.id(this) != null) refreshThen(null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.finadBack ? finadBack() : false", v -> { if (!"true".equals(v)) MainActivity.super.onBackPressed(); });
    }
}
