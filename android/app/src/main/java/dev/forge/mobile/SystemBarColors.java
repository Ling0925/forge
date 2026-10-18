package dev.forge.mobile;

/** Strict opaque-color validation and contrast checks, independent of Android. */
public final class SystemBarColors {
    private SystemBarColors() {}

    public static int parse(String value) {
        if (value == null || !value.matches("#[0-9a-fA-F]{6}")) {
            throw new IllegalArgumentException("Expected an opaque RGB color");
        }
        return (int) (0xff000000L | Long.parseLong(value.substring(1), 16));
    }

    /** Choose the icon color with the higher WCAG contrast ratio. */
    public static boolean useDarkIcons(int color) {
        double luminance = 0.2126 * linear((color >> 16) & 255)
                + 0.7152 * linear((color >> 8) & 255) + 0.0722 * linear(color & 255);
        return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05);
    }

    private static double linear(int channel) {
        double value = channel / 255.0;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    }
}
