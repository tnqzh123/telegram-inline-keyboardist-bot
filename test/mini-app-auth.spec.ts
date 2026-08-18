import { describe, expect, it } from "vitest";
import { validateTelegramInitData } from "../src/mini-app-auth";

async function sign(params: URLSearchParams, botToken: string): Promise<string> {
    const encoder = new TextEncoder();
    const webAppKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode("WebAppData"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const secret = await crypto.subtle.sign("HMAC", webAppKey, encoder.encode(botToken));
    const secretKey = await crypto.subtle.importKey(
        "raw",
        secret,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const checkString = [...params.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
    const signature = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(checkString));
    return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Telegram Mini App initData validation", () => {
    it("validates signature, age and user id", async () => {
        const botToken = "123:secret";
        const now = 1_800_000_000;
        const params = new URLSearchParams({
            auth_date: String(now - 10),
            query_id: "query",
            user: JSON.stringify({ id: 42, first_name: "Test" }),
        });
        params.set("hash", await sign(params, botToken));

        await expect(
            validateTelegramInitData(params.toString(), botToken, { nowSeconds: now }),
        ).resolves.toEqual({
            ok: true,
            authDate: now - 10,
            user: { id: 42, first_name: "Test" },
        });
    });

    it("rejects tampering and stale sessions", async () => {
        const botToken = "123:secret";
        const now = 1_800_000_000;
        const params = new URLSearchParams({
            auth_date: String(now - 100_000),
            user: JSON.stringify({ id: 42 }),
        });
        params.set("hash", await sign(params, botToken));
        const stale = await validateTelegramInitData(params.toString(), botToken, { nowSeconds: now });
        expect(stale.ok).toBe(false);

        params.set("user", JSON.stringify({ id: 43 }));
        const tampered = await validateTelegramInitData(params.toString(), botToken, { nowSeconds: now });
        expect(tampered.ok).toBe(false);
    });
});
