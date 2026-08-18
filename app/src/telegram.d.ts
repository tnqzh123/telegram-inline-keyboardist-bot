type TelegramColorScheme = "light" | "dark";

interface TelegramWebApp {
    initData: string;
    colorScheme: TelegramColorScheme;
    isVersionAtLeast(version: string): boolean;
    ready(): void;
    expand(): void;
    disableVerticalSwipes?(): void;
    setHeaderColor?(color: "bg_color" | "secondary_bg_color" | string): void;
    onEvent?(eventType: "themeChanged", handler: () => void): void;
    offEvent?(eventType: "themeChanged", handler: () => void): void;
    HapticFeedback?: {
        notificationOccurred(type: "error" | "success" | "warning"): void;
        impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    };
}

interface Window {
    Telegram?: { WebApp: TelegramWebApp };
}
