import { describe, expect, it } from "vitest";
import { buildMiniAppUrl } from "../src/public-url";

describe("Mini App public URL", () => {
    it("upgrades a public HTTP request origin to HTTPS", () => {
        expect(
            buildMiniAppUrl(
                new URL("http://dev.honoka.cafe/update"),
                "EiMc01B2toHaGzxSgcc0Tk",
            ),
        ).toBe(
            "https://dev.honoka.cafe/app?id=EiMc01B2toHaGzxSgcc0Tk",
        );
    });

    it("always derives the editor path from the current request origin", () => {
        expect(
            buildMiniAppUrl(
                new URL("https://bot.example.com/update?ignored=yes"),
                "1234567890123456789012",
            ),
        ).toBe(
            "https://bot.example.com/app?id=1234567890123456789012",
        );
    });

    it("rejects a local HTTP request origin", () => {
        expect(() =>
            buildMiniAppUrl(
                new URL("http://127.0.0.1:8787/update"),
                "1234567890123456789012",
            ),
        ).toThrow("当前请求域名");
    });
});
