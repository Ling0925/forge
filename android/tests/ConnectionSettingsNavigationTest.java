import dev.forge.mobile.ConnectionSettingsNavigation;

/** Host-JVM checks for the local settings route; no Android framework needed. */
public final class ConnectionSettingsNavigationTest {
    private static int passed;
    private static int failed;
    private static final String SERVER = "http://forge.local:5174/";
    private static final String ROUTE = SERVER.substring(0, SERVER.length() - 1)
            + ConnectionSettingsNavigation.PATH;

    public static void main(String[] args) {
        check(true, SERVER, SERVER, ROUTE, true, true);
        check(true, SERVER, SERVER + "?session=abc", ROUTE, true, true);
        check(true, "http://forge.local/", "http://FORGE.local:80/", "http://forge.local:80" + ConnectionSettingsNavigation.PATH, true, true);
        check(true, "https://forge.local/", "https://forge.local:443/", "https://forge.local" + ConnectionSettingsNavigation.PATH, true, true);
        check(false, SERVER, SERVER, ROUTE, false, true);
        check(false, SERVER, SERVER, ROUTE, true, false);
        check(false, SERVER, "http://other.local:5174/", ROUTE, true, true);
        check(false, SERVER, "http://forge.local:5173/", ROUTE, true, true);
        check(false, SERVER, "about:blank", ROUTE, true, true);
        check(false, SERVER, SERVER, "http://other.local:5174" + ConnectionSettingsNavigation.PATH, true, true);
        check(false, SERVER, SERVER, "https://forge.local:5174" + ConnectionSettingsNavigation.PATH, true, true);
        check(false, SERVER, SERVER, "http://forge.local:5173" + ConnectionSettingsNavigation.PATH, true, true);
        check(false, SERVER, SERVER, ROUTE + "?url=http://other.local/", true, true);
        check(false, SERVER, SERVER, ROUTE + "#fragment", true, true);
        check(false, SERVER, SERVER, ROUTE + "/", true, true);
        check(false, SERVER, SERVER, "http://forge.local:5174/.forge-mobile/%63onnection-settings", true, true);
        check(false, SERVER, SERVER, "http://user:pass@forge.local:5174" + ConnectionSettingsNavigation.PATH, true, true);
        check(false, SERVER, SERVER, "file:///" + ConnectionSettingsNavigation.PATH, true, true);
        check(false, null, SERVER, ROUTE, true, true);
        check(false, SERVER, null, ROUTE, true, true);
        check(false, SERVER, SERVER, null, true, true);
        check(false, SERVER, SERVER, "not a URL", true, true);
        System.out.println(passed + " passed, " + failed + " failed");
        if (failed != 0) System.exit(1);
    }

    private static void check(boolean expected, String connection, String page, String target,
                              boolean mainFrame, boolean gesture) {
        boolean actual = ConnectionSettingsNavigation.mayOpen(connection, page, target, mainFrame, gesture);
        if (actual == expected) {
            passed++;
        } else {
            failed++;
            System.out.println("FAIL connection settings route: " + target);
        }
    }
}
