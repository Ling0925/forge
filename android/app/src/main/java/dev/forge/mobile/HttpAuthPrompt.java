package dev.forge.mobile;

import android.os.Build;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.HttpAuthHandler;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;

/** Native HTTP authentication, not a Forge account or a persistent password store. */
final class HttpAuthPrompt {
    private final AppCompatActivity activity;
    private final Runnable onCancelled;
    private final List<Challenge> pending = new ArrayList<>();
    private AlertDialog dialog;

    private static final class Challenge {
        final HttpAuthHandler handler;
        final String host;

        Challenge(HttpAuthHandler handler, String host) {
            this.handler = handler;
            this.host = host;
        }
    }

    HttpAuthPrompt(AppCompatActivity activity, Runnable onCancelled) {
        this.activity = activity;
        this.onCancelled = onCancelled;
    }

    boolean isShowing() {
        return dialog != null;
    }

    void show(HttpAuthHandler handler, String host) {
        if (activity.isFinishing() || activity.isDestroyed()) {
            handler.cancel();
            return;
        }
        // Serialize prompts, not credentials: the callback exposes no scheme/port, so even
        // matching host/realm strings cannot safely authorize a second request ourselves.
        pending.add(new Challenge(handler, host));
        showNext();
    }

    private void showNext() {
        if (dialog != null || pending.isEmpty()) return;
        AlertDialog.Builder builder = new AlertDialog.Builder(activity);
        View fields = activity.getLayoutInflater().cloneInContext(builder.getContext())
                .inflate(R.layout.dialog_http_auth, null);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            fields.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        ((TextView) fields.findViewById(R.id.http_auth_host))
                .setText(activity.getString(R.string.http_auth_host, pending.get(0).host));
        EditText username = fields.findViewById(R.id.http_auth_username);
        EditText password = fields.findViewById(R.id.http_auth_password);
        dialog = builder.setTitle(R.string.http_auth_title)
                .setView(fields)
                .setPositiveButton(R.string.http_auth_sign_in, null)
                .setNegativeButton(android.R.string.cancel, (ignored, which) -> cancelByUser())
                .create();
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnCancelListener(ignored -> cancelByUser());
        dialog.setOnDismissListener(ignored -> {
            username.setText("");
            password.setText("");
        });
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(v -> submit(username, password)));
        password.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId != EditorInfo.IME_ACTION_GO && actionId != EditorInfo.IME_ACTION_DONE) {
                return false;
            }
            submit(username, password);
            return true;
        });
        dialog.show();
        username.requestFocus();
    }

    private void submit(EditText username, EditText password) {
        if (pending.isEmpty()) return;
        // Do not trim, encode into a URL, persist, or log either field. Empty passwords are valid.
        // WebView owns HTTP auth caching (including subresources, fetch and WebSocket handshakes).
        // In particular, do not attach a global Authorization header or replay rejected passwords.
        String user = username.getText().toString();
        String secret = password.getText().toString();
        Challenge challenge = pending.remove(0);
        dismiss();
        challenge.handler.proceed(user, secret);
        showNext();
    }

    private void cancelByUser() {
        cancel();
        onCancelled.run();
    }

    /** Resolve every handler before navigation, connection changes or Activity destruction. */
    void cancel() {
        List<Challenge> cancelled = new ArrayList<>(pending);
        pending.clear();
        dismiss();
        for (Challenge challenge : cancelled) challenge.handler.cancel();
    }

    private void dismiss() {
        AlertDialog previous = dialog;
        dialog = null;
        if (previous != null) previous.dismiss();
    }
}
