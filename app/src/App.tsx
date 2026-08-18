import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AppRoot,
    Button,
    Headline,
    IconButton,
    Input,
    Modal,
    Select,
    Snackbar,
    Spinner,
    Textarea,
} from "@telegram-apps/telegram-ui";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    pointerWithin,
    useDroppable,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type DragMoveEvent,
    type DragOverEvent,
    type DragStartEvent,
    type Modifier,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    getFloatingOverlayTransformOffset,
    getLeadingEdgeInsertionX,
    getRowInsertionIndex,
    moveButtonToIndex,
    type DragPoint,
} from "./drag";
import {
    Check,
    ContactRound,
    Copy,
    ExternalLink,
    FileText,
    Film,
    GripVertical,
    Image as ImageIcon,
    Link,
    MapPin,
    MapPinned,
    MessageSquareText,
    Mic,
    Music,
    Plus,
    Rows3,
    Save,
    Send,
    Sticker,
    Trash2,
    Video,
    X,
} from "lucide-react";
import {
    MAX_BUTTONS,
    MAX_BUTTONS_PER_ROW,
    countButtons,
    validateEditorKeyboard,
    type ButtonStyle,
    type EditorButton,
    type EditorKeyboard,
} from "../../src/domain/keyboard";
import type { MessageSnapshot } from "../../src/domain/message";

type ApiMessage = {
    id: string;
    message: { type: MessageSnapshot["type"]; typeLabel: string; summary: string };
    keyboard: EditorKeyboard | null;
};

type UiButton = EditorButton & { id: string };
type UiRow = { id: string; buttons: UiButton[] };
type Draft = {
    type: EditorButton["type"];
    text: string;
    url: string;
    copyText: string;
    style: ButtonStyle | "";
};
type EditTarget = { rowId: string | null; buttonId: string | null };
type Notice = { kind: "success" | "error"; text: string };
type VisualViewportRect = { top: number; left: number; width: number; height: number };
type ButtonDragPreview = {
    button: UiButton;
    sourceRowId: string;
    targetRowId: string | null;
    targetIndex: number;
};

const NEW_ROW_BUTTON_DROP_ID = "new-row-button-drop";
const FLOATING_BUTTON_MAX_WIDTH = 112;
const FLOATING_BUTTON_VIEWPORT_WIDTH_RATIO = 0.34;
const FLOATING_BUTTON_HEIGHT = 32;
const FLOATING_BUTTON_CENTER_OFFSET = { x: 0, y: 0 };

type DragInputState = {
    pointerType: string;
    lastPointerX: number;
    horizontalDirection: -1 | 0 | 1;
};

function getActivatorPoint(event: Event | null): DragPoint | null {
    if (!event || !("clientX" in event) || !("clientY" in event)) return null;
    const { clientX, clientY } = event as PointerEvent;
    return Number.isFinite(clientX) && Number.isFinite(clientY)
        ? { x: clientX, y: clientY }
        : null;
}

function getPointerType(event: Event | null): string {
    return event && "pointerType" in event
        ? (event as PointerEvent).pointerType
        : "mouse";
}

const positionFloatingButtonAtPointer: Modifier = ({
    active,
    activatorEvent,
    draggingNodeRect,
    transform,
}) => {
    if (active?.data.current?.kind !== "button" || !draggingNodeRect) return transform;
    const activationPoint = getActivatorPoint(activatorEvent);
    if (!activationPoint) return transform;

    const offset = getFloatingOverlayTransformOffset(
        {
            x: draggingNodeRect.left,
            y: draggingNodeRect.top,
            width: draggingNodeRect.width,
            height: draggingNodeRect.height,
        },
        activationPoint,
        FLOATING_BUTTON_CENTER_OFFSET,
    );
    return { ...transform, x: transform.x + offset.x, y: transform.y + offset.y };
};

const floatingButtonWithinExcludingActive: CollisionDetection = (args) => {
    const targetPoint = args.pointerCoordinates;
    const activeKind = args.active.data.current?.kind;
    const newRowContainer = args.droppableContainers.find(
        (container) => container.id === NEW_ROW_BUTTON_DROP_ID,
    );
    const newRowRect = args.droppableRects.get(NEW_ROW_BUTTON_DROP_ID);
    if (
        activeKind === "button" && targetPoint && newRowContainer && newRowRect &&
        targetPoint.x >= newRowRect.left && targetPoint.x <= newRowRect.right &&
        targetPoint.y >= newRowRect.top - 12 && targetPoint.y <= newRowRect.bottom
    ) {
        return [{
            id: NEW_ROW_BUTTON_DROP_ID,
            data: { droppableContainer: newRowContainer, value: 1 },
        }];
    }
    return pointerWithin({ ...args, pointerCoordinates: targetPoint })
        .filter((collision) => collision.id !== args.active.id);
};

const DEMO_MESSAGE: ApiMessage = {
    id: "demoKeyboardPreview001",
    message: {
        type: "photo",
        typeLabel: "图片",
        summary: "本周产品更新：更清晰的消息摘要，以及更灵活的分享按钮。",
    },
    keyboard: [
        [
            { type: "url", text: "查看详情", url: "https://telegram.org", style: "primary" },
            { type: "copy_text", text: "复制编号", copyText: "TG-2026-0818" },
        ],
        [{ type: "send_to", text: "发送给朋友", style: "success" }],
    ],
};

