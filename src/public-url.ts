function isLoopbackHostname(hostname: string): boolean {
    return (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "127.0.0.1" ||
        hostname === "[::1]" ||
        hostname === "::1"
    );
}

export function buildMiniAppUrl(requestUrl: URL, shareId: string): string {
    const url = new URL("/app", requestUrl.origin);

    if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
        // Development reverse proxies and tunnels commonly forward the request to
        // Wrangler over HTTP even though the public endpoint is HTTPS.
        url.protocol = "https:";
    }

    if (url.protocol !== "https:") {
        throw new Error(
            "无法根据当前请求域名生成 Telegram 可用的公开 HTTPS Mini App 地址。",
        );
    }

    url.searchParams.set("id", shareId);
    return url.toString();
}
