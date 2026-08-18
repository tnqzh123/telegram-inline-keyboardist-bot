import { describe, expect, it } from "vitest";
import { Bot, type Update } from "node-telegram-bot-api";
import { registerStartHandler } from "../src/index";

describe("the /start command", () => {
    it("sends one welcome message and does not fall through to normal message handling", async () => {
        const requests: string[] = [];
        const bodies: URLSearchParams[] = [];
        const fetchStub: typeof fetch = async (input, init) => {
            requests.push(String(input));
            bodies.push(new URLSearchParams(String(init?.body ?? "")));
            return new Response(JSON.stringify({ ok: true, result: true }), {
                headers: { "content-type": "application/json" },
            });
        };
        const bot = new Bot("123:test-token", { fetch: fetchStub });
        let normalMessageHandled = false;
        registerStartHandler(bot);
        bot.on("message", async () => {
            normalMessageHandled = true;
        });

        await bot.handleUpdate({
            update_id: 1,
            message: {
                message_id: 1,
                date: 1,
                chat: { id: 42, type: "private", first_name: "Test" },
                text: "/start welcome",
            },
        } satisfies Update);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.endsWith("/sendMessage")).toBe(true);
        expect(bodies[0]?.get("parse_mode")).toBe("HTML");
        expect(bodies[0]?.get("text")).toContain("<b>你好，我是 Inline Keyboardist</b>");
        expect(normalMessageHandled).toBe(false);
    });
});
