import type { Message, MessageEntity } from "node-telegram-bot-api";

type CaptionSnapshot = {
    caption?: string;
    captionEntities?: MessageEntity[];
    showCaptionAboveMedia?: boolean;
    hasMediaSpoiler?: boolean;
};

export type MessageSnapshot =
    | {
            type: "text";
            text: string;
            entities?: MessageEntity[];
            linkPreviewOptions?: Message["link_preview_options"];
      }
    | ({ type: "photo"; fileId: string } & CaptionSnapshot)
    | ({
            type: "video";
            fileId: string;
            width: number;
            height: number;
            duration: number;
            fileName?: string;
      } & CaptionSnapshot)
    | ({
            type: "animation";
            fileId: string;
            width: number;
            height: number;
            duration: number;
            fileName?: string;
            mimeType?: string;
      } & CaptionSnapshot)
    | ({
            type: "audio";
            fileId: string;
            duration: number;
            performer?: string;
            title?: string;
            fileName?: string;
      } & CaptionSnapshot)
    | ({ type: "voice"; fileId: string; duration: number } & CaptionSnapshot)
    | ({
            type: "document";
            fileId: string;
            fileName?: string;
            mimeType?: string;
      } & CaptionSnapshot)
    | { type: "sticker"; fileId: string; emoji?: string; setName?: string }
    | {
            type: "contact";
            phoneNumber: string;
            firstName: string;
            lastName?: string;
            vcard?: string;
      }
    | {
            type: "location";
            latitude: number;
            longitude: number;
            horizontalAccuracy?: number;
      }
    | {
            type: "venue";
            latitude: number;
            longitude: number;
            title: string;
            address: string;
            foursquareId?: string;
            foursquareType?: string;
            googlePlaceId?: string;
            googlePlaceType?: string;
      };

export type SnapshotResult =
    | { ok: true; snapshot: MessageSnapshot }
    | { ok: false; reason: "live_location" | "media_group" | "unsupported" };

function captionOf(message: Message): CaptionSnapshot {
    return {
        ...(message.caption !== undefined && { caption: message.caption }),
        ...(message.caption_entities && { captionEntities: message.caption_entities }),
        ...(message.show_caption_above_media && { showCaptionAboveMedia: true }),
        ...(message.has_media_spoiler && { hasMediaSpoiler: true }),
    };
}

