import { describe, expect, it } from "vitest";
import type { Message } from "node-telegram-bot-api";
import { snapshotMessage } from "../src/domain/message";
import {
    controlKeyboard,
    controlText,
    inlineResultFromSnapshot,
    START_MESSAGE,
} from "../src/telegram-message";

function message(fields: Partial<Message>): Message {
    return {
        message_id: 1,
        date: 1,
        chat: { id: 42, type: "private", first_name: "Test" },
        ...fields,
    };
}

describe("message snapshots", () => {
    it("explains the workflow and important limits in the start message", () => {
        expect(START_MESSAGE).toContain("<b>你好，我是 Inline Keyboardist</b>");
        expect(START_MESSAGE).toContain("<b>使用方法</b>");
        expect(START_MESSAGE).toContain("<b>注意事项</b>");
        expect(START_MESSAGE).toContain("保存");
        expect(START_MESSAGE).toContain("每行最多 12 个按钮");
        expect(START_MESSAGE).toContain("总共最多 300 个按钮");
        expect(START_MESSAGE).toContain("Telegram 提供的 <code>file_id</code>");
        expect(START_MESSAGE).toContain("不支持媒体组和实时位置");
    });

    it("uses the keyboard editor label in the control message", () => {
        const keyboard = controlKeyboard("https://example.com/app", "share-id", false);
        expect(keyboard.inline_keyboard[0]).toEqual([{
            text: "打开键盘编辑器",
            web_app: { url: "https://example.com/app" },
            style: "primary",
        }]);
        expect(controlText({ droppedCount: 0, strippedIconCount: 0 }))
            .toContain("打开键盘编辑器");
    });

    it("uses the ellipsis label for the generated Send to button", () => {
        expect(controlKeyboard("https://example.com/app", "share-id", true).inline_keyboard[1]).toEqual([
            { text: "Send to ...", switch_inline_query: "share-id", style: "success" },
        ]);
    });

    it("rejects live locations but accepts static locations", () => {
        expect(
            snapshotMessage(message({ location: { latitude: 1, longitude: 2, live_period: 60 } })),
        ).toEqual({ ok: false, reason: "live_location" });

        expect(
            snapshotMessage(message({ location: { latitude: 1, longitude: 2 } })),
        ).toEqual({
            ok: true,
            snapshot: { type: "location", latitude: 1, longitude: 2 },
        });
    });

    it("stores only the largest photo file_id and caption metadata", () => {
        const result = snapshotMessage(
            message({
                photo: [
                    { file_id: "small", file_unique_id: "a", width: 90, height: 90 },
                    { file_id: "large", file_unique_id: "b", width: 1280, height: 720 },
                ],
                caption: "caption",
            }),
        );
        expect(result).toEqual({
            ok: true,
            snapshot: { type: "photo", fileId: "large", caption: "caption" },
        });
    });

    it("builds a static location Inline Result", () => {
        const result = inlineResultFromSnapshot(
            { type: "location", latitude: 31.23, longitude: 121.47 },
            [[{ type: "url", text: "Map", url: "https://example.com" }]],
            "1234567890123456789012",
        );
        expect(result).toMatchObject({
            type: "location",
            latitude: 31.23,
            longitude: 121.47,
            title: "发送这个位置",
        });
        expect(result).not.toHaveProperty("live_period");
    });
});
