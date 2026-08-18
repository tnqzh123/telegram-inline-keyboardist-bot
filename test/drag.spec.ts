import { describe, expect, it } from "vitest";
import {
    getFloatingOverlayTransformOffset,
    getLeadingEdgeInsertionX,
    getRectCenter,
    getRowInsertionIndex,
    moveButtonToIndex,
} from "../app/src/drag";

describe("floating button drag geometry", () => {
    it("positions the overlay center directly under the pointer", () => {
        const offset = getFloatingOverlayTransformOffset(
            { x: 20, y: 100, width: 112, height: 32 },
            { x: 80, y: 121 },
            { x: 0, y: 0 },
        );

        expect(offset).toEqual({ x: 4, y: 5 });
        // Initial rect + offset has center (80, 121), exactly matching the pointer.
    });

    it("uses the visible overlay center as the drop target", () => {
        expect(getRectCenter({ x: 100, y: 200, width: 112, height: 32 })).toEqual({
            x: 156,
            y: 216,
        });
    });

    it("keeps the overlay center on the pointer throughout movement", () => {
        const draggingRect = { x: 20, y: 100, width: 112, height: 32 };
        const activationPoint = { x: 80, y: 121 };
        const movement = { x: -37, y: 12 };
        const offset = getFloatingOverlayTransformOffset(
            draggingRect,
            activationPoint,
            { x: 0, y: 0 },
        );
        const draggingCenter = getRectCenter(draggingRect);

        expect({
            x: draggingCenter.x + movement.x + offset.x,
            y: draggingCenter.y + movement.y + offset.y,
        }).toEqual({
            x: activationPoint.x + movement.x,
            y: activationPoint.y + movement.y,
        });
    });
});

describe("button drag insertion preview", () => {
    it("divides the button area into every reachable insertion slot", () => {
        expect(getRowInsertionIndex(2, 25, 0, 300)).toBe(0);
        expect(getRowInsertionIndex(2, 125, 0, 300)).toBe(1);
        expect(getRowInsertionIndex(2, 275, 0, 300)).toBe(2);
    });

    it("does not include the trailing add button in the button area width", () => {
        const gridWidth = 344;
        const addButtonWidth = 44;
        const gap = 3;
        const buttonAreaWidth = gridWidth - addButtonWidth - gap;

        expect(getRowInsertionIndex(2, 210, 0, buttonAreaWidth)).toBe(2);
    });

    it("handles the first button in an otherwise empty row", () => {
        expect(getRowInsertionIndex(0, 150, 0, 300)).toBe(0);
    });

    it("uses the floating button's leading edge for a leftward touch drag", () => {
        const pointerX = 190;
        const insertionX = getLeadingEdgeInsertionX(pointerX, -1, 112);

        expect(getRowInsertionIndex(2, pointerX, 58, 258)).toBe(1);
        expect(insertionX).toBe(134);
        expect(getRowInsertionIndex(2, insertionX, 58, 258)).toBe(0);
    });

    it("uses the opposite leading edge after reversing direction", () => {
        expect(getLeadingEdgeInsertionX(190, 1, 112)).toBe(246);
        expect(getLeadingEdgeInsertionX(190, 0, 112)).toBe(190);
    });
});

describe("button drag placement", () => {
    it("inserts a cross-row button at the first preview position", () => {
        const rows = [
            { id: "target", buttons: [{ id: "a" }, { id: "b" }, { id: "c" }] },
            { id: "source", buttons: [{ id: "moving" }] },
        ];

        expect(moveButtonToIndex(rows, "moving", "source", "target", 0)).toEqual([
            { id: "target", buttons: [{ id: "moving" }, { id: "a" }, { id: "b" }, { id: "c" }] },
        ]);
    });

    it("moves a same-row button to the first preview position", () => {
        const rows = [
            { id: "row", buttons: [{ id: "a" }, { id: "b" }, { id: "c" }] },
        ];

        expect(moveButtonToIndex(rows, "c", "row", "row", 0)[0].buttons).toEqual([
            { id: "c" },
            { id: "a" },
            { id: "b" },
        ]);
    });

    it("uses an end index after removing the source button", () => {
        const rows = [
            { id: "row", buttons: [{ id: "a" }, { id: "b" }, { id: "c" }] },
        ];

        expect(moveButtonToIndex(rows, "a", "row", "row", 2)[0].buttons).toEqual([
            { id: "b" },
            { id: "c" },
            { id: "a" },
        ]);
    });
});
