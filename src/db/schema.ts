import {
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { EditorKeyboard } from "../domain/keyboard";
import type { MessageSnapshot } from "../domain/message";

export const messages = sqliteTable("messages", {
    id: integer("id").primaryKey(),
    shareId: text("share_id").notNull(),
    chatId: integer("chat_id").notNull(),
    sourceMessageId: integer("source_message_id").notNull(),
    copiedMessageId: integer("copied_message_id").notNull(),
    controlMessageId: integer("control_message_id").notNull(),
    messageSnapshot: text("message_snapshot", { mode: "json" })
        .$type<MessageSnapshot>()
        .notNull(),
    inlineKeyboard: text("inline_keyboard", { mode: "json" }).$type<EditorKeyboard>(),
    createdAt: integer("created_at", {
        mode: "timestamp_ms",
    }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", {
        mode: "timestamp_ms",
    }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, (table) => [
    uniqueIndex("messages_share_id_unique").on(table.shareId),
    uniqueIndex("messages_chat_source_message_unique").on(
        table.chatId,
        table.sourceMessageId,
    ),
]);

export const inlineMessages = sqliteTable("inline_messages", {
    id: integer("id").primaryKey(),
    shareId: text("share_id")
        .notNull()
        .references(() => messages.shareId, { onDelete: "cascade" }),
    inlineMessageId: text("inline_message_id").notNull(),
    createdAt: integer("created_at", {
        mode: "timestamp_ms",
    }).notNull().$defaultFn(() => new Date()),
}, (table) => [
    uniqueIndex("inline_messages_inline_message_id_unique").on(
        table.inlineMessageId,
    ),
    index("inline_messages_share_id_idx").on(table.shareId),
]);
