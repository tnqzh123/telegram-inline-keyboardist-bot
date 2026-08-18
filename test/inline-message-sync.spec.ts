import { describe, expect, it, vi } from "vitest";
import {
    editInlineMessageContent,
    editInlineMessageKeyboard,
    syncInlineMessages,
} from "../src/inline-message-sync";

function editorApi() {
    return {
        editMessageText: vi.fn(async () => true),
        editMessageCaption: vi.fn(async () => true),
        editMessageMedia: vi.fn(async () => true),
        editMessageReplyMarkup: vi.fn(async () => true),
    };
}

const replyMarkup = {
    inline_keyboard: [[{ text: "Docs", url: "https://example.com" }]],
};

describe("recorded inline-message synchronization", () => {
    it("edits text through inline_message_id and explicitly preserves its keyboard", async () => {
        const api = editorApi();
        await editInlineMessageContent(
            api,
            "inline-1",
            {
                type: "text",
                text: "updated",
                entities: [{ type: "bold", offset: 0, length: 7 }],
            },
            replyMarkup,
        );

        expect(api.editMessageText).toHaveBeenCalledWith({
            inline_message_id: "inline-1",
            text: "updated",
            entities: [{ type: "bold", offset: 0, length: 7 }],
            link_preview_options: undefined,
            reply_markup: replyMarkup,
        });
    });

    it("reuses Telegram file_id when editing inline media", async () => {
        const api = editorApi();
        await editInlineMessageContent(
            api,
            "inline-photo",
            {
                type: "photo",
                fileId: "telegram-file-id",
                caption: "updated caption",
            },
            replyMarkup,
        );

        expect(api.editMessageMedia).toHaveBeenCalledWith({
            inline_message_id: "inline-photo",
            media: {
                type: "photo",
                media: "telegram-file-id",
                caption: "updated caption",
                has_spoiler: undefined,
            },
            reply_markup: replyMarkup,
        });
    });

    it("preserves the keyboard when editing a voice caption", async () => {
        const api = editorApi();
        await editInlineMessageContent(
            api,
            "inline-voice",
            { type: "voice", fileId: "voice-id", duration: 3, caption: "updated" },
            replyMarkup,
        );

        expect(api.editMessageCaption).toHaveBeenCalledWith({
            inline_message_id: "inline-voice",
            caption: "updated",
            caption_entities: undefined,
            reply_markup: replyMarkup,
        });
    });

    it("serializes and updates the saved keyboard for an inline copy", async () => {
        const api = editorApi();
        await editInlineMessageKeyboard(
            api,
            "inline-keyboard",
            [[{ type: "send_to", text: "Send to ...", style: "primary" }]],
            "1234567890123456789012",
        );

        expect(api.editMessageReplyMarkup).toHaveBeenCalledWith({
            inline_message_id: "inline-keyboard",
            reply_markup: {
                inline_keyboard: [[{
                    text: "Send to ...",
                    switch_inline_query: "1234567890123456789012",
                    style: "primary",
                }]],
            },
        });
    });

    it("uses batches of six and isolates failed Telegram requests", async () => {
        const ids = Array.from({ length: 14 }, (_, index) => `inline-${index}`);
        let active = 0;
        let maxActive = 0;
        const failures: Array<[string, unknown]> = [];

        const result = await syncInlineMessages(
            ids,
            async (id) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await Promise.resolve();
                active -= 1;
                if (id === "inline-4" || id === "inline-12") {
                    throw new Error(`failed ${id}`);
                }
            },
            (id, error) => failures.push([id, error]),
        );

        expect(maxActive).toBe(6);
        expect(result).toEqual({ attempted: 14, succeeded: 12, failed: 2 });
        expect(failures.map(([id]) => id)).toEqual(["inline-4", "inline-12"]);
    });
});