function makeId(): string {
    return crypto.randomUUID();
}

function readVisualViewport(): VisualViewportRect {
    const viewport = window.visualViewport;
    return {
        top: viewport?.offsetTop ?? 0,
        left: viewport?.offsetLeft ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
    };
}

function toUiRows(keyboard: EditorKeyboard | null): UiRow[] {
    return (keyboard ?? []).filter((row) => row.length > 0).map((row) => ({
        id: makeId(),
        buttons: row.map((button) => ({ ...button, id: makeId() })),
    }));
}

function toKeyboard(rows: UiRow[]): EditorKeyboard {
    return rows.map((row) =>
        row.buttons.map(({ id: _id, ...button }) => button as EditorButton),
    );
}

function buttonIcon(type: EditorButton["type"], size = 18) {
    switch (type) {
        case "url":
            return <Link size={size} aria-hidden />;
        case "copy_text":
            return <Copy size={size} aria-hidden />;
        case "send_to":
            return <Send size={size} aria-hidden />;
    }
}

function ButtonPreviewContent({
    type,
    text,
}: {
    type: EditorButton["type"];
    text: string;
}) {
    return (
        <>
            <span>{text || "未命名按钮"}</span>
            {type === "url" && <ExternalLink size={12} aria-hidden />}
            {type === "copy_text" && <Copy size={12} aria-hidden />}
            {type === "send_to" && <Send size={12} aria-hidden />}
        </>
    );
}

function messageIcon(type: MessageSnapshot["type"], size = 19) {
    switch (type) {
        case "text":
            return <MessageSquareText size={size} aria-hidden />;
        case "photo":
            return <ImageIcon size={size} aria-hidden />;
        case "video":
            return <Video size={size} aria-hidden />;
        case "animation":
            return <Film size={size} aria-hidden />;
        case "audio":
            return <Music size={size} aria-hidden />;
        case "voice":
            return <Mic size={size} aria-hidden />;
        case "document":
            return <FileText size={size} aria-hidden />;
        case "sticker":
            return <Sticker size={size} aria-hidden />;
        case "contact":
            return <ContactRound size={size} aria-hidden />;
        case "location":
            return <MapPin size={size} aria-hidden />;
        case "venue":
            return <MapPinned size={size} aria-hidden />;
        default:
            return <MessageSquareText size={size} aria-hidden />;
    }
}

function newDraft(type: EditorButton["type"] = "url"): Draft {
    return {
        type,
        text: type === "send_to" ? "Send to ..." : "",
        url: "https://",
        copyText: "",
        style: "",
    };
}

function draftFromButton(button: UiButton): Draft {
    return {
        type: button.type,
        text: button.text,
        url: button.type === "url" ? button.url : "https://",
        copyText: button.type === "copy_text" ? button.copyText : "",
        style: button.style ?? "",
    };
}

function buttonFromDraft(draft: Draft): EditorButton {
    const style = draft.style ? { style: draft.style } : {};
    switch (draft.type) {
        case "url":
            return { type: "url", text: draft.text, url: draft.url, ...style };
        case "copy_text":
            return {
                type: "copy_text",
                text: draft.text,
                copyText: draft.copyText,
                ...style,
            };
        case "send_to":
            return { type: "send_to", text: draft.text, ...style };
    }
}

