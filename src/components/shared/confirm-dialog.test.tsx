import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ConfirmDialog } from "./confirm-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => cleanup());

/**
 * R10-2 first wired role="alertdialog" + aria-labelledby/describedby
 * + initial focus + Escape-closes onto the shared Dialog. R11-H
 * corrects the initial-focus target to the Cancel button so a
 * keyboard user who hits Enter on a re-opened dialog defaults to
 * the safe outcome. These tests pin both invariants so a future
 * Dialog refactor can't silently regress either piece.
 */
describe("ConfirmDialog", () => {
  function setup(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue({ success: true });
    const utils = render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete Project"
        message="Are you sure you want to delete Project Alpha?"
        confirmLabel="Delete"
        {...overrides}
      />
    );
    return { onClose, onConfirm, ...utils };
  }

  it("renders with role=alertdialog and aria-labelledby/describedby pointing at real nodes", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeTruthy();

    const labelledBy = dialog.getAttribute("aria-labelledby");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();

    const titleNode = document.getElementById(labelledBy!);
    const messageNode = document.getElementById(describedBy!);
    expect(titleNode?.textContent).toBe("Delete Project");
    expect(messageNode?.textContent).toContain("Are you sure");
  });

  it("focuses the Cancel button (the safe option) on open", async () => {
    // Keyboard-default to the safe outcome — a user who hits Enter
    // on a re-opened destructive dialog should NOT confirm. ARIA
    // APG's alertdialog example uses the same pattern.
    setup();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
  });

  it("calls onClose when Escape is pressed", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("aria-modal is true so SR users know the rest of the page is inert", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});
