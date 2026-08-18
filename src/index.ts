import { and, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import {
    Bot,
    webhookCallback,
    type Api,
    type ChosenInlineResult,
    type Message,
    type UpdateType,
} from "node-telegram-bot-api";
import { inlineMessages, messages } from "./db/schema";
import {
    editInlineMessageContent,
    editInlineMessageKeyboard,
    syncInlineMessages,
} from "./inline-message-sync";
import {
    controlKeyboard,
    controlText,
    inlineResultFromSnapshot,
    inputMediaFromSnapshot,
    START_MESSAGE,
} from "./telegram-message";
import {
    sanitizeSourceKeyboard,
    toTelegramKeyboard,
    validateEditorKeyboard,
} from "./domain/keyboard";
import {
    messageSummary,
    messageTypeLabel,
    snapshotMessage,
} from "./domain/message";
import { validateTelegramInitData } from "./mini-app-auth";
import { buildMiniAppUrl } from "./public-url";

const WEBHOOK_PATH = "/update";
const WEBHOOK_REGISTRATION_PATH = "/api/webhook/register";
const WEBHOOK_SECRET_QUERY_PARAM = "secret_token";
const WEBHOOK_ALLOWED_UPDATES: UpdateType[] = [
    "message",
    "edited_message",
    "inline_query",
    "chosen_inline_result",
];
const API_MESSAGE_PREFIX = "/api/messages/";
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_API_BODY_BYTES = 256 * 1024;

type Database = DrizzleD1Database<Record<string, never>>;
type MessageRecord = typeof messages.$inferSelect;

function createBot(env: Env): Bot {
    return new Bot(env.BOT_TOKEN, {
        fetch: (input, init) => globalThis.fetch(input, init),
        apiRoot: env.API_ROOT,
    });
}

function json(data: unknown, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("cache-control", "no-store");
    return new Response(JSON.stringify(data), { ...init, headers });
}

function errorResponse(status: number, error: string): Response {
    return json({ error }, { status });
}

function timingSafeEqual(left: string, right: string): boolean {
    const length = Math.max(left.length, right.length);
    let difference = left.length ^ right.length;
    for (let index = 0; index < length; index += 1) {
        difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
    }
    return difference === 0;
}

export async function handleWebhookRegistration(
    request: Request,
    env: Env,
    url: URL,
    api?: Pick<Api, "setWebhook">,
): Promise<Response> {
    if (request.method !== "GET") {
        return json(
            { error: "只支持 GET 请求。" },
            { status: 405, headers: { allow: "GET" } },
        );
    }

    if (!WEBHOOK_SECRET_PATTERN.test(env.WEBHOOK_SECRET_TOKEN)) {
        console.error("WEBHOOK_SECRET_TOKEN is missing or invalid");
        return errorResponse(500, "Webhook Secret Token 尚未正确配置。");
    }

    const providedSecret = url.searchParams.get(WEBHOOK_SECRET_QUERY_PARAM) ?? "";
    if (!timingSafeEqual(providedSecret, env.WEBHOOK_SECRET_TOKEN)) {
        return errorResponse(401, "Webhook Secret Token 无效。");
    }

    const webhookUrl = new URL(WEBHOOK_PATH, url.origin);
    if (webhookUrl.protocol !== "https:") {
        return errorResponse(422, "Webhook 必须通过公开 HTTPS URL 注册。");
    }

    try {
        const registrar = api ?? createBot(env).api;
        await registrar.setWebhook({
            url: webhookUrl.toString(),
            secret_token: env.WEBHOOK_SECRET_TOKEN,
            allowed_updates: WEBHOOK_ALLOWED_UPDATES,
        });
    } catch {
        console.error("Telegram Webhook registration failed");
        return errorResponse(502, "Telegram Webhook 注册失败。");
    }

    return json({
        ok: true,
        webhookUrl: webhookUrl.toString(),
        allowedUpdates: WEBHOOK_ALLOWED_UPDATES,
    });
}

async function findByShareId(db: Database, shareId: string): Promise<MessageRecord | undefined> {
    const [record] = await db
        .select()
        .from(messages)
        .where(eq(messages.shareId, shareId))
        .limit(1);
    return record;
}

async function findBySourceMessage(
    db: Database,
    chatId: number,
    sourceMessageId: number,
): Promise<MessageRecord | undefined> {
    const [record] = await db
        .select()
        .from(messages)
        .where(
            and(
                eq(messages.chatId, chatId),
                eq(messages.sourceMessageId, sourceMessageId),
            ),
        )
        .limit(1);
    return record;
}

async function findInlineMessageIds(
    db: Database,
    shareId: string,
): Promise<string[]> {
    const records = await db
        .select({ inlineMessageId: inlineMessages.inlineMessageId })
        .from(inlineMessages)
        .where(eq(inlineMessages.shareId, shareId));
    return records.map((record) => record.inlineMessageId);
}

async function syncRecordedInlineMessages(
    db: Database,
    shareId: string,
    update: (inlineMessageId: string) => Promise<unknown>,
) {
    const inlineMessageIds = await findInlineMessageIds(db, shareId);
    return syncInlineMessages(inlineMessageIds, update);
}

async function recordChosenInlineMessage(
    db: Database,
    result: ChosenInlineResult,
): Promise<void> {
    if (
        !result.inline_message_id ||
        !SHARE_ID_PATTERN.test(result.result_id)
    ) {
        return;
    }

    try {
        await db
            .insert(inlineMessages)
            .values({
                shareId: result.result_id,
                inlineMessageId: result.inline_message_id,
            })
            .onConflictDoNothing({
                target: inlineMessages.inlineMessageId,
            });
    } catch (error) {
        // A delayed result can arrive after its source record was removed. The
        // foreign key still prevents an orphaned inline-message record.
        console.error("Could not record a chosen inline message", error);
    }
}

async function authenticateMiniApp(request: Request, env: Env) {
    return validateTelegramInitData(
        request.headers.get("x-telegram-init-data") ?? "",
        env.BOT_TOKEN,
    );
}

async function handleMiniAppApi(
    request: Request,
    env: Env,
    db: Database,
    url: URL,
): Promise<Response> {
    let shareId: string;
    try {
        shareId = decodeURIComponent(url.pathname.slice(API_MESSAGE_PREFIX.length));
    } catch {
        return errorResponse(404, "找不到这条消息。");
    }
    if (!SHARE_ID_PATTERN.test(shareId)) return errorResponse(404, "找不到这条消息。");

    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return errorResponse(401, auth.error);

    const record = await findByShareId(db, shareId);
    if (!record) return errorResponse(404, "找不到这条消息。");
    if (record.chatId !== auth.user.id) {
        return errorResponse(403, "你没有权限编辑这条消息。");
    }

    if (request.method === "GET") {
        return json({
            id: record.shareId,
            message: {
                type: record.messageSnapshot.type,
                typeLabel: messageTypeLabel(record.messageSnapshot),
                summary: messageSummary(record.messageSnapshot),
            },
            keyboard: record.inlineKeyboard,
        });
    }

    if (request.method !== "PUT") {
        return errorResponse(405, "不支持的请求方法。");
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_API_BODY_BYTES) {
        return errorResponse(413, "键盘数据过大。");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return errorResponse(400, "请求内容不是有效的 JSON。");
    }
    const keyboardValue =
        typeof body === "object" && body !== null && "keyboard" in body
            ? (body as { keyboard: unknown }).keyboard
            : undefined;
    const validation = validateEditorKeyboard(keyboardValue);
    if (!validation.ok) return errorResponse(422, validation.error);

    if (JSON.stringify(validation.keyboard) === JSON.stringify(record.inlineKeyboard)) {
        return json({ ok: true, unchanged: true, keyboard: record.inlineKeyboard });
    }

    const bot = createBot(env);
    await bot.api.editMessageReplyMarkup({
        chat_id: record.chatId,
        message_id: record.copiedMessageId,
        reply_markup: toTelegramKeyboard(validation.keyboard, record.shareId),
    });

    if (!record.inlineKeyboard) {
        try {
            await bot.api.editMessageReplyMarkup({
                chat_id: record.chatId,
                message_id: record.controlMessageId,
                reply_markup: controlKeyboard(
                    buildMiniAppUrl(url, record.shareId),
                    record.shareId,
                    true,
                ),
            });
        } catch (error) {
            // The user may have deleted the control message after opening the Mini
            // App. The copied message and D1 snapshot should still be saved.
            console.error("Could not add Send to to the control message", error);
        }
    }

    await db
        .update(messages)
        .set({ inlineKeyboard: validation.keyboard })
        .where(eq(messages.id, record.id));

    const inlineSync = await syncRecordedInlineMessages(
        db,
        record.shareId,
        (inlineMessageId) =>
            editInlineMessageKeyboard(
                bot.api,
                inlineMessageId,
                validation.keyboard,
                record.shareId,
            ),
    );

    return json({
        ok: true,
        unchanged: false,
        keyboard: validation.keyboard,
        inlineSync,
    });
}

async function deleteLiveLocationAndExplain(api: Api, message: Message): Promise<void> {
    try {
        await api.deleteMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
        });
    } catch (error) {
        console.error("Could not delete a live location", error);
    }

    try {
        await api.sendMessage({
            chat_id: message.chat.id,
            text: "已删除你发送的实时位置。本 Bot 仅支持静态位置，请重新发送一个静态位置。",
        });
    } catch (error) {
        console.error("Could not explain the live location policy", error);
    }
}

