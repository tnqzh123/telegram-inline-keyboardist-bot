const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

export type TelegramMiniAppUser = {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
};

export type InitDataValidation =
    | { ok: true; user: TelegramMiniAppUser; authDate: number }
    | { ok: false; error: string };

function hex(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let index = 0; index < a.length; index += 1) {
        result |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }
    return result === 0;
}

async function hmac(key: BufferSource, value: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

export async function validateTelegramInitData(
    initData: string,
    botToken: string,
    options?: { nowSeconds?: number; maxAgeSeconds?: number },
): Promise<InitDataValidation> {
    if (!initData) return { ok: false, error: "缺少 Telegram Mini App 身份信息。" };

    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash")?.toLowerCase();
    if (!receivedHash || !/^[a-f0-9]{64}$/.test(receivedHash)) {
        return { ok: false, error: "Telegram Mini App 身份签名无效。" };
    }

    params.delete("hash");
    const dataCheckString = [...params.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

    const secretKey = await hmac(new TextEncoder().encode("WebAppData"), botToken);
    const expectedHash = hex(await hmac(secretKey, dataCheckString));
    if (!timingSafeEqual(expectedHash, receivedHash)) {
        return { ok: false, error: "Telegram Mini App 身份签名无效。" };
    }

    const authDate = Number(params.get("auth_date"));
    const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
    const maxAgeSeconds = options?.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    if (
        !Number.isSafeInteger(authDate) ||
        authDate > nowSeconds + 30 ||
        nowSeconds - authDate > maxAgeSeconds
    ) {
        return { ok: false, error: "Telegram Mini App 会话已过期，请重新打开。" };
    }

    const rawUser = params.get("user");
    if (!rawUser) return { ok: false, error: "Telegram Mini App 身份中没有用户信息。" };

    try {
        const user = JSON.parse(rawUser) as TelegramMiniAppUser;
        if (!Number.isSafeInteger(user.id)) throw new Error("invalid user id");
        return { ok: true, user, authDate };
    } catch {
        return { ok: false, error: "Telegram Mini App 用户信息无效。" };
    }
}
