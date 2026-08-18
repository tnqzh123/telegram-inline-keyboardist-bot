import type {
    InlineKeyboardMarkup,
    InlineQueryResult,
    InputMedia,
} from "node-telegram-bot-api";
import type { EditorKeyboard } from "./domain/keyboard";
import { messageSummary, type MessageSnapshot } from "./domain/message";
import { toTelegramKeyboard } from "./domain/keyboard";

export const START_MESSAGE = [
    "<b>你好，我是 Inline Keyboardist</b>。我可以帮助你可视化编辑、保存和分享 Telegram 消息的 Inline Keyboard。",
    "把想添加 Inline Keyboard 的消息直接发给我即可。",
    [
        "<b>使用方法</b>：",
        "1. 发送一条文本，或一条带 Caption 的媒体消息。",
        "2. 我会原样复制它，并在下方发送一条控制消息。",
        "3. 点击「打开键盘编辑器」，即可可视化编辑 Inline Keyboard。",
        "4. 保存键盘后，控制消息下方即会出现「Send to ...」按钮，点击即可将设置好 Inline Keyboard 的消息分享到其他聊天。",
        "5. 如果需要更新消息，直接编辑原消息即可，我会自动同步更新到复制消息和已对外发送的副本。",
    ].join("\n"),
    [
        "<b>注意事项</b>：",
        "• 每行最多 12 个按钮，总共最多 300 个按钮。",
        "• 支持文本、图片、视频、动画、音频、语音、文件、贴纸、联系人、静态位置和地点。",
        "• 不支持媒体组和实时位置：媒体组会被拆分成多条媒体消息；实时位置会被直接删除，以免持续产生位置更新。",
        "• 仅支持设置 URL 和 Copy Text 按钮；原消息附带的键盘也只导入这两种按钮，其他按钮会被移除并提示。",
    ].join("\n"),
    "媒体文件不会被下载或保存，我只记录 Telegram 提供的 <code>file_id</code>。",
].join("\n\n");

function captionFields(snapshot: Extract<MessageSnapshot, { caption?: string }>) {
    return {
        ...(snapshot.caption !== undefined && { caption: snapshot.caption }),
        ...(snapshot.captionEntities && { caption_entities: snapshot.captionEntities }),
        ...(snapshot.showCaptionAboveMedia && { show_caption_above_media: true }),
    };
}

export function inputMediaFromSnapshot(snapshot: MessageSnapshot): InputMedia | null {
    const caption = "caption" in snapshot ? captionFields(snapshot) : {};
    switch (snapshot.type) {
        case "photo":
            return {
                type: "photo",
                media: snapshot.fileId,
                has_spoiler: snapshot.hasMediaSpoiler,
                ...caption,
            };
        case "video":
            return {
                type: "video",
                media: snapshot.fileId,
                width: snapshot.width,
                height: snapshot.height,
                duration: snapshot.duration,
                has_spoiler: snapshot.hasMediaSpoiler,
                ...caption,
            };
        case "animation":
            return {
                type: "animation",
                media: snapshot.fileId,
                width: snapshot.width,
                height: snapshot.height,
                duration: snapshot.duration,
                has_spoiler: snapshot.hasMediaSpoiler,
                ...caption,
            };
        case "audio":
            return {
                type: "audio",
                media: snapshot.fileId,
                duration: snapshot.duration,
                performer: snapshot.performer,
                title: snapshot.title,
                ...caption,
            };
        case "document":
            return { type: "document", media: snapshot.fileId, ...caption };
        default:
            return null;
    }
}

