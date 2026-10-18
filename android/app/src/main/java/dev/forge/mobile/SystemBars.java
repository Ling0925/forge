package dev.forge.mobile;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ArgbEvaluator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.Map;
import java.util.WeakHashMap;

/** Dynamic system bar animations with contrast-safe icon transitions. */
public final class SystemBars {
    public static final int DURATION_MS = 280;
    private static final Map<Window, ValueAnimator> RUNNING_ANIMATORS = new WeakHashMap<>();

    private SystemBars() {}

    public static void apply(Activity activity, int top, int bottom) {
        apply(activity, top, bottom, true);
    }

    public static void apply(Activity activity, int top, int bottom, boolean animate) {
        Window window = activity.getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        // Before API 26 the navigation icons can only be white: retain a dark backdrop.
        int targetBottom = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                || !SystemBarColors.useDarkIcons(bottom) ? bottom : 0xff171716;

        ValueAnimator running = RUNNING_ANIMATORS.get(window);
        if (running != null) {
            running.cancel();
            RUNNING_ANIMATORS.remove(window);
        }

        int currentTop = window.getStatusBarColor();
        int currentBottom = window.getNavigationBarColor();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());

        if (!animate || (currentTop == top && currentBottom == targetBottom)) {
            window.setStatusBarColor(top);
            window.setNavigationBarColor(targetBottom);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) window.setNavigationBarDividerColor(targetBottom);
            controller.setAppearanceLightStatusBars(SystemBarColors.useDarkIcons(top));
            controller.setAppearanceLightNavigationBars(SystemBarColors.useDarkIcons(bottom));
            return;
        }

        ValueAnimator animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(DURATION_MS);
        animator.setInterpolator(new PathInterpolator(0.4f, 0f, 0.2f, 1f));

        final ArgbEvaluator evaluator = new ArgbEvaluator();
        final int fromTop = currentTop;
        final int fromBottom = currentBottom;

        animator.addUpdateListener(animation -> {
            if (activity.isFinishing() || activity.isDestroyed()) {
                animation.cancel();
                return;
            }
            float fraction = animation.getAnimatedFraction();
            int animTop = ((Integer) evaluator.evaluate(fraction, fromTop, top)).intValue();
            int animBottom = ((Integer) evaluator.evaluate(fraction, fromBottom, targetBottom)).intValue();

            window.setStatusBarColor(animTop);
            window.setNavigationBarColor(animBottom);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                window.setNavigationBarDividerColor(animBottom);
            }
            // Smoothly flip icon tint at the luminance threshold during interpolation
            controller.setAppearanceLightStatusBars(SystemBarColors.useDarkIcons(animTop));
            controller.setAppearanceLightNavigationBars(SystemBarColors.useDarkIcons(animBottom));
        });

        animator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                RUNNING_ANIMATORS.remove(window);
                if (!activity.isFinishing() && !activity.isDestroyed()) {
                    window.setStatusBarColor(top);
                    window.setNavigationBarColor(targetBottom);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        window.setNavigationBarDividerColor(targetBottom);
                    }
                    controller.setAppearanceLightStatusBars(SystemBarColors.useDarkIcons(top));
                    controller.setAppearanceLightNavigationBars(SystemBarColors.useDarkIcons(bottom));
                }
            }

            @Override
            public void onAnimationCancel(Animator animation) {
                RUNNING_ANIMATORS.remove(window);
            }
        });

        RUNNING_ANIMATORS.put(window, animator);
        animator.start();
    }
}
