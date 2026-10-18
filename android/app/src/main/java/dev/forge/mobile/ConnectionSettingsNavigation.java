package dev.forge.mobile;

import java.net.URI;
import java.net.URISyntaxException;

/** A user-activated, same-origin link may open only the local connection editor. */
public final class ConnectionSettingsNavigation {
    public static final String PATH = "/.forge-mobile/connection-settings";

    private ConnectionSettingsNavigation() {}

    public static boolean mayOpen(String connectionUrl, String pageUrl, String targetUrl,
                                  boolean mainFrame, boolean userGesture) {
        if (!mainFrame || !userGesture || connectionUrl == null || pageUrl == null || targetUrl == null) {
            return false;
        }
        try {
            URI connection = new URI(connectionUrl);
            URI page = new URI(pageUrl);
            URI target = new URI(targetUrl);
            return isHttp(connection) && isHttp(page) && isHttp(target)
                    && sameOrigin(connection, page) && sameOrigin(connection, target)
                    && PATH.equals(target.getRawPath())
                    && target.getRawQuery() == null && target.getRawFragment() == null;
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private static boolean isHttp(URI uri) {
        return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                && uri.getHost() != null && uri.getRawUserInfo() == null;
    }

    private static boolean sameOrigin(URI left, URI right) {
        return left.getScheme().equalsIgnoreCase(right.getScheme())
                && left.getHost().equalsIgnoreCase(right.getHost()) && port(left) == port(right);
    }

    private static int port(URI uri) {
        return uri.getPort() != -1 ? uri.getPort() : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }
}
