package dev.forge.mobile;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Reads a tiny presentation-only value from the main document; exposes no native API to JS. */
public final class PageSystemBars {
    private final Activity activity;
    private final WebView webView;
    private final View errorPanel;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final String script;
    private boolean active;
    private int generation;
    private int topColor;
    private int bottomColor;

    private final Runnable sample = this::read;

    public PageSystemBars(Activity activity, WebView webView, View errorPanel) {
        this.activity = activity;
        this.webView = webView;
        this.errorPanel = errorPanel;
        topColor = bottomColor = NativeTheme.resources(activity).getColor(R.color.surface, activity.getTheme());
        String source = "null";
        try (InputStream input = activity.getAssets().open("read-system-bar-theme.js")) {
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            source = new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            // Keep resource colors if the bundled presentation reader is unavailable.
        }
        script = source;
    }

    public void start() {
        if (active) return;
        active = true;
        refresh();
    }

    public void stop() {
        active = false;
        generation++;
        handler.removeCallbacks(sample);
    }

    public void refresh() {
        generation++;
        handler.removeCallbacks(sample);
        if (active) handler.post(sample);
    }

    public void restorePageColors() {
        SystemBars.apply(activity, topColor, bottomColor);
        refresh();
    }

    private void read() {
        if (!active || activity.isFinishing() || activity.isDestroyed()) return;
        String url = webView.getUrl();
        if (errorPanel.getVisibility() == View.VISIBLE || url == null
                || !(url.startsWith("http://") || url.startsWith("https://"))) {
            handler.postDelayed(sample, 500);
            return;
        }
        int epoch = generation;
        webView.evaluateJavascript(script, result -> {
            if (!active || epoch != generation) return;
            if (url.equals(webView.getUrl()) && errorPanel.getVisibility() != View.VISIBLE) {
                try {
                    // The page is untrusted: accept only two opaque RGB colors and one boolean.
                    if (result != null && result.length() <= 160) {
                        JSONObject theme = new JSONObject(result);
                        if (theme.get("dark") instanceof Boolean) {
                            int top = SystemBarColors.parse(theme.getString("top"));
                            int bottom = SystemBarColors.parse(theme.getString("bottom"));
                            if (top != topColor || bottom != bottomColor) {
                                topColor = top;
                                bottomColor = bottom;
                                SystemBars.apply(activity, top, bottom);
                            }
                            NativeTheme.remember(activity, theme.getBoolean("dark"));
                        }
                    }
                } catch (org.json.JSONException | IllegalArgumentException ignored) {
                    // Invalid, absent or stale samples never change system appearance.
                }
            }
            handler.postDelayed(sample, 500);
        });
    }
}
