import { describe, expect, it } from "vitest";
import {
    sanitizeSourceKeyboard,
    toTelegramKeyboard,
    validateEditorKeyboard,
} from "../src/domain/keyboard";

describe("Inline Keyboard domain", () => {
    it("imports only URL and Copy Text buttons and keeps official styles", () => {
        const result = sanitizeSourceKeyboard({
            inline_keyboard: [
                [
                    { text: "Docs", url: "https://core.telegram.org", style: "primary" },
                    { text: "Copy", copy_text: { text: "hello" }, style: "success" },
                    { text: "Callback", callback_data: "not-supported" },
                ],
                [
                    {
                        text: "Icon URL",
                        url: "tg://resolve?domain=telegram",
                        icon_custom_emoji_id: "123",
                    },
                    { text: "Original send", switch_inline_query: "must-not-copy" },
                ],
            ],
        });

        expect(result.keyboard).toEqual([
            [
                { type: "url", text: "Docs", url: "https://core.telegram.org", style: "primary" },
                { type: "copy_text", text: "Copy", copyText: "hello", style: "success" },
            ],
            [{ type: "url", text: "Icon URL", url: "tg://resolve?domain=telegram" }],
        ]);
        expect(result.droppedCount).toBe(2);
        expect(result.strippedIconCount).toBe(1);
    });

    it("rejects a keyboard without buttons and enforces the per-row limit", () => {
        expect(validateEditorKeyboard([]).ok).toBe(false);
        expect(validateEditorKeyboard([[]]).ok).toBe(false);
        const row = Array.from({ length: 13 }, (_, index) => ({
            type: "url",
            text: `Button ${index}`,
            url: "https://example.com",
        }));
        expect(validateEditorKeyboard([row]).ok).toBe(false);
    });

    it("filters empty rows around populated rows", () => {
        const result = validateEditorKeyboard([
            [],
            [{ type: "url", text: "Docs", url: "https://core.telegram.org" }],
            [],
        ]);

        expect(result).toEqual({
            ok: true,
            keyboard: [
                [{ type: "url", text: "Docs", url: "https://core.telegram.org" }],
            ],
        });
    });

    it("rejects unsafe URL schemes", () => {
        const result = validateEditorKeyboard([
            [{ type: "url", text: "Unsafe", url: "javascript:alert(1)" }],
        ]);
        expect(result.ok).toBe(false);
    });

    it("serializes editor Send to with the raw share id", () => {
        const shareId = "1234567890123456789012";
        const markup = toTelegramKeyboard(
            [[{ type: "send_to", text: "Send to", style: "danger" }]],
            shareId,
        );
        expect(markup.inline_keyboard[0][0]).toEqual({
            text: "Send to",
            switch_inline_query: shareId,
            style: "danger",
        });
    });
});
