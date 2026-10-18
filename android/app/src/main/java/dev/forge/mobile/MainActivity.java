package dev.forge.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AppCompatActivity;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import java.util.List;

/**
 * Landing screen: scan a server QR code or type the workbench address.
 *
 * <p>The QR payload is a plain URL (for example {@code http://192.168.1.2:5173/}), so this
 * screen only needs to validate it and hand it to {@link WebAppActivity}. There is no account
 * system, no token exchange and no server-side registration.
 */
public class MainActivity extends AppCompatActivity {

    private EditText addressInput;
    private LinearLayout recentContainer;
    private TextView recentEmptyHint;
    private View recentSection;

    private final ActivityResultLauncher<ScanOptions> scanLauncher =
            registerForActivityResult(new ScanContract(), result -> {
                String contents = result.getContents();
                if (TextUtils.isEmpty(contents)) {
                    // Cancelled or the scanner returned no payload.
                    return;
                }
                onAddressChosen(contents, true);
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        addressInput = findViewById(R.id.address_input);
        recentContainer = findViewById(R.id.recent_container);
        recentEmptyHint = findViewById(R.id.recent_empty);
        recentSection = findViewById(R.id.recent_section);

        findViewById(R.id.scan_button).setOnClickListener(v -> startScan());
        findViewById(R.id.connect_button).setOnClickListener(v -> submitTypedAddress());
        addressInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO
                    || actionId == EditorInfo.IME_ACTION_DONE
                    || actionId == EditorInfo.IME_ACTION_SEND) {
                submitTypedAddress();
                return true;
            }
            return false;
        });
        findViewById(R.id.clear_recent_button).setOnClickListener(v -> {
            RecentServers.clear(this);
            renderRecent();
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        renderRecent();
    }

    private void startScan() {
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
        options.setPrompt(getString(R.string.scan_prompt));
        options.setBeepEnabled(false);
        options.setBarcodeImageEnabled(false);
        options.setOrientationLocked(false);
        scanLauncher.launch(options);
    }

    private void submitTypedAddress() {
        String raw = addressInput.getText() == null ? "" : addressInput.getText().toString();
        if (raw.trim().isEmpty()) {
            Toast.makeText(this, R.string.error_empty_address, Toast.LENGTH_SHORT).show();
            return;
        }
        hideKeyboard();
        onAddressChosen(raw, false);
    }

    private void onAddressChosen(String raw, boolean fromScan) {
        String url;
        try {
            url = ServerUrl.normalize(raw);
        } catch (ServerUrl.InvalidAddressException e) {
            String prefix = fromScan ? getString(R.string.error_scan_prefix) : "";
            String detail = e.getMessage() == null ? getString(R.string.error_invalid_address) : e.getMessage();
            Toast.makeText(this, prefix + detail, Toast.LENGTH_LONG).show();
            return;
        }

        RecentServers.remember(this, url);
        addressInput.setText(url);
        openWorkbench(url);
    }

    private void openWorkbench(String url) {
        Intent intent = new Intent(this, WebAppActivity.class);
        intent.putExtra(WebAppActivity.EXTRA_URL, url);
        startActivity(intent);
    }

    private void renderRecent() {
        List<String> recent = RecentServers.load(this);
        recentContainer.removeAllViews();

        boolean empty = recent.isEmpty();
        recentEmptyHint.setVisibility(empty ? View.VISIBLE : View.GONE);
        recentSection.setVisibility(empty ? View.GONE : View.VISIBLE);

        for (String url : recent) {
            Button row = new Button(this);
            row.setText(url);
            row.setAllCaps(false);
            row.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_START);
            row.setBackgroundResource(R.drawable.bg_recent_item);
            row.setPadding(dp(16), dp(12), dp(16), dp(12));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            params.bottomMargin = dp(8);
            row.setLayoutParams(params);
            row.setOnClickListener(v -> openWorkbench(url));
            recentContainer.addView(row);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void hideKeyboard() {
        View focused = getCurrentFocus();
        if (focused == null) {
            return;
        }
        InputMethodManager imm = getSystemService(InputMethodManager.class);
        if (imm != null) {
            imm.hideSoftInputFromWindow(focused.getWindowToken(), 0);
        }
        focused.clearFocus();
    }
}
