import dev.forge.mobile.ServerUrl;

/**
 * Dependency-free checks for {@link ServerUrl}.
 *
 * <p>ServerUrl has no Android imports on purpose, so this runs with a plain JDK:
 *
 * <pre>
 *   cd android
 *   ./gradlew checkServerUrl      # or: java tests/ServerUrlTest.java (Java 11+ source launch)
 * </pre>
 *
 * <p>It only asserts URL normalisation/rejection. WebView behaviour (localStorage, camera,
 * uploads) can only be verified on a device or emulator.
 */
public final class ServerUrlTest {

    private static int passed = 0;
    private static int failed = 0;

    public static void main(String[] args) {
        // Accepted, normalised forms.
        expectOk("http://192.168.1.2:5173/", "http://192.168.1.2:5173/");
        expectOk("192.168.1.2:5173", "http://192.168.1.2:5173/");
        expectOk("192.168.1.2:5173/", "http://192.168.1.2:5173/");
        expectOk("  http://192.168.1.2:5173  ", "http://192.168.1.2:5173/");
        expectOk("https://forge.example.com/workbench", "https://forge.example.com/workbench");
        expectOk("http://forge.local:5173/?a=1", "http://forge.local:5173/?a=1");
        expectOk("HTTP://192.168.1.2:5173/", "http://192.168.1.2:5173/");
        expectOk("http://192.168.1.2", "http://192.168.1.2/");
        expectOk("http://[::1]:5173/", "http://[::1]:5173/");
        expectOk("::1", "http://[::1]/");
        expectOk("http://192.168.1.2:5173/#/session/abc", "http://192.168.1.2:5173/#/session/abc");

        // A ':' in the path or query must not be mistaken for a bad port.
        expectOk("http://192.168.1.2:5173/a:b", "http://192.168.1.2:5173/a:b");
        expectOk("http://192.168.1.2:5173/?t=12:30", "http://192.168.1.2:5173/?t=12:30");

        // Rejected schemes and credentials.
        expectReject("javascript:alert(1)");
        expectReject("intent://scan/#Intent;scheme=zxing;end");
        expectReject("file:///sdcard/secret.txt");
        expectReject("content://com.example/thing");
        expectReject("data:text/html,<script>alert(1)</script>");
        expectReject("http://user:pass@192.168.1.2:5173/");
        expectReject("ftp://192.168.1.2/");

        // Rejected malformed input.
        expectReject("");
        expectReject("   ");
        expectReject("http://");
        expectReject("http://host:abc/");
        expectReject("http://host:99999/");
        expectReject("http://exa mple.com/");

        System.out.println(passed + " passed, " + failed + " failed");
        if (failed > 0) {
            System.exit(1);
        }
    }

    private static void expectOk(String input, String expected) {
        try {
            String actual = ServerUrl.normalize(input);
            if (expected.equals(actual)) {
                passed++;
            } else {
                failed++;
                System.out.println("FAIL normalize(" + input + ") = " + actual + ", expected " + expected);
            }
        } catch (ServerUrl.InvalidAddressException e) {
            failed++;
            System.out.println("FAIL normalize(" + input + ") rejected: " + e.getMessage());
        }
    }

    private static void expectReject(String input) {
        try {
            String actual = ServerUrl.normalize(input);
            failed++;
            System.out.println("FAIL normalize(" + input + ") accepted as " + actual);
        } catch (ServerUrl.InvalidAddressException e) {
            passed++;
        }
    }
}
