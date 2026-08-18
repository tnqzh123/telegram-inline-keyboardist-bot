export type DraggableButton = { id: string };
export type DraggableRow<T extends DraggableButton> = { id: string; buttons: T[] };
export type DragPoint = { x: number; y: number };
export type DragRect = DragPoint & { width: number; height: number };

export function getRectCenter(rect: DragRect): DragPoint {
    return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
    };
}

export function getFloatingOverlayTransformOffset(
    draggingRect: DragRect,
    activationPoint: DragPoint,
    centerOffset: DragPoint,
): DragPoint {
    const draggingCenter = getRectCenter(draggingRect);
    return {
        x: activationPoint.x - draggingCenter.x + centerOffset.x,
        y: activationPoint.y - draggingCenter.y + centerOffset.y,
    };
}

export function getRowInsertionIndex(
    visibleButtonCount: number,
    pointerX: number,
    buttonAreaLeft: number,
    buttonAreaWidth: number,
): number {
    const slotCount = Math.max(1, visibleButtonCount + 1);
    if (buttonAreaWidth <= 0) return slotCount - 1;
    const relativeX = Math.max(0, Math.min(pointerX - buttonAreaLeft, buttonAreaWidth));
    return Math.min(slotCount - 1, Math.floor(relativeX / (buttonAreaWidth / slotCount)));
}

export function getLeadingEdgeInsertionX(
    pointerX: number,
    horizontalDirection: -1 | 0 | 1,
    overlayWidth: number,
): number {
    return pointerX + horizontalDirection * Math.max(0, overlayWidth) / 2;
}

export function moveButtonToIndex<
    T extends DraggableButton,
    R extends DraggableRow<T>,
>(
    rows: R[],
    buttonId: string,
    sourceRowId: string,
    targetRowId: string,
    targetIndex: number,
): R[] {
    const sourceRow = rows.find((row) => row.id === sourceRowId);
    const targetRow = rows.find((row) => row.id === targetRowId);
    const moving = sourceRow?.buttons.find((button) => button.id === buttonId);
    if (!sourceRow || !targetRow || !moving) return rows;

    if (sourceRowId === targetRowId) {
        const buttons = sourceRow.buttons.filter((button) => button.id !== buttonId);
        buttons.splice(Math.max(0, Math.min(targetIndex, buttons.length)), 0, moving);
        return rows.map((row) => row.id === sourceRowId ? { ...row, buttons } : row) as R[];
    }

    const insertionIndex = Math.max(0, Math.min(targetIndex, targetRow.buttons.length));
    return rows
        .map((row) => {
            if (row.id === sourceRowId) {
                return { ...row, buttons: row.buttons.filter((button) => button.id !== buttonId) };
            }
            if (row.id === targetRowId) {
                const buttons = [...row.buttons];
                buttons.splice(insertionIndex, 0, moving);
                return { ...row, buttons };
            }
            return row;
        })
        .filter((row) => row.buttons.length > 0) as R[];
}