async function handleNewMessage(
    api: Api,
    db: Database,
    message: Message,
    requestUrl: URL,
): Promise<void> {
    if (message.chat.type !== "private") return;

    const snapshot = snapshotMessage(message);
    if (!snapshot.ok && snapshot.reason === "live_location") {
        await deleteLiveLocationAndExplain(api, message);
        return;
    }
    if (!snapshot.ok) {
        const explanation =
            snapshot.reason === "media_group"
                ? "暂不支持整组媒体相册，请把需要编辑的媒体作为单条消息重新发送。"
                : "暂不支持这种消息。可发送文本、图片、视频、动画、音频、语音、文件、贴纸、联系人、静态位置或地点。";
        await api.sendMessage({
            chat_id: message.chat.id,
            text: explanation,
            reply_parameters: { message_id: message.message_id },
        });
        return;
    }

    const shareId = nanoid(22);
    const editorUrl = buildMiniAppUrl(requestUrl, shareId);
    const sanitized = sanitizeSourceKeyboard(message.reply_markup);
    const copied = await api.copyMessage({
        chat_id: message.chat.id,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
        reply_parameters: { message_id: message.message_id },
        ...(sanitized.keyboard && {
            reply_markup: toTelegramKeyboard(sanitized.keyboard, shareId),
        }),
    });

    const control = await api.sendMessage({
        chat_id: message.chat.id,
        text: controlText(sanitized),
        reply_parameters: { message_id: copied.message_id },
        reply_markup: controlKeyboard(
            editorUrl,
            shareId,
            Boolean(sanitized.keyboard),
        ),
    });

    await db.insert(messages).values({
        shareId,
        chatId: message.chat.id,
        sourceMessageId: message.message_id,
        copiedMessageId: copied.message_id,
        controlMessageId: control.message_id,
        messageSnapshot: snapshot.snapshot,
        inlineKeyboard: sanitized.keyboard,
    });
}

