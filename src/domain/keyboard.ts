import type {
    InlineKeyboardButton,
    InlineKeyboardMarkup,
} from "node-telegram-bot-api";

export const MAX_BUTTONS_PER_ROW = 12;
export const MAX_BUTTONS = 300;
export const MAX_BUTTON_TEXT_LENGTH = 64;
export const MAX_COPY_TEXT_LENGTH = 256;

export const BUTTON_STYLES = ["primary", "success", "danger"] as const;

export type ButtonStyle = (typeof BUTTON_STYLES)[number];

export type UrlButton = {
    type: "url";
    text: string;
    url: string;
    style?: ButtonStyle;
};

export type CopyTextButton = {
    type: "copy_text";
    text: string;
    copyText: string;
    style?: ButtonStyle;
};

export type SendToButton = {
    type: "send_to";
    text: string;
    style?: ButtonStyle;
};

export type EditorButton = UrlButton | CopyTextButton | SendToButton;
export type EditorKeyboard = EditorButton[][];

export type KeyboardValidationResult =
    | { ok: true; keyboard: EditorKeyboard }
    | { ok: false; error: string };

export type SanitizedKeyboard = {
    keyboard: EditorKeyboard | null;
    droppedCount: number;
    strippedIconCount: number;
};

const VALID_STYLE = new Set<string>(BUTTON_STYLES);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateLabel(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const label = value.trim();
    if (!label || Array.from(label).length > MAX_BUTTON_TEXT_LENGTH) return null;
    return label;
}

function validateStyle(value: unknown): ButtonStyle | undefined | null {
    if (value === undefined || value === null || value === "") return undefined;
    return typeof value === "string" && VALID_STYLE.has(value)
        ? (value as ButtonStyle)
        : null;
}

export function isAllowedUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "tg:";
    } catch {
        return false;
    }
}

export function validateEditorKeyboard(value: unknown): KeyboardValidationResult {
    if (!Array.isArray(value) || value.length === 0) {
        return { ok: false, error: "Inline Keyboard 至少需要一个按钮。" };
    }

    let total = 0;
    const keyboard: EditorKeyboard = [];

    for (const [rowIndex, sourceRow] of value.entries()) {
        if (!Array.isArray(sourceRow)) {
            return { ok: false, error: `第 ${rowIndex + 1} 行格式无效。` };
        }
        // Empty rows are useful while arranging the keyboard in the Mini App,
        // but Telegram should never receive or persist them.
        if (sourceRow.length === 0) continue;
        if (sourceRow.length > MAX_BUTTONS_PER_ROW) {
            return {
                ok: false,
                error: `第 ${rowIndex + 1} 行超过 ${MAX_BUTTONS_PER_ROW} 个按钮。`,
            };
        }

        total += sourceRow.length;
        if (total > MAX_BUTTONS) {
            return { ok: false, error: `按钮总数不能超过 ${MAX_BUTTONS} 个。` };
        }

        const row: EditorButton[] = [];
        for (const [buttonIndex, sourceButton] of sourceRow.entries()) {
            if (!isRecord(sourceButton)) {
                return {
                    ok: false,
                    error: `第 ${rowIndex + 1} 行第 ${buttonIndex + 1} 个按钮格式无效。`,
                };
            }

            const text = validateLabel(sourceButton.text);
            const style = validateStyle(sourceButton.style);
            if (text === null) {
                return {
                    ok: false,
                    error: `第 ${rowIndex + 1} 行第 ${buttonIndex + 1} 个按钮需要 1–${MAX_BUTTON_TEXT_LENGTH} 个字符的文本。`,
                };
            }
            if (style === null) {
                return {
                    ok: false,
                    error: `第 ${rowIndex + 1} 行第 ${buttonIndex + 1} 个按钮颜色无效。`,
                };
            }

            switch (sourceButton.type) {
                case "url": {
                    if (typeof sourceButton.url !== "string" || !isAllowedUrl(sourceButton.url.trim())) {
                        return {
                            ok: false,
                            error: `第 ${rowIndex + 1} 行第 ${buttonIndex + 1} 个按钮需要有效的 http、https 或 tg 链接。`,
                        };
                    }
                    row.push({ type: "url", text, url: sourceButton.url.trim(), ...(style && { style }) });
                    break;
                }
                case "copy_text": {
                    if (
                        typeof sourceButton.copyText !== "string" ||
                        Array.from(sourceButton.copyText).length < 1 ||
                        Array.from(sourceButton.copyText).length > MAX_COPY_TEXT_LENGTH
                    ) {
                        return {
                            ok: false,
                            error: `第 ${rowIndex + 1} 行第 ${buttonIndex + 1} 个复制按钮需要 1–${MAX_COPY_TEXT_LENGTH} 个字符的内容。`,
                        };
                    }
                    row.push({
                        type: "copy_text",
                        text,
                        copyText: sourceButton.copyText,
                        ...(style && { style }),
                    });
                    break;
                }
                case "send_to":
                    row.push({ type: "send_to", text, ...(style && { style }) });
                    break;
                default:
                    return {
                        ok: false,
                        error: `第 ${rowIndex + 1} 行第 ${buttonIndex + 1} 个按钮类型无效。`,
                    };
            }
        }
        keyboard.push(row);
    }

    if (keyboard.length === 0) {
        return { ok: false, error: "Inline Keyboard 至少需要一个按钮。" };
    }

    return { ok: true, keyboard };
}

