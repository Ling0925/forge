package dev.forge.mobile;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Small local list of previously used server addresses.
 *
 * <p>Only URLs are stored - no tokens, cookies or credentials. The list is a convenience
 * for reconnecting, never an account store.
 */
public final class RecentServers {

    private static final String PREFS_NAME = "forge_mobile";
    private static final String KEY_RECENT = "recent_servers";
    private static final int MAX_ENTRIES = 8;

    private RecentServers() {}

    public static List<String> load(Context context) {
        SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_RECENT, "[]");
        List<String> result = new ArrayList<>();
        if (raw == null) {
            return result;
        }
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                Object item = array.opt(i);
                if (item instanceof String) {
                    String value = ((String) item).trim();
                    if (!value.isEmpty() && !result.contains(value)) {
                        result.add(value);
                    }
                }
            }
        } catch (JSONException ignored) {
            // Corrupt prefs are not worth crashing over; start from an empty list.
        }
        return result;
    }

    public static void remember(Context context, String url) {
        if (url == null || url.isEmpty()) {
            return;
        }
        List<String> current = load(context);
        current.remove(url);
        current.add(0, url);
        if (current.size() > MAX_ENTRIES) {
            current = new ArrayList<>(current.subList(0, MAX_ENTRIES));
        }
        persist(context, current);
    }

    public static void clear(Context context) {
        persist(context, Collections.<String>emptyList());
    }

    private static void persist(Context context, List<String> urls) {
        JSONArray array = new JSONArray();
        for (String url : urls) {
            array.put(url);
        }
        context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_RECENT, array.toString())
                .apply();
    }
}
