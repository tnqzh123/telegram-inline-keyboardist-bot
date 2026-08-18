import type { Api, InlineKeyboardMarkup } from "node-telegram-bot-api";
import type { EditorKeyboard } from "./domain/keyboard";
import { toTelegramKeyboard } from "./domain/keyboard";
import type { MessageSnapshot } from "./domain/message";
import { inputMediaFromSnapshot } from "./telegram-message";

const MAX_CONCURRENT_TELEGRAM_REQUESTS = 6;

export type InlineMessageSyncResult = {
    attempted: number;
    succeeded: number;
    failed: number;
};

type InlineMessageEditor = Pick<
    Api,
    | "editMessageText"
    | "editMessageCaption"
    | "editMessageMedia"
    | "editMessageReplyMarkup"
>;

type FailureReporter = (inlineMessageId: string, error: unknown) => void;

export async function editInlineMessageContent(
    api: InlineMessageEditor,
    inlineMessageId: string,
    snapshot: MessageSnapshot,
    replyMarkup: InlineKeyboardMarkup,
): Promise<boolean> {
    if (snapshot.type === "text") {
        await api.editMessageText({
            inline_message_id: inlineMessageId,
            text: snapshot.text,
            entities: snapshot.entities,
            link_preview_options: snapshot.linkPreviewOptions,
            reply_markup: replyMarkup,
        });
        return true;
    }

    const media = inputMediaFromSnapshot(snapshot);
    if (media) {
        await api.editMessageMedia({
            inline_message_id: inlineMessageId,
            media,
            reply_markup: replyMarkup,
        });
        return true;
    }

    if (snapshot.type === "voice") {
        await api.editMessageCaption({
            inline_message_id: inlineMessageId,
            caption: snapshot.caption ?? "",
            caption_entities: snapshot.captionEntities,
            reply_markup: replyMarkup,
        });
        return true;
    }

    return false;
}

export async function editInlineMessageKeyboard(
    api: InlineMessageEditor,
    inlineMessageId: string,
    keyboard: EditorKeyboard,
    shareId: string,
): Promise<void> {
    await api.editMessageReplyMarkup({
        inline_message_id: inlineMessageId,
        reply_markup: toTelegramKeyboard(keyboard, shareId),
    });
}

export async function syncInlineMessages(
    inlineMessageIds: readonly string[],
    update: (inlineMessageId: string) => Promise<unknown>,
    reportFailure: FailureReporter = (inlineMessageId, error) => {
        console.error(`Could not update inline message ${inlineMessageId}`, error);
    },
): Promise<InlineMessageSyncResult> {
    let succeeded = 0;
    let failed = 0;

    for (
        let offset = 0;
        offset < inlineMessageIds.length;
        offset += MAX_CONCURRENT_TELEGRAM_REQUESTS
    ) {
        const batch = inlineMessageIds.slice(
            offset,
            offset + MAX_CONCURRENT_TELEGRAM_REQUESTS,
        );
        const results = await Promise.allSettled(batch.map(update));
        for (const [index, result] of results.entries()) {
            if (result.status === "fulfilled") {
                succeeded += 1;
            } else {
                failed += 1;
                reportFailure(batch[index]!, result.reason);
            }
        }
    }

    return {
        attempted: inlineMessageIds.length,
        succeeded,
        failed,
    };
}
