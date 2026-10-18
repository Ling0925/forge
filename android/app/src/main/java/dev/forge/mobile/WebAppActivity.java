package dev.forge.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebChromeClient.FileChooserParams;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

/**
 * The whole client: a plain WebView pointed at the Forge HTTP workbench.
 *
 * <p>All product logic (sessions, tools, approvals, reconnects) stays on the server. The phone
 * only renders the Web UI, keeps its WebView DOM storage/cookies so the workbench keeps its own
 * client-side state across a restart, and forwards image picking to the system chooser.
 *
 * <p>Deliberately absent: any JavaScript interface/bridge, TLS error overrides, account or token
 * handling.
 *
 * <p>The Web UI targets a modern Chromium, so this Activity needs a reasonably new Android
 * System WebView; see docs/BUILD.md.
 */
public class WebAppActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "dev.forge.mobile.extra.URL";

    private WebView webView;
    private View errorPanel;
    private TextView errorDetail;

    private String currentUrl;
    private ValueCallback<Uri[]> fileCallback;

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                ValueCallback<Uri[]> callback = fileCallback;
                fileCallback = null;
                if (callback == null) {
                    return;
                }
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                    callback.onReceiveValue(null);
                    return;
                }
                Intent data = result.getData();
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    Uri[] uris = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        uris[i] = data.getClipData().getItemAt(i).getUri();
                    }
                    callback.onReceiveValue(uris);
                } else if (data.getData() != null) {
                    callback.onReceiveValue(new Uri[] {data.getData()});
                } else {
                    callback.onReceiveValue(null);
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_web);

        webView = findViewById(R.id.webview);
        errorPanel = findViewById(R.id.error_panel);
        errorDetail = findViewById(R.id.error_detail);
        TextView addressLabel = findViewById(R.id.address_label);

        String url;
        try {
            // Re-validate even though MainActivity already did: this Activity is the only
            // place that hands a URL to the WebView, so it must not trust its caller.
            url = ServerUrl.normalize(getIntent().getStringExtra(EXTRA_URL));
        } catch (ServerUrl.InvalidAddressException e) {
            finish();
            return;
        }
        currentUrl = url;
        addressLabel.setText(url);
        RecentServers.remember(this, url);

        findViewById(R.id.reload_button).setOnClickListener(v -> reload());
        findViewById(R.id.change_button).setOnClickListener(v -> finish());
        findViewById(R.id.retry_button).setOnClickListener(v -> reload());

        configureWebView();
        restoreOrLoad(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    // Leaves the workbench but keeps it in the recent list for one-tap return.
                    finish();
                }
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Some Android System WebView versions gate localStorage behind this flag as well.
        settings.setDatabaseEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(false);
        // Kept enabled on purpose: the system chooser returns content:// URIs and the WebView
        // must read them to upload a picked image. Non-http(s) top-level navigation is still
        // blocked in handleNavigation().
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setGeolocationEnabled(false);
        settings.setSaveFormData(false);
        settings.setBuiltInZoomControls(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        // Local WebView storage is kept so the Web UI keeps its own client-side state between
        // launches. This client has no account system and stores no credentials itself.
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, false);

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl(), request.isForMainFrame());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Legacy path (API < 24). Frame information is unavailable, so treat it as a
                // top-level navigation to stay on the safe side.
                return handleNavigation(Uri.parse(url), true);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (currentUrl != null && url != null && !url.equals(currentUrl)) {
                    currentUrl = url;
                    TextView label = findViewById(R.id.address_label);
                    if (label != null) {
                        label.setText(url);
                    }
                }
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    android.webkit.WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    showError(getString(R.string.error_load_failed, request.getUrl().toString()));
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                return startSystemFileChooser(callback, params);
            }
        });

        // The server owns uploads and downloads; without a handler the Web UI would fail silently.
        webView.setDownloadListener((downloadUrl, userAgent, contentDisposition, mimeType, length) ->
                Toast.makeText(this, R.string.download_unsupported, Toast.LENGTH_LONG).show());

        // No addJavascriptInterface() anywhere: the Web UI must not be able to call native code.
        // TLS errors are also left to the default WebViewClient behaviour, which cancels the
        // load. Do not add onReceivedSslError() here.
    }

    private void restoreOrLoad(Bundle savedInstanceState) {
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
            if (webView.getUrl() != null) {
                return;
            }
        }
        loadWorkbench();
    }

    private void loadWorkbench() {
        hideError();
        if (currentUrl != null) {
            webView.loadUrl(currentUrl);
        }
    }

    private void reload() {
        if (webView.getUrl() == null) {
            loadWorkbench();
        } else {
            hideError();
            webView.reload();
        }
    }

    /**
     * Decides whether the WebView may follow a URL.
     *
     * <p>Top-level navigation is restricted to http(s), so a hostile page cannot push the user
     * into {@code intent:}, {@code market:}, {@code tel:} or {@code file:} handlers. Sub-frames
     * are checked more leniently: iframes legitimately use {@code about:blank} and
     * {@code blob:}/{@code data:} previews, and silently blocking them would break the UI.
     * Refusals are silent because WebView also calls this for internal navigations such as
     * {@code about:blank} during teardown.
     */
    private boolean handleNavigation(Uri uri, boolean forMainFrame) {
        if (uri == null) {
            return true;
        }
        String scheme = uri.getScheme();
        if (scheme == null) {
            return true;
        }
        scheme = scheme.toLowerCase(java.util.Locale.ROOT);

        switch (scheme) {
            case "http":
            case "https":
            case "about":
                return false;
            case "blob":
            case "data":
                // Inline previews inside frames only; never as a top-level document.
                return forMainFrame;
            default:
                return true;
        }
    }

    private boolean startSystemFileChooser(ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
        }
        fileCallback = callback;

        Intent intent;
        try {
            intent = params.createIntent();
            intent.addCategory(Intent.CATEGORY_OPENABLE);
        } catch (RuntimeException e) {
            intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
        }

        try {
            // Wrap in the system chooser: no hard-coded gallery app, no storage permission.
            fileChooserLauncher.launch(Intent.createChooser(intent, getString(R.string.choose_image)));
            return true;
        } catch (ActivityNotFoundException e) {
            fileCallback = null;
            callback.onReceiveValue(null);
            Toast.makeText(this, R.string.error_no_file_picker, Toast.LENGTH_LONG).show();
            return false;
        }
    }

    private void showError(String detail) {
        errorDetail.setText(detail);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        errorPanel.setVisibility(View.GONE);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (webView != null) {
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