export function sanitizeSourceKeyboard(
    markup?: InlineKeyboardMarkup,
): SanitizedKeyboard {
    if (!markup?.inline_keyboard?.length) {
        return { keyboard: null, droppedCount: 0, strippedIconCount: 0 };
    }

    let droppedCount = 0;
    let strippedIconCount = 0;
    const keyboard: EditorKeyboard = [];

    for (const sourceRow of markup.inline_keyboard) {
        const row: EditorButton[] = [];
        for (const button of sourceRow) {
            const text = validateLabel(button.text);
            const style = validateStyle(button.style);
            if (!text || style === null) {
                droppedCount += 1;
                continue;
            }

            if (typeof button.url === "string" && isAllowedUrl(button.url)) {
                if (button.icon_custom_emoji_id) strippedIconCount += 1;
                row.push({ type: "url", text, url: button.url, ...(style && { style }) });
                continue;
            }

            const copyText = button.copy_text?.text;
            if (
                typeof copyText === "string" &&
                Array.from(copyText).length >= 1 &&
                Array.from(copyText).length <= MAX_COPY_TEXT_LENGTH
            ) {
                if (button.icon_custom_emoji_id) strippedIconCount += 1;
                row.push({ type: "copy_text", text, copyText, ...(style && { style }) });
                continue;
            }

            droppedCount += 1;
        }
        if (row.length) keyboard.push(row);
    }

    return {
        keyboard: keyboard.length ? keyboard : null,
        droppedCount,
        strippedIconCount,
    };
}

export function toTelegramKeyboard(
    keyboard: EditorKeyboard,
    shareId: string,
): InlineKeyboardMarkup {
    return {
        inline_keyboard: keyboard.map((row) =>
            row.map((button): InlineKeyboardButton => {
                const style = button.style ? { style: button.style } : {};
                switch (button.type) {
                    case "url":
                        return { text: button.text, url: button.url, ...style };
                    case "copy_text":
                        return {
                            text: button.text,
                            copy_text: { text: button.copyText },
                            ...style,
                        };
                    case "send_to":
                        return { text: button.text, switch_inline_query: shareId, ...style };
                }
            }),
        ),
    };
}

export function countButtons(keyboard: EditorKeyboard): number {
    return keyboard.reduce((sum, row) => sum + row.length, 0);
}