export function snapshotMessage(message: Message): SnapshotResult {
    if (message.location?.live_period !== undefined) {
        return { ok: false, reason: "live_location" };
    }
    if (message.media_group_id) {
        return { ok: false, reason: "media_group" };
    }
    if (message.text !== undefined) {
        return {
            ok: true,
            snapshot: {
                type: "text",
                text: message.text,
                ...(message.entities && { entities: message.entities }),
                ...(message.link_preview_options && {
                    linkPreviewOptions: message.link_preview_options,
                }),
            },
        };
    }
    if (message.photo?.length) {
        return {
            ok: true,
            snapshot: {
                type: "photo",
                fileId: message.photo.at(-1)!.file_id,
                ...captionOf(message),
            },
        };
    }
    if (message.video) {
        return {
            ok: true,
            snapshot: {
                type: "video",
                fileId: message.video.file_id,
                width: message.video.width,
                height: message.video.height,
                duration: message.video.duration,
                ...(message.video.file_name && { fileName: message.video.file_name }),
                ...captionOf(message),
            },
        };
    }
    if (message.animation) {
        return {
            ok: true,
            snapshot: {
                type: "animation",
                fileId: message.animation.file_id,
                width: message.animation.width,
                height: message.animation.height,
                duration: message.animation.duration,
                ...(message.animation.file_name && { fileName: message.animation.file_name }),
                ...(message.animation.mime_type && { mimeType: message.animation.mime_type }),
                ...captionOf(message),
            },
        };
    }
    if (message.audio) {
        return {
            ok: true,
            snapshot: {
                type: "audio",
                fileId: message.audio.file_id,
                duration: message.audio.duration,
                ...(message.audio.performer && { performer: message.audio.performer }),
                ...(message.audio.title && { title: message.audio.title }),
                ...(message.audio.file_name && { fileName: message.audio.file_name }),
                ...captionOf(message),
            },
        };
    }
    if (message.voice) {
        return {
            ok: true,
            snapshot: {
                type: "voice",
                fileId: message.voice.file_id,
                duration: message.voice.duration,
                ...captionOf(message),
            },
        };
    }
    if (message.document) {
        return {
            ok: true,
            snapshot: {
                type: "document",
                fileId: message.document.file_id,
                ...(message.document.file_name && { fileName: message.document.file_name }),
                ...(message.document.mime_type && { mimeType: message.document.mime_type }),
                ...captionOf(message),
            },
        };
    }
    if (message.sticker) {
        return {
            ok: true,
            snapshot: {
                type: "sticker",
                fileId: message.sticker.file_id,
                ...(message.sticker.emoji && { emoji: message.sticker.emoji }),
                ...(message.sticker.set_name && { setName: message.sticker.set_name }),
            },
        };
    }
    if (message.contact) {
        return {
            ok: true,
            snapshot: {
                type: "contact",
                phoneNumber: message.contact.phone_number,
                firstName: message.contact.first_name,
                ...(message.contact.last_name && { lastName: message.contact.last_name }),
                ...(message.contact.vcard && { vcard: message.contact.vcard }),
            },
        };
    }
    if (message.venue) {
        return {
            ok: true,
            snapshot: {
                type: "venue",
                latitude: message.venue.location.latitude,
                longitude: message.venue.location.longitude,
                title: message.venue.title,
                address: message.venue.address,
                ...(message.venue.foursquare_id && { foursquareId: message.venue.foursquare_id }),
                ...(message.venue.foursquare_type && {
                    foursquareType: message.venue.foursquare_type,
                }),
                ...(message.venue.google_place_id && { googlePlaceId: message.venue.google_place_id }),
                ...(message.venue.google_place_type && {
                    googlePlaceType: message.venue.google_place_type,
                }),
            },
        };
    }
    if (message.location) {
        return {
            ok: true,
            snapshot: {
                type: "location",
                latitude: message.location.latitude,
                longitude: message.location.longitude,
                ...(message.location.horizontal_accuracy !== undefined && {
                    horizontalAccuracy: message.location.horizontal_accuracy,
                }),
            },
        };
    }

    return { ok: false, reason: "unsupported" };
}

export function messageSummary(snapshot: MessageSnapshot): string {
    const caption = "caption" in snapshot ? snapshot.caption?.trim() : undefined;
    switch (snapshot.type) {
        case "text":
            return snapshot.text.trim().slice(0, 180) || "文本消息";
        case "photo":
            return caption || "图片";
        case "video":
            return caption || snapshot.fileName || "视频";
        case "animation":
            return caption || snapshot.fileName || "动画";
        case "audio":
            return caption || [snapshot.performer, snapshot.title].filter(Boolean).join(" — ") || snapshot.fileName || "音频";
        case "voice":
            return caption || `语音 · ${snapshot.duration} 秒`;
        case "document":
            return caption || snapshot.fileName || "文件";
        case "sticker":
            return [snapshot.emoji, "贴纸"].filter(Boolean).join(" ");
        case "contact":
            return `${snapshot.firstName}${snapshot.lastName ? ` ${snapshot.lastName}` : ""} · ${snapshot.phoneNumber}`;
        case "location":
            return `位置 · ${snapshot.latitude.toFixed(5)}, ${snapshot.longitude.toFixed(5)}`;
        case "venue":
            return `${snapshot.title} · ${snapshot.address}`;
    }
}

export function messageTypeLabel(snapshot: MessageSnapshot): string {
    const labels: Record<MessageSnapshot["type"], string> = {
        text: "文本",
        photo: "图片",
        video: "视频",
        animation: "动画",
        audio: "音频",
        voice: "语音",
        document: "文件",
        sticker: "贴纸",
        contact: "联系人",
        location: "位置",
        venue: "地点",
    };
    return labels[snapshot.type];
}
