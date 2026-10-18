package dev.forge.mobile;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Parsing and validation for server addresses.
 *
 * <p>The mobile client only ever talks to a Forge HTTP(S) workbench, so only {@code http} and
 * {@code https} are accepted. Everything else - {@code intent:}, {@code javascript:},
 * {@code file:}, {@code content:}, {@code data:} - is rejected, so a hostile QR code cannot make
 * the WebView load local or script content. Credentials embedded in the URL
 * ({@code http://user:pass@host/}) are rejected as well: this client has no account system and
 * must not replay secrets it was handed.
 *
 * <p>Scope of the first version: the plain root URL printed by the workbench, typically IPv4 or
 * a hostname such as {@code http://192.168.1.2:5173/}. Bare {@code host:port} input is accepted
 * and upgraded to {@code http}. IPv6 literals are handled, but see docs/BUILD.md: they are
 * covered only by the local URI tests, not by a device test.
 */
public final class ServerUrl {

    private ServerUrl() {}

    /** Thrown when user input or a scanned code is not an acceptable server address. */
    public static final class InvalidAddressException extends Exception {
        public InvalidAddressException(String message) {
            super(message);
        }
    }

    /**
     * Normalises a scanned or typed address into a loadable http(s) URL.
     *
     * <p>A missing scheme is treated as {@code http}, so {@code 192.168.1.2:5173} works. Any
     * other explicit scheme is rejected rather than silently rewritten, which keeps
     * {@code javascript:...} and {@code intent://...} payloads out of the WebView.
     */
    public static String normalize(String raw) throws InvalidAddressException {
        if (raw == null) {
            throw new InvalidAddressException("地址为空");
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            throw new InvalidAddressException("地址为空");
        }
        for (int i = 0; i < trimmed.length(); i++) {
            char c = trimmed.charAt(i);
            if (c <= 0x20 || c == 0x7f) {
                throw new InvalidAddressException("地址包含空白或控制字符");
            }
        }

        URI uri;
        try {
            uri = new URI(withScheme(trimmed));
        } catch (URISyntaxException e) {
            throw new InvalidAddressException("地址格式无效");
        }

        String scheme = uri.getScheme();
        if (scheme == null) {
            throw new InvalidAddressException("地址缺少协议");
        }
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            throw new InvalidAddressException("仅支持 http/https 地址");
        }
        if (uri.getRawUserInfo() != null) {
            throw new InvalidAddressException("地址不能包含用户名或密码");
        }

        // java.net.URI returns IPv6 literals *with* brackets ("[::1]"), so strip them before
        // re-assembling the authority, otherwise we would produce "[[::1]]".
        String host = uri.getHost();
        if (host == null || host.isEmpty()) {
            // Also covers junk authorities such as "http://host:abc/", where URI reports no host.
            throw new InvalidAddressException("地址缺少主机名或端口无效");
        }
        if (host.startsWith("[") && host.endsWith("]")) {
            host = host.substring(1, host.length() - 1);
        }
        if (host.isEmpty() || !isPlainHost(host)) {
            throw new InvalidAddressException("主机名格式无效");
        }

        int port = uri.getPort();
        if (port != -1 && (port < 1 || port > 65535)) {
            throw new InvalidAddressException("端口无效");
        }

        StringBuilder authority = new StringBuilder();
        authority.append(host.indexOf(':') >= 0 ? "[" + host + "]" : host);
        if (port != -1) {
            authority.append(':').append(port);
        }

        String path = uri.getRawPath();
        if (path == null || path.isEmpty()) {
            path = "/";
        }

        StringBuilder out = new StringBuilder();
        out.append(scheme).append("://").append(authority).append(path);
        if (uri.getRawQuery() != null && !uri.getRawQuery().isEmpty()) {
            out.append('?').append(uri.getRawQuery());
        }
        if (uri.getRawFragment() != null && !uri.getRawFragment().isEmpty()) {
            out.append('#').append(uri.getRawFragment());
        }
        return out.toString();
    }

    /**
     * Returns {@code value} with an {@code http://} prefix when it carries no usable scheme.
     *
     * <p>Only {@code http} and {@code https} count as schemes here. Input whose scheme-looking
     * prefix is followed by digits only is treated as {@code host:port} (for example
     * {@code forge.local:5173}), while a real foreign scheme such as {@code javascript:} is
     * rejected instead of being rewritten into an http URL.
     */
    private static String withScheme(String value) throws InvalidAddressException {
        if (looksLikeBareIpv6(value)) {
            return "http://[" + value + "]";
        }
        int colon = value.indexOf(':');
        if (colon <= 0) {
            return "http://" + value;
        }
        int slash = value.indexOf('/');
        if (slash >= 0 && slash < colon) {
            return "http://" + value;
        }
        if (!isSchemeToken(value.substring(0, colon))) {
            return "http://" + value;
        }
        String scheme = value.substring(0, colon).toLowerCase(Locale.ROOT);
        if (scheme.equals("http") || scheme.equals("https")) {
            return value;
        }
        if (looksLikePort(value, colon + 1)) {
            return "http://" + value;
        }
        throw new InvalidAddressException("仅支持 http/https 地址");
    }

    /** True when everything from {@code from} to the end of the authority is numeric. */
    private static boolean looksLikePort(String value, int from) {
        int end = value.length();
        int slash = value.indexOf('/', from);
        if (slash >= 0) {
            end = slash;
        }
        int question = value.indexOf('?', from);
        if (question >= 0 && question < end) {
            end = question;
        }
        if (from >= end) {
            return false;
        }
        for (int i = from; i < end; i++) {
            if (!Character.isDigit(value.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    /**
     * Bare IPv6 literals (such as {@code ::1} or {@code fe80::1}) need brackets before they can
     * be used as a URI authority. Anything with two or more colons and only hex/dot characters
     * is treated as one.
     */
    private static boolean looksLikeBareIpv6(String value) {
        int colons = 0;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == ':') {
                colons++;
                continue;
            }
            boolean hex = (c >= '0' && c <= '9')
                    || (c >= 'a' && c <= 'f')
                    || (c >= 'A' && c <= 'F')
                    || c == '.';
            if (!hex) {
                return false;
            }
        }
        return colons >= 2;
    }

    private static boolean isSchemeToken(String value) {
        if (value.isEmpty() || !isAsciiLetter(value.charAt(0))) {
            return false;
        }
        for (int i = 1; i < value.length(); i++) {
            char c = value.charAt(i);
            boolean allowed = isAsciiLetter(c)
                    || (c >= '0' && c <= '9')
                    || c == '+'
                    || c == '-'
                    || c == '.';
            if (!allowed) {
                return false;
            }
        }
        return true;
    }

    private static boolean isAsciiLetter(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }

    /**
     * Hostnames and IP literals only: letters, digits, dots, hyphens, colons (IPv6) and
     * underscores, with no whitespace or percent-encoding.
     */
    private static boolean isPlainHost(String host) {
        if (host.length() > 253) {
            return false;
        }
        for (int i = 0; i < host.length(); i++) {
            char c = host.charAt(i);
            boolean allowed = isAsciiLetter(c)
                    || (c >= '0' && c <= '9')
                    || c == '.'
                    || c == '-'
                    || c == ':'
                    || c == '_';
            if (!allowed) {
                return false;
            }
        }
        return true;
    }
}