async function syncEditedMessage(api: Api, db: Database, edited: Message): Promise<void> {
    // A deleted live location can still produce queued edits. Do not read D1 or call
    // Telegram for any location edit, so those updates remain effectively free.
    if (edited.location) return;
    if (edited.chat.type !== "private") return;

    const snapshot = snapshotMessage(edited);
    if (!snapshot.ok) return;

    const record = await findBySourceMessage(db, edited.chat.id, edited.message_id);
    if (!record) return;

    const next = snapshot.snapshot;
    const replyMarkup = record.inlineKeyboard
        ? toTelegramKeyboard(record.inlineKeyboard, record.shareId)
        : undefined;
    if (next.type === "text") {
        await api.editMessageText({
            chat_id: record.chatId,
            message_id: record.copiedMessageId,
            text: next.text,
            entities: next.entities,
            link_preview_options: next.linkPreviewOptions,
            ...(replyMarkup && { reply_markup: replyMarkup }),
        });
    } else {
        const media = inputMediaFromSnapshot(next);
        if (media) {
            await api.editMessageMedia({
                chat_id: record.chatId,
                message_id: record.copiedMessageId,
                media,
                ...(replyMarkup && { reply_markup: replyMarkup }),
            });
        } else if (next.type === "voice") {
            await api.editMessageCaption({
                chat_id: record.chatId,
                message_id: record.copiedMessageId,
                caption: next.caption ?? "",
                caption_entities: next.captionEntities,
                ...(replyMarkup && { reply_markup: replyMarkup }),
            });
        } else {
            return;
        }
    }

    await db
        .update(messages)
        .set({ messageSnapshot: next })
        .where(eq(messages.id, record.id));

    if (!replyMarkup) return;
    await syncRecordedInlineMessages(db, record.shareId, (inlineMessageId) =>
        editInlineMessageContent(api, inlineMessageId, next, replyMarkup),
    );
}