function Preview({
    message,
    rows,
    shareId,
    total,
    dragPreview,
    onRowElement,
    onAddNewRowButton,
    onAddButton,
    onEditButton,
}: {
    message: ApiMessage["message"];
    rows: UiRow[];
    shareId: string;
    total: number;
    dragPreview: ButtonDragPreview | null;
    onRowElement: (rowId: string, element: HTMLDivElement | null) => void;
    onAddNewRowButton: () => void;
    onAddButton: (rowId: string) => void;
    onEditButton: (rowId: string, buttonId: string) => void;
}) {
    return (
        <section className="preview-shell" aria-label="消息和 Inline Keyboard 可视化编辑器">
            <div className="preview-topline">
                <span>消息与键盘</span>
                <code className="share-id-pill" title={shareId}>{shareId}</code>
            </div>
            <div className="message-bubble" data-message-type={message.type}>
                {messageIcon(message.type)}
                <p>{message.summary}</p>
            </div>
            <div className="keyboard-canvas" aria-label={`${rows.length} 行，${total} / ${MAX_BUTTONS} 个按钮`}>
                {total === 0 ? (
                    <button type="button" className="keyboard-empty-add-button" onClick={onAddNewRowButton}>
                        <Plus size={20} aria-hidden />
                        <span>添加按钮</span>
                    </button>
                ) : (
                    <>
                        <SortableContext
                            items={rows.map((row) => `row:${row.id}`)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="keyboard-canvas-rows">
                                {rows.map((row, index) => (
                                    <KeyboardCanvasRow
                                        key={row.id}
                                        row={row}
                                        index={index}
                                        dragPreview={dragPreview}
                                        onElement={onRowElement}
                                        onEdit={(buttonId) => onEditButton(row.id, buttonId)}
                                        onAdd={() => onAddButton(row.id)}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                        <AddNewRowButton onClick={onAddNewRowButton} />
                    </>
                )}
            </div>
        </section>
    );
}

function AddNewRowButton({ onClick }: { onClick: () => void }) {
    const { setNodeRef, isOver } = useDroppable({
        id: NEW_ROW_BUTTON_DROP_ID,
        data: { kind: "new-row-button-drop" },
    });

    return (
        <div ref={setNodeRef} className="keyboard-add-new-row-drop-zone">
            <button
                type="button"
                className={`keyboard-add-new-row-button${isOver ? " is-over" : ""}`}
                onClick={onClick}
            >
                <Plus size={19} aria-hidden />
                <span>{isOver ? "移动到新的一行" : "在新的一行添加按钮"}</span>
            </button>
        </div>
    );
}

function ButtonDragOverlay({ button }: { button: UiButton }) {
    return (
        <div
            className="keyboard-preview-button keyboard-button-drag-overlay"
            data-style={button.style || "default"}
        >
            <ButtonPreviewContent type={button.type} text={button.text} />
        </div>
    );
}

function SortableCanvasButton({
    button,
    rowId,
    previewing,
    onEdit,
}: {
    button: UiButton;
    rowId: string;
    previewing: boolean;
    onEdit: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: button.id,
        data: { kind: "button", rowId },
    });

    return (
        <button
            type="button"
            ref={setNodeRef}
            className={`keyboard-preview-button wysiwyg-preview-button${isDragging ? " is-dragging" : ""}`}
            data-style={button.style || "default"}
            title={`编辑或拖动：${button.text}`}
            onClick={onEdit}
            style={{
                transform: previewing ? undefined : CSS.Transform.toString(transform),
                transition: previewing ? undefined : transition,
            }}
            {...attributes}
            {...listeners}
        >
            <ButtonPreviewContent type={button.type} text={button.text} />
        </button>
    );
}

function KeyboardCanvasRow({
    row,
    index,
    dragPreview,
    onElement,
    onEdit,
    onAdd,
}: {
    row: UiRow;
    index: number;
    dragPreview: ButtonDragPreview | null;
    onElement: (rowId: string, element: HTMLDivElement | null) => void;
    onEdit: (buttonId: string) => void;
    onAdd: () => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
        isOver,
    } = useSortable({
        id: `row:${row.id}`,
        data: { kind: "row", rowId: row.id },
    });
    const setRowNodeRef = useCallback((element: HTMLDivElement | null) => {
        setNodeRef(element);
        onElement(row.id, element);
    }, [onElement, row.id, setNodeRef]);
    const draggedButton = dragPreview?.button;
    const sourceButton = row.buttons.find((button) => button.id === draggedButton?.id);
    const visibleButtons = sourceButton
        ? row.buttons.filter((button) => button.id !== sourceButton.id)
        : row.buttons;
    const isDropTarget = dragPreview?.targetRowId === row.id;
    const targetIndex = Math.min(dragPreview?.targetIndex ?? visibleButtons.length, visibleButtons.length);
    const previewItems: Array<UiButton | { placeholder: true }> = [...visibleButtons];
    if (isDropTarget) previewItems.splice(targetIndex, 0, { placeholder: true });
    const visibleButtonCount = previewItems.length;
    const full = visibleButtonCount >= MAX_BUTTONS_PER_ROW;
    const columns = visibleButtonCount === 0
        ? "var(--keyboard-add-cell-size)"
        : `${`repeat(${visibleButtonCount}, minmax(0, 1fr))`}${full ? "" : " var(--keyboard-add-cell-size)"}`;

    return (
        <div
            ref={setRowNodeRef}
            className={`keyboard-canvas-row${isOver ? " is-over" : ""}${isDropTarget ? " is-drop-target" : ""}${isDragging ? " is-dragging" : ""}`}
            style={{ transform: CSS.Transform.toString(transform), transition }}
        >
            <button
                type="button"
                className="keyboard-row-drag-handle"
                aria-label={`拖动第 ${index + 1} 行`}
                {...attributes}
                {...listeners}
            >
                <GripVertical size={18} aria-hidden />
            </button>
            <div className="keyboard-row-content">
                <SortableContext items={row.buttons.map((button) => button.id)} strategy={rectSortingStrategy}>
                    <div
                        className={`keyboard-canvas-grid${row.buttons.length === 0 ? " is-empty" : ""}${full ? "" : " has-add-button"}`}
                        style={{ gridTemplateColumns: columns }}
                    >
                        {sourceButton && (
                            <SortableCanvasButton
                                button={sourceButton}
                                rowId={row.id}
                                previewing={Boolean(dragPreview)}
                                onEdit={() => onEdit(sourceButton.id)}
                            />
                        )}
                        {previewItems.map((item, previewIndex) =>
                            "placeholder" in item ? (
                                <div
                                    className="keyboard-preview-button keyboard-button-drop-placeholder"
                                    data-style={draggedButton?.style || "default"}
                                    key={`placeholder:${previewIndex}`}
                                >
                                    <ButtonPreviewContent
                                        type={draggedButton?.type ?? "url"}
                                        text={draggedButton?.text ?? "按钮"}
                                    />
                                </div>
                            ) : (
                                <SortableCanvasButton
                                    button={item}
                                    rowId={row.id}
                                    previewing={Boolean(dragPreview)}
                                    key={item.id}
                                    onEdit={() => onEdit(item.id)}
                                />
                            ),
                        )}
                        {!full && (
                            <button
                                type="button"
                                className="keyboard-add-button-cell"
                                aria-label={`在第 ${index + 1} 行添加按钮`}
                                onClick={onAdd}
                            >
                                <Plus size={23} aria-hidden />
                            </button>
                        )}
                    </div>
                </SortableContext>
            </div>
        </div>
    );
}

function ButtonEditor({
    open,
    title,
    draft,
    setDraft,
    error,
    onClose,
    onSubmit,
    onDelete,
}: {
    open: boolean;
    title: "添加按钮" | "编辑按钮";
    draft: Draft;
    setDraft: (draft: Draft) => void;
    error: string | null;
    onClose: () => void;
    onSubmit: () => void;
    onDelete?: () => void;
}) {
    const sheetRef = useRef<HTMLElement>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState<VisualViewportRect>(readVisualViewport);

    useEffect(() => {
        if (!open) return;

        const body = document.body;
        const root = document.documentElement;
        const pageScrollX = window.scrollX;
        const pageScrollY = window.scrollY;
        const previousBodyStyle = {
            position: body.style.position,
            top: body.style.top,
            left: body.style.left,
            right: body.style.right,
            width: body.style.width,
            overflow: body.style.overflow,
        };
        const previousRootOverflow = root.style.overflow;
        let animationFrame = 0;
        const focusTimers: number[] = [];

        body.style.position = "fixed";
        body.style.top = `${-pageScrollY}px`;
        body.style.left = `${-pageScrollX}px`;
        body.style.right = "0";
        body.style.width = "100%";
        body.style.overflow = "hidden";
        root.style.overflow = "hidden";

        const revealActiveField = () => {
            const active = document.activeElement;
            const scroller = scrollerRef.current;
            if (!(active instanceof HTMLElement) || !scroller?.contains(active)) return;

            const field = active.closest<HTMLElement>(".editor-field") ?? active;
            const fieldRect = field.getBoundingClientRect();
            const scrollerRect = scroller.getBoundingClientRect();
            const visibleTop = scrollerRect.top + 12;
            const visibleBottom = scrollerRect.bottom - 16;

            if (fieldRect.bottom > visibleBottom) {
                scroller.scrollTop += fieldRect.bottom - visibleBottom;
            } else if (fieldRect.top < visibleTop) {
                scroller.scrollTop -= visibleTop - fieldRect.top;
            }
        };

        const syncViewport = () => {
            window.cancelAnimationFrame(animationFrame);
            animationFrame = window.requestAnimationFrame(() => {
                const next = readVisualViewport();
                setViewport((current) =>
                    current.top === next.top &&
                    current.left === next.left &&
                    current.width === next.width &&
                    current.height === next.height
                        ? current
                        : next,
                );
                window.requestAnimationFrame(revealActiveField);
            });
        };

        const handleFocusIn = (event: FocusEvent) => {
            if (!(event.target instanceof Node) || !sheetRef.current?.contains(event.target)) return;
            syncViewport();
            // iOS animates the visual viewport for a few hundred milliseconds. The
            // resize events handle most frames; this final pass covers the settled
            // keyboard position in Telegram's WKWebView.
            focusTimers.push(window.setTimeout(revealActiveField, 350));
        };

        const visualViewport = window.visualViewport;
        visualViewport?.addEventListener("resize", syncViewport);
        visualViewport?.addEventListener("scroll", syncViewport);
        window.addEventListener("resize", syncViewport);
        document.addEventListener("focusin", handleFocusIn);
        syncViewport();

        return () => {
            visualViewport?.removeEventListener("resize", syncViewport);
            visualViewport?.removeEventListener("scroll", syncViewport);
            window.removeEventListener("resize", syncViewport);
            document.removeEventListener("focusin", handleFocusIn);
            window.cancelAnimationFrame(animationFrame);
            focusTimers.forEach((timer) => window.clearTimeout(timer));

            body.style.position = previousBodyStyle.position;
            body.style.top = previousBodyStyle.top;
            body.style.left = previousBodyStyle.left;
            body.style.right = previousBodyStyle.right;
            body.style.width = previousBodyStyle.width;
            body.style.overflow = previousBodyStyle.overflow;
            root.style.overflow = previousRootOverflow;
            window.requestAnimationFrame(() => window.scrollTo(pageScrollX, pageScrollY));
        };
    }, [open]);

    if (!open) return null;

    return (
        <div
            className="button-editor-viewport"
            style={{
                top: viewport.top,
                left: viewport.left,
                width: viewport.width,
                height: viewport.height,
            }}
        >
            <div className="button-editor-backdrop" aria-hidden="true" />
            <section
                ref={sheetRef}
                className="button-editor-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="button-editor-title"
            >
                <Modal.Header
                    before={buttonIcon(draft.type, 20)}
                    after={
                        <IconButton size="s" mode="plain" aria-label="关闭" onClick={onClose}>
                            <X size={20} aria-hidden />
                        </IconButton>
                    }
                >
                    <span id="button-editor-title">{title}</span>
                </Modal.Header>
                <div ref={scrollerRef} className="button-editor-scroll">
                    <div className="button-editor">
                        <div className="style-preview button-editor-preview" data-style={draft.style || "default"}>
                            <ButtonPreviewContent type={draft.type} text={draft.text || "按钮文本"} />
                        </div>
                        <Select
                            aria-label="按钮类型"
                            className="editor-field"
                            header="按钮类型"
                            value={draft.type}
                            onChange={(event) => {
                                const type = event.target.value as Draft["type"];
                                setDraft({
                                    ...draft,
                                    type,
                                    text: draft.text || (type === "send_to" ? "Send to ..." : ""),
                                });
                            }}
                        >
                            <option value="url">URL</option>
                            <option value="copy_text">Copy Text</option>
                            <option value="send_to">Send to</option>
                        </Select>
                        <Input
                            aria-label="按钮文本"
                            className="editor-field"
                            header="按钮文本"
                            placeholder="按钮上显示的文字"
                            value={draft.text}
                            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                        />
                        {draft.type === "url" && (
                            <Input
                                aria-label="链接"
                                className="editor-field"
                                header="链接"
                                inputMode="url"
                                placeholder="https://example.com"
                                value={draft.url}
                                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                            />
                        )}
                        {draft.type === "copy_text" && (
                            <Textarea
                                aria-label="复制内容"
                                className="editor-field"
                                header="复制内容"
                                placeholder="点击按钮后复制的文本"
                                value={draft.copyText}
                                onChange={(event) =>
                                    setDraft({ ...draft, copyText: event.target.value })
                                }
                                rows={3}
                            />
                        )}
                        {draft.type === "send_to" && (
                            <p className="field-note">
                                这个按钮会打开 Inline Mode，并指向当前消息，以供其他人再次发送。
                            </p>
                        )}
                        <Select
                            aria-label="颜色"
                            className="editor-field"
                            header="颜色"
                            value={draft.style}
                            onChange={(event) =>
                                setDraft({ ...draft, style: event.target.value as Draft["style"] })
                            }
                        >
                            <option value="">默认</option>
                            <option value="primary">Primary · 蓝色</option>
                            <option value="success">Success · 绿色</option>
                            <option value="danger">Danger · 红色</option>
                        </Select>
                        {error && <p className="form-error">{error}</p>}
                        <div className={`button-editor-actions${onDelete ? " has-delete" : ""}`}>
                            {onDelete && (
                                <IconButton
                                    size="m"
                                    mode="plain"
                                    className="button-editor-delete"
                                    aria-label="删除按钮"
                                    onClick={onDelete}
                                >
                                    <Trash2 size={22} aria-hidden />
                                </IconButton>
                            )}
                            <Button
                                className="balanced-action-button"
                                size="l"
                                stretched
                                before={<Check size={19} aria-hidden />}
                                onClick={onSubmit}
                            >
                                完成
                            </Button>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

export function App() {
    const tg = window.Telegram?.WebApp;
    const params = useMemo(() => new URLSearchParams(window.location.search), []);
    const demo = import.meta.env.DEV && (!tg?.initData || params.get("demo") === "1");
    const forcedAppearance = params.get("theme") === "dark" ? "dark" : params.get("theme") === "light" ? "light" : null;
    const [appearance, setAppearance] = useState<"light" | "dark">(
        forcedAppearance ?? tg?.colorScheme ??
            (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    );
    const [message, setMessage] = useState<ApiMessage["message"] | null>(null);
    const [rows, setRows] = useState<UiRow[]>([]);
    const [savedKeyboard, setSavedKeyboard] = useState<EditorKeyboard>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [fatalError, setFatalError] = useState<string | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
    const [draft, setDraft] = useState<Draft>(newDraft());
    const [draftError, setDraftError] = useState<string | null>(null);
    const [dragPreview, setDragPreview] = useState<ButtonDragPreview | null>(null);
    const dragPreviewRef = useRef<ButtonDragPreview | null>(null);
    const dragTargetRowIdRef = useRef<string | null>(null);
    const dragInputRef = useRef<DragInputState | null>(null);
    const rowElementsRef = useRef(new Map<string, HTMLDivElement>());
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
    const registerRowElement = useCallback((rowId: string, element: HTMLDivElement | null) => {
        if (element) rowElementsRef.current.set(rowId, element);
        else rowElementsRef.current.delete(rowId);
    }, []);

    const shareId = params.get("id") ?? "";
    const keyboard = useMemo(() => toKeyboard(rows), [rows]);
    const total = countButtons(keyboard);
    const validation = validateEditorKeyboard(keyboard);
    const dirty = JSON.stringify(keyboard) !== JSON.stringify(savedKeyboard);
    const supports = (version: string) => tg?.isVersionAtLeast?.(version) ?? false;
    const notify = (type: "error" | "success" | "warning") => {
        if (supports("6.1")) tg?.HapticFeedback?.notificationOccurred(type);
    };
    const impact = () => {
        if (supports("6.1")) tg?.HapticFeedback?.impactOccurred("light");
    };

    useEffect(() => {
        document.documentElement.dataset.theme = appearance;
        tg?.ready();
        tg?.expand();
        if (supports("7.7")) tg?.disableVerticalSwipes?.();
        if (supports("6.1")) tg?.setHeaderColor?.("secondary_bg_color");
    }, [appearance, tg]);

    useEffect(() => {
        if (forcedAppearance || !tg?.onEvent) return;
        const updateTheme = () => setAppearance(tg.colorScheme);
        tg.onEvent("themeChanged", updateTheme);
        return () => tg.offEvent?.("themeChanged", updateTheme);
    }, [forcedAppearance, tg]);

    useEffect(() => {
        if (demo) {
            setMessage(DEMO_MESSAGE.message);
            setRows(toUiRows(DEMO_MESSAGE.keyboard));
            setSavedKeyboard(DEMO_MESSAGE.keyboard ?? []);
            setLoading(false);
            return;
        }
        if (!shareId || !tg?.initData) {
            setFatalError("请从 Bot 消息里的「打开 Inline Keyboardist」按钮打开此页面。");
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        fetch(`/api/messages/${encodeURIComponent(shareId)}`, {
            headers: { "x-telegram-init-data": tg.initData },
            signal: controller.signal,
        })
            .then(async (response) => {
                const data = (await response.json()) as ApiMessage | { error: string };
                if (!response.ok) throw new Error("error" in data ? data.error : "加载失败");
                return data as ApiMessage;
            })
            .then((data) => {
                const initial = data.keyboard ?? [];
                setMessage(data.message);
                setRows(toUiRows(initial));
                setSavedKeyboard(initial);
            })
            .catch((error: unknown) => {
                if ((error as Error).name !== "AbortError") {
                    setFatalError(error instanceof Error ? error.message : "加载失败，请重新打开。");
                }
            })
            .finally(() => setLoading(false));

        return () => controller.abort();
    }, [demo, shareId, tg?.initData]);

    function openNewButton(rowId: string) {
        if (total >= MAX_BUTTONS) {
            setNotice({ kind: "error", text: `最多只能添加 ${MAX_BUTTONS} 个按钮。` });
            return;
        }
        setDraft(newDraft());
        setDraftError(null);
        setEditTarget({ rowId, buttonId: null });
    }

    function openNewRowButton() {
        setDraft(newDraft());
        setDraftError(null);
        setEditTarget({ rowId: null, buttonId: null });
    }

    function openExistingButton(rowId: string, buttonId: string) {
        const button = rows.find((row) => row.id === rowId)?.buttons.find((item) => item.id === buttonId);
        if (!button) return;
        setDraft(draftFromButton(button));
        setDraftError(null);
        setEditTarget({ rowId, buttonId });
    }

    function submitDraft() {
        const button = buttonFromDraft(draft);
        const result = validateEditorKeyboard([[button]]);
        if (!result.ok) {
            setDraftError(result.error);
            notify("error");
            return;
        }
        const normalized = result.keyboard[0][0];
        setRows((current) => {
            if (!editTarget) return current;
            if (!editTarget.rowId) {
                return [...current, { id: makeId(), buttons: [{ ...normalized, id: makeId() }] }];
            }
            return current.map((row) => {
                if (row.id !== editTarget.rowId) return row;
                if (editTarget.buttonId) {
                    return {
                        ...row,
                        buttons: row.buttons.map((item) =>
                            item.id === editTarget.buttonId ? { ...normalized, id: item.id } : item,
                        ),
                    };
                }
                return { ...row, buttons: [...row.buttons, { ...normalized, id: makeId() }] };
            });
        });
        setEditTarget(null);
        impact();
    }

    function deleteButton(rowId: string, buttonId: string) {
        setRows((current) =>
            current.map((row) =>
                row.id === rowId
                    ? { ...row, buttons: row.buttons.filter((button) => button.id !== buttonId) }
                    : row,
            ).filter((row) => row.buttons.length > 0),
        );
    }

    function deleteEditingButton() {
        if (!editTarget?.rowId || !editTarget.buttonId) return;
        deleteButton(editTarget.rowId, editTarget.buttonId);
        setEditTarget(null);
        impact();
    }

    function clearDragPreviewTarget() {
        dragTargetRowIdRef.current = null;
        const current = dragPreviewRef.current;
        if (!current || current.targetRowId === null) return;
        const preview = { ...current, targetRowId: null };
        dragPreviewRef.current = preview;
        setDragPreview(preview);
    }

    function getInsertionPointerX(pointerX: number): number {
        const input = dragInputRef.current;
        if (!input) return pointerX;

        const movement = pointerX - input.lastPointerX;
        if (Math.abs(movement) >= 2) {
            input.horizontalDirection = movement < 0 ? -1 : 1;
        }
        input.lastPointerX = pointerX;

        if (input.pointerType !== "touch" || input.horizontalDirection === 0) {
            return pointerX;
        }

        const floatingButtonWidth = Math.min(
            window.innerWidth * FLOATING_BUTTON_VIEWPORT_WIDTH_RATIO,
            FLOATING_BUTTON_MAX_WIDTH,
        );
        return getLeadingEdgeInsertionX(
            pointerX,
            input.horizontalDirection,
            floatingButtonWidth,
        );
    }

    function updateDragPreviewPosition(activeId: string, destinationRowId: string, overlayCenterX: number) {
        const current = dragPreviewRef.current;
        const destinationRow = rows.find((row) => row.id === destinationRowId);
        const rowElement = rowElementsRef.current.get(destinationRowId);
        const gridElement = rowElement?.querySelector<HTMLElement>(".keyboard-canvas-grid");
        if (!current || !destinationRow || !gridElement) return;

        const visibleButtonCount = destinationRow.buttons.filter((button) => button.id !== activeId).length;
        const gridRect = gridElement.getBoundingClientRect();
        const addButton = gridElement.querySelector<HTMLElement>(".keyboard-add-button-cell");
        const gap = Number.parseFloat(window.getComputedStyle(gridElement).columnGap) || 0;
        const addButtonWidth = addButton?.getBoundingClientRect().width ?? 0;
        const buttonAreaWidth = gridRect.width - (addButton ? addButtonWidth + gap : 0);
        const targetIndex = getRowInsertionIndex(
            visibleButtonCount,
            overlayCenterX,
            gridRect.left,
            buttonAreaWidth,
        );
        if (current.targetRowId === destinationRowId && current.targetIndex === targetIndex) return;

        const preview = { ...current, targetRowId: destinationRowId, targetIndex };
        dragPreviewRef.current = preview;
        setDragPreview(preview);
    }

    function handleDragStart(event: DragStartEvent) {
        if (event.active.data.current?.kind !== "button") return;
        const sourceRowId = event.active.data.current?.rowId as string | undefined;
        const sourceRow = rows.find((row) => row.id === sourceRowId);
        const sourceIndex = sourceRow?.buttons.findIndex((button) => button.id === event.active.id) ?? -1;
        const button = sourceRow?.buttons[sourceIndex];
        if (!sourceRowId || !button || sourceIndex < 0) return;
        const activationPoint = getActivatorPoint(event.activatorEvent);
        dragInputRef.current = activationPoint
            ? {
                pointerType: getPointerType(event.activatorEvent),
                lastPointerX: activationPoint.x,
                horizontalDirection: 0,
            }
            : null;
        const preview = { button, sourceRowId, targetRowId: sourceRowId, targetIndex: sourceIndex };
        dragTargetRowIdRef.current = sourceRowId;
        dragPreviewRef.current = preview;
        setDragPreview(preview);
    }

    function handleDragOver(event: DragOverEvent) {
        const { active, over } = event;
        if (active.data.current?.kind !== "button") return;
        if (!over) {
            clearDragPreviewTarget();
            return;
        }
        if (over.data.current?.kind === "new-row-button-drop") {
            clearDragPreviewTarget();
            return;
        }

        const destinationRowId = over.data.current?.rowId as string | undefined;
        const destinationRow = rows.find((row) => row.id === destinationRowId);
        if (!destinationRowId || !destinationRow) return;
        const containsActive = destinationRow.buttons.some((button) => button.id === active.id);
        if (!containsActive && destinationRow.buttons.length >= MAX_BUTTONS_PER_ROW) {
            clearDragPreviewTarget();
            return;
        }

        dragTargetRowIdRef.current = destinationRowId;
        const activationPoint = getActivatorPoint(event.activatorEvent);
        if (activationPoint) {
            const pointerX = activationPoint.x + event.delta.x;
            updateDragPreviewPosition(
                String(active.id),
                destinationRowId,
                getInsertionPointerX(pointerX),
            );
        }
    }

    function handleDragMove(event: DragMoveEvent) {
        if (event.active.data.current?.kind !== "button") return;
        const destinationRowId = dragTargetRowIdRef.current;
        const activationPoint = getActivatorPoint(event.activatorEvent);
        if (!destinationRowId || !activationPoint) return;
        const pointerX = activationPoint.x + event.delta.x;
        updateDragPreviewPosition(
            String(event.active.id),
            destinationRowId,
            getInsertionPointerX(pointerX),
        );
    }

    function handleDragCancel() {
        dragTargetRowIdRef.current = null;
        dragInputRef.current = null;
        dragPreviewRef.current = null;
        setDragPreview(null);
    }

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        const previewAtDrop = dragPreviewRef.current;
        dragTargetRowIdRef.current = null;
        dragInputRef.current = null;
        dragPreviewRef.current = null;
        setDragPreview(null);
        if (!over || active.id === over.id) return;
        const activeKind = active.data.current?.kind as string | undefined;
        const sourceRowId = active.data.current?.rowId as string | undefined;
        const destinationRowId = over.data.current?.rowId as string | undefined;
        const destinationKind = over.data.current?.kind as string | undefined;

        if (activeKind === "row") {
            if (!sourceRowId || !destinationRowId || sourceRowId === destinationRowId) return;
            setRows((current) => {
                const sourceIndex = current.findIndex((row) => row.id === sourceRowId);
                const destinationIndex = current.findIndex((row) => row.id === destinationRowId);
                return sourceIndex < 0 || destinationIndex < 0
                    ? current
                    : arrayMove(current, sourceIndex, destinationIndex);
            });
            impact();
            return;
        }

        if (activeKind !== "button" || !sourceRowId) return;

        if (destinationKind === "new-row-button-drop") {
            setRows((current) => {
                const sourceRow = current.find((row) => row.id === sourceRowId);
                const moving = sourceRow?.buttons.find((button) => button.id === active.id);
                if (!moving) return current;
                const remainingRows = current
                    .map((row) =>
                        row.id === sourceRowId
                            ? { ...row, buttons: row.buttons.filter((button) => button.id !== active.id) }
                            : row,
                    )
                    .filter((row) => row.buttons.length > 0);
                return [...remainingRows, { id: makeId(), buttons: [moving] }];
            });
            impact();
            return;
        }

        const previewDestinationRowId = previewAtDrop?.targetRowId ?? destinationRowId;
        if (!previewDestinationRowId) return;

        setRows((current) => {
            const sourceRow = current.find((row) => row.id === sourceRowId);
            const destinationRow = current.find((row) => row.id === previewDestinationRowId);
            if (!sourceRow || !destinationRow) return current;

            if (sourceRowId !== previewDestinationRowId && destinationRow.buttons.length >= MAX_BUTTONS_PER_ROW) {
                setNotice({ kind: "error", text: `每行最多 ${MAX_BUTTONS_PER_ROW} 个按钮。` });
                return current;
            }
            const fallbackIndex = destinationRow.buttons.findIndex((button) => button.id === over.id);
            const destinationIndex = previewAtDrop?.targetIndex ??
                (fallbackIndex < 0 ? destinationRow.buttons.length : fallbackIndex);
            return moveButtonToIndex(
                current,
                String(active.id),
                sourceRowId,
                previewDestinationRowId,
                destinationIndex,
            );
        });
        impact();
    }

    async function save() {
        if (!validation.ok) {
            setNotice({ kind: "error", text: validation.error });
            notify("error");
            return;
        }
        if (demo) {
            setRows(toUiRows(validation.keyboard));
            setSavedKeyboard(validation.keyboard);
            setNotice({ kind: "success", text: "演示模式：键盘已保存到当前页面。" });
            notify("success");
            return;
        }

        setSaving(true);
        try {
            const response = await fetch(`/api/messages/${encodeURIComponent(shareId)}`, {
                method: "PUT",
                headers: {
                    "content-type": "application/json",
                    "x-telegram-init-data": tg!.initData,
                },
                body: JSON.stringify({ keyboard }),
            });
            const data = (await response.json()) as { error?: string; keyboard?: EditorKeyboard };
            if (!response.ok) throw new Error(data.error || "保存失败，请稍后重试。");
            const saved = data.keyboard ?? validation.keyboard;
            setRows(toUiRows(saved));
            setSavedKeyboard(saved);
            setNotice({ kind: "success", text: "已更新 Telegram 消息上的 Inline Keyboard。" });
            notify("success");
        } catch (error) {
            setNotice({ kind: "error", text: error instanceof Error ? error.message : "保存失败，请稍后重试。" });
            notify("error");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <AppRoot appearance={appearance}>
                <main className="state-screen"><Spinner size="l" /><p>正在加载编辑器…</p></main>
            </AppRoot>
        );
    }

    if (fatalError || !message) {
        return (
            <AppRoot appearance={appearance}>
                <main className="state-screen error-state">
                    <MessageSquareText size={34} aria-hidden />
                    <Headline>无法打开编辑器</Headline>
                    <p>{fatalError || "消息不存在。"}</p>
                </main>
            </AppRoot>
        );
    }

    return (
        <AppRoot appearance={appearance}>
            <main className="app-page">
                <header className="app-header">
                    <div className="app-mark"><Rows3 size={22} aria-hidden /></div>
                    <div>
                        <h1>Inline Keyboardist</h1>
                        <p>调整按钮、顺序与 Telegram 官方颜色</p>
                    </div>
                </header>

                <DndContext
                    sensors={sensors}
                    collisionDetection={floatingButtonWithinExcludingActive}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragOver={handleDragOver}
                    onDragCancel={handleDragCancel}
                    onDragEnd={handleDragEnd}
                >
                    <Preview
                        message={message}
                        rows={rows}
                        shareId={shareId || DEMO_MESSAGE.id}
                        total={total}
                        dragPreview={dragPreview}
                        onRowElement={registerRowElement}
                        onAddNewRowButton={openNewRowButton}
                        onAddButton={openNewButton}
                        onEditButton={openExistingButton}
                    />
                    <DragOverlay
                        dropAnimation={null}
                        modifiers={[positionFloatingButtonAtPointer]}
                        style={{
                            width: `min(${FLOATING_BUTTON_VIEWPORT_WIDTH_RATIO * 100}vw, ${FLOATING_BUTTON_MAX_WIDTH}px)`,
                            height: FLOATING_BUTTON_HEIGHT,
                        }}
                    >
                        {dragPreview && <ButtonDragOverlay button={dragPreview.button} />}
                    </DragOverlay>
                </DndContext>

                <div className="save-spacer" />
                <footer className="save-bar">
                    <div className="save-status">
                        <span className={`status-dot${dirty ? " is-dirty" : ""}`} />
                        <span>{dirty ? "有尚未保存的修改" : "所有修改均已保存"}</span>
                    </div>
                    <Button
                        className="balanced-action-button"
                        size="l"
                        stretched
                        loading={saving}
                        disabled={!dirty || !validation.ok || saving}
                        before={<Save size={19} aria-hidden />}
                        onClick={save}
                    >
                        保存
                    </Button>
                </footer>
            </main>

            <ButtonEditor
                open={Boolean(editTarget)}
                title={editTarget?.buttonId ? "编辑按钮" : "添加按钮"}
                draft={draft}
                setDraft={(next) => { setDraft(next); setDraftError(null); }}
                error={draftError}
                onClose={() => setEditTarget(null)}
                onSubmit={submitDraft}
                onDelete={editTarget?.buttonId ? deleteEditingButton : undefined}
            />

            {notice && (
                <Snackbar
                    onClose={() => setNotice(null)}
                    before={notice.kind === "success" ? <Check size={20} /> : <X size={20} />}
                    description={notice.kind === "error" ? "请检查后再试" : undefined}
                >
                    {notice.text}
                </Snackbar>
            )}
        </AppRoot>
    );
}
