package dev.forge.mobile;

import android.app.Activity;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/** Colors only: keep the existing system insets and navigation behavior. */
public final class SystemBars {
    private SystemBars() {}

    public static void apply(Activity activity, int top, int bottom) {
        Window window = activity.getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(top);
        // Before API 26 the navigation icons can only be white: retain a dark backdrop.
        window.setNavigationBarColor(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                || !SystemBarColors.useDarkIcons(bottom) ? bottom : 0xff171716);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) window.setNavigationBarDividerColor(bottom);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(SystemBarColors.useDarkIcons(top));
        controller.setAppearanceLightNavigationBars(SystemBarColors.useDarkIcons(bottom));
    }
}
