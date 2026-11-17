package com.galaxyops.lcars;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Galaxy OPS: hosts the LCARS-style web UI in a full-screen WebView and gives it
 * native launcher powers through the "GalaxyNative" JavaScript bridge.
 * Declared as a HOME activity so it can be set as the default launcher.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "file:///android_asset/index.html";
    private static final int REQ_VOICE = 1;
    private static final int REQ_LOCATION = 2;

    private WebView web;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "GalaxyNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeoOrigin = origin;
                    pendingGeoCallback = callback;
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }
        });
        web.loadUrl(START_URL);
        hideSystemUi();
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideSystemUi();
        js("window.onNativeResume&&window.onNativeResume()");
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Home button pressed while we are already on top: jump back to OPS.
        if (intent != null && intent.hasCategory(Intent.CATEGORY_HOME)) {
            js("window.onNativeHome&&window.onNativeHome()");
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Let the UI handle Back (return to OPS). As the home screen, never exit.
        web.evaluateJavascript("window.onNativeBack?window.onNativeBack():false", value -> {
            if (!"true".equals(value) && !isDefaultHome()) moveTaskToBack(true);
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_VOICE) {
            String text = "";
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> r = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (r != null && !r.isEmpty()) text = r.get(0);
            }
            sendVoice(text);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && pendingGeoCallback != null) {
            pendingGeoCallback.invoke(pendingGeoOrigin, hasLocationPermission(), false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    // ---------------------------------------------------------------- helpers

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    /** Routes every non-page link (tel:, sms:, intent:, app:, https:) to Android. */
    private boolean handleUrl(String url) {
        if (url == null) return true;
        if (url.startsWith("file:") || url.startsWith("about:")) return false;
        if (url.startsWith("app:")) return launchPackage(url.substring(4));
        try {
            Intent intent;
            if (url.startsWith("intent:")) {
                intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            } else if (url.startsWith("tel:")) {
                intent = new Intent(Intent.ACTION_DIAL, Uri.parse(url));
            } else if (url.startsWith("mailto:") || url.startsWith("sms:") || url.startsWith("smsto:")) {
                intent = new Intent(Intent.ACTION_SENDTO, Uri.parse(url));
            } else {
                intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException | java.net.URISyntaxException | SecurityException e) {
            jsStatus("NO APP AVAILABLE FOR THAT LINK");
        }
        return true;
    }

    private boolean launchPackage(String pkg) {
        Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) {
            jsStatus("APPLICATION NOT FOUND");
            return true;
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try {
            startActivity(i);
        } catch (Exception e) {
            jsStatus("LAUNCH FAILED");
        }
        return true;
    }

    private boolean isDefaultHome() {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo r = getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
        return r != null && r.activityInfo != null && getPackageName().equals(r.activityInfo.packageName);
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void js(String code) {
        runOnUiThread(() -> web.evaluateJavascript(code, null));
    }

    private void jsStatus(String msg) {
        js("window.onNativeStatus&&window.onNativeStatus(" + JSONObject.quote(msg) + ")");
    }

    private void sendVoice(String text) {
        js("window.onNativeVoice&&window.onNativeVoice(" + JSONObject.quote(text) + ")");
    }

    // ---------------------------------------------------------------- JS bridge

    private class Bridge {
        @JavascriptInterface
        public String listApps() {
            PackageManager pm = getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> infos = pm.queryIntentActivities(main, 0);
            List<String[]> apps = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (ResolveInfo ri : infos) {
                String pkg = ri.activityInfo.packageName;
                if (pkg.equals(getPackageName()) || !seen.add(pkg)) continue;
                apps.add(new String[]{String.valueOf(ri.loadLabel(pm)), pkg});
            }
            Collections.sort(apps, (a, b) -> a[0].compareToIgnoreCase(b[0]));
            JSONArray arr = new JSONArray();
            try {
                for (String[] a : apps) arr.put(new JSONObject().put("label", a[0]).put("pkg", a[1]));
            } catch (JSONException ignored) {
            }
            return arr.toString();
        }

        @JavascriptInterface
        public void launchApp(String pkg) {
            runOnUiThread(() -> launchPackage(pkg));
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> handleUrl(url));
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void vibrate(int ms) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            int d = Math.max(1, Math.min(ms, 2000));
            v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE));
        }

        @JavascriptInterface
        public String battery() {
            Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            JSONObject o = new JSONObject();
            try {
                if (b != null) {
                    int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                    int status = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                    if (level >= 0 && scale > 0) o.put("level", level / (double) scale);
                    o.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING
                            || status == BatteryManager.BATTERY_STATUS_FULL);
                }
            } catch (JSONException ignored) {
            }
            return o.toString();
        }

        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void startVoice() {
            runOnUiThread(() -> {
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
                i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Personal log");
                try {
                    startActivityForResult(i, REQ_VOICE);
                } catch (ActivityNotFoundException e) {
                    sendVoice("");
                    jsStatus("VOICE INPUT UNAVAILABLE");
                }
            });
        }

        @JavascriptInterface
        public void openHomeSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_HOME_SETTINGS));
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Settings.ACTION_SETTINGS));
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean isDefaultHome() {
            return MainActivity.this.isDefaultHome();
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