export function inlineResultFromSnapshot(
    snapshot: MessageSnapshot,
    keyboard: EditorKeyboard,
    shareId: string,
): InlineQueryResult {
    const reply_markup = toTelegramKeyboard(keyboard, shareId);
    const base = { id: shareId, reply_markup };
    const caption = "caption" in snapshot ? captionFields(snapshot) : {};

    switch (snapshot.type) {
        case "text":
            return {
                ...base,
                type: "article",
                title: "发送这条消息",
                description: messageSummary(snapshot),
                input_message_content: {
                    message_text: snapshot.text,
                    entities: snapshot.entities,
                    link_preview_options: snapshot.linkPreviewOptions,
                },
            };
        case "photo":
            return {
                ...base,
                type: "photo",
                photo_file_id: snapshot.fileId,
                title: "发送这张图片",
                description: messageSummary(snapshot),
                show_caption_above_media: snapshot.showCaptionAboveMedia,
                ...caption,
            };
        case "video":
            return {
                ...base,
                type: "video",
                video_file_id: snapshot.fileId,
                title: snapshot.fileName || "发送这个视频",
                description: messageSummary(snapshot),
                show_caption_above_media: snapshot.showCaptionAboveMedia,
                ...caption,
            };
        case "animation":
            return snapshot.mimeType === "video/mp4"
                ? {
                        ...base,
                        type: "mpeg4_gif",
                        mpeg4_file_id: snapshot.fileId,
                        show_caption_above_media: snapshot.showCaptionAboveMedia,
                        ...caption,
                        // Telegram clients don't display a title or description for MP4 animations.
                    }
                : {
                        ...base,
                        type: "gif",
                        gif_file_id: snapshot.fileId,
                        show_caption_above_media: snapshot.showCaptionAboveMedia,
                        ...caption,
                        // Telegram clients don't display a title or description for GIF animations.
                    };
        case "audio":
            /*
                Only MP3 audio is supported in InlineQueryResultCachedAudio,
                so here we send all audio as a document (InlineResultCachedDocument),
                which can still be parsed and played as audio in Telegram clients. 
            */
            return {
                ...base,
                type: "document",
                document_file_id: snapshot.fileId,
                title: snapshot.title || "发送这段音频",
                description: messageSummary(snapshot),
                ...caption,
            };
        case "voice":
            return {
                ...base,
                type: "voice",
                voice_file_id: snapshot.fileId,
                title: "发送这段语音",
                // Telegram clients don't display a description for voice messages.
                ...caption,
            };
        case "document":
            return {
                ...base,
                type: "document",
                document_file_id: snapshot.fileId,
                title: snapshot.fileName || "发送这个文件",
                description: messageSummary(snapshot),
                ...caption,
            };
        case "sticker":
            return {
                ...base,
                type: "sticker",
                sticker_file_id: snapshot.fileId,
                // Telegram clients don't display a title or description for stickers.
            };
        case "contact":
            return {
                ...base,
                type: "contact",
                phone_number: snapshot.phoneNumber,
                first_name: snapshot.firstName,
                last_name: snapshot.lastName,
                vcard: snapshot.vcard,
                // Telegram clients will always display the contact's name and phone number instead of a title or description.
            };
        case "location":
            return {
                ...base,
                type: "location",
                latitude: snapshot.latitude,
                longitude: snapshot.longitude,
                horizontal_accuracy: snapshot.horizontalAccuracy,
                title: "发送这个位置",
                // Telegram clients will always display the coordinates instead of a description.
            };
        case "venue":
            return {
                ...base,
                type: "venue",
                latitude: snapshot.latitude,
                longitude: snapshot.longitude,
                title: snapshot.title,
                address: snapshot.address,
                foursquare_id: snapshot.foursquareId,
                foursquare_type: snapshot.foursquareType,
                google_place_id: snapshot.googlePlaceId,
                google_place_type: snapshot.googlePlaceType,
                // Telegram clients will always display the venue's title and address instead of a title or description.
            };
    }
}

export function controlKeyboard(
    miniAppUrl: string,
    shareId: string,
    canShare: boolean,
): InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                {
                    text: "打开键盘编辑器",
                    web_app: { url: miniAppUrl },
                    style: "primary",
                },
            ],
            ...(canShare
                ? [[{ text: "Send to ...", switch_inline_query: shareId, style: "success" }]]
                : []),
        ],
    };
}

export function controlText(options: {
    droppedCount: number;
    strippedIconCount: number;
}): string {
    const lines = [
        "已复制消息，点击下面的按钮即可打开键盘编辑器，添加至少一个按钮后即可对外发送。",
    ];
    if (options.droppedCount) {
        lines.push(`原键盘中有 ${options.droppedCount} 个不支持的按钮，复制时已移除。`);
    }
    if (options.strippedIconCount) {
        lines.push(`原键盘中有 ${options.strippedIconCount} 个自定义 Emoji 图标，复制时保留按钮但移除了图标。`);
    }
    return lines.join("\n\n");
}
