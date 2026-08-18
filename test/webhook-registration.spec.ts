import { describe, expect, it, vi } from "vitest";
import type { Api } from "node-telegram-bot-api";
import { handleWebhookRegistration } from "../src/index";

const SECRET = "operator_webhook-secret_123";

function environment(secret = SECRET): Env {
    return { WEBHOOK_SECRET_TOKEN: secret } as Env;
}

function registrar() {
    const setWebhook = vi.fn(async (): Promise<true> => true);
    return {
        api: { setWebhook } as unknown as Pick<Api, "setWebhook">,
        setWebhook,
    };
}

describe("GET /api/webhook/register", () => {
    it("registers the current HTTPS origin with the expected secret and updates", async () => {
        const address = `https://bot.example.com/api/webhook/register?secret_token=${SECRET}`;
        const { api, setWebhook } = registrar();
        const response = await handleWebhookRegistration(
            new Request(address),
            environment(),
            new URL(address),
            api,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(setWebhook).toHaveBeenCalledOnce();
        expect(setWebhook).toHaveBeenCalledWith({
            url: "https://bot.example.com/update",
            secret_token: SECRET,
            allowed_updates: [
                "message",
                "edited_message",
                "inline_query",
                "chosen_inline_result",
            ],
        });
        const body = await response.text();
        expect(body).not.toContain(SECRET);
    });

    it("rejects a missing or incorrect operator secret without calling Telegram", async () => {
        for (const query of ["", "?secret_token=incorrect"]) {
            const address = `https://bot.example.com/api/webhook/register${query}`;
            const { api, setWebhook } = registrar();
            const response = await handleWebhookRegistration(
                new Request(address),
                environment(),
                new URL(address),
                api,
            );

            expect(response.status).toBe(401);
            expect(setWebhook).not.toHaveBeenCalled();
        }
    });

    it("refuses non-GET requests and non-HTTPS webhook origins", async () => {
        const { api, setWebhook } = registrar();
        const postAddress = `https://bot.example.com/api/webhook/register?secret_token=${SECRET}`;
        const postResponse = await handleWebhookRegistration(
            new Request(postAddress, { method: "POST" }),
            environment(),
            new URL(postAddress),
            api,
        );
        expect(postResponse.status).toBe(405);

        const httpAddress = `http://localhost/api/webhook/register?secret_token=${SECRET}`;
        const httpResponse = await handleWebhookRegistration(
            new Request(httpAddress),
            environment(),
            new URL(httpAddress),
            api,
        );
        expect(httpResponse.status).toBe(422);
        expect(setWebhook).not.toHaveBeenCalled();
    });

    it("returns a gateway error when Telegram rejects registration", async () => {
        const address = `https://bot.example.com/api/webhook/register?secret_token=${SECRET}`;
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const setWebhook = vi.fn(async (): Promise<true> => {
            throw new Error("Telegram unavailable");
        });
        const response = await handleWebhookRegistration(
            new Request(address),
            environment(),
            new URL(address),
            { setWebhook } as unknown as Pick<Api, "setWebhook">,
        );

        expect(response.status).toBe(502);
        expect(setWebhook).toHaveBeenCalledOnce();
        expect(errorLog).toHaveBeenCalledOnce();
        errorLog.mockRestore();
    });
});
