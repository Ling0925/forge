package dev.forge.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.content.res.Resources;

import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;

/** Only the last observed appearance is stored, never page content or connection data. */
public final class NativeTheme {
    private static final String PREFERENCES = "appearance";
    private static final String DARK = "dark";

    private NativeTheme() {}

    public static void apply(AppCompatActivity activity) {
        SharedPreferences preferences = activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        if (preferences.contains(DARK)) {
            activity.getDelegate().setLocalNightMode(preferences.getBoolean(DARK, false)
                    ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO);
        }
    }

    public static void remember(Context context, boolean dark) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        if (!preferences.contains(DARK) || preferences.getBoolean(DARK, false) != dark) {
            preferences.edit().putBoolean(DARK, dark).apply();
        }
    }

    public static Resources resources(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        if (!preferences.contains(DARK)) return context.getResources();
        Configuration config = new Configuration(context.getResources().getConfiguration());
        config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK)
                | (preferences.getBoolean(DARK, false) ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
        return context.createConfigurationContext(config).getResources();
    }
}