export function registerStartHandler(bot: Bot): void {
    bot.command("start", async (ctx) => {
        const message = ctx.message;
        if (!message || message.chat.type !== "private") return;
        await bot.api.sendMessage({
            chat_id: message.chat.id,
            text: START_MESSAGE,
            parse_mode: "HTML",
        });
    });
}

function registerBotHandlers(
    bot: Bot,
    db: Database,
    requestUrl: URL,
): void {
    registerStartHandler(bot);

    bot.on("message", async (ctx) => {
        await handleNewMessage(
            bot.api,
            db,
            ctx.message!,
            requestUrl,
        );
    });

    bot.on("edited_message", async (ctx) => {
        await syncEditedMessage(bot.api, db, ctx.editedMessage!);
    });

    bot.on("inline_query", async (ctx) => {
        const query = ctx.inlineQuery!;
        const shareId = query.query.trim();
        if (!SHARE_ID_PATTERN.test(shareId)) {
            await bot.api.answerInlineQuery({
                inline_query_id: query.id,
                results: [],
                cache_time: 0,
                is_personal: true,
            });
            return;
        }

        const record = await findByShareId(db, shareId);
        const results = record?.inlineKeyboard
            ? [
                    inlineResultFromSnapshot(
                        record.messageSnapshot,
                        record.inlineKeyboard,
                        record.shareId,
                    ),
                ]
            : [];
        await bot.api.answerInlineQuery({
            inline_query_id: query.id,
            results,
            cache_time: 0,
            is_personal: false,
        });
    });

    bot.on("chosen_inline_result", async (ctx) => {
        if (!("chosen_inline_result" in ctx.update)) return;
        await recordChosenInlineMessage(db, ctx.update.chosen_inline_result);
    });

    bot.catch((error) => {
        console.error("Telegram update failed", error);
    });
}

export default {
    async fetch(request, env, ctx): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === WEBHOOK_REGISTRATION_PATH) {
            return handleWebhookRegistration(request, env, url);
        }

        if (url.pathname === "/health") {
            return json({ ok: true });
        }

        const db = drizzle(env.D1);

        if (url.pathname.startsWith(API_MESSAGE_PREFIX)) {
            try {
                return await handleMiniAppApi(request, env, db, url);
            } catch (error) {
                console.error("Mini App API failed", error);
                return errorResponse(502, "保存失败，请稍后重试。");
            }
        }

        if (url.pathname === WEBHOOK_PATH && request.method === "POST") {
            const bot = createBot(env);
            registerBotHandlers(bot, db, url);
            return webhookCallback(bot, {
                secretToken: env.WEBHOOK_SECRET_TOKEN,
                waitUntil: (promise) => ctx.waitUntil(promise),
            })(request);
        }

        return env.ASSETS.fetch(request);
    },
} satisfies ExportedHandler<Env>;
