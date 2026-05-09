import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ConfirmDialog } from "./confirm-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => cleanup());

/**
 * Round-10 QA: the project-delete dialog used to be a plain <div>
 * with no role. Screen-reader users couldn't tell it was a
 * confirmation, the destructive button wasn't focused, and Escape
 * didn't close. ConfirmDialog now layers role="alertdialog",
 * aria-labelledby/describedby, an initial-focus ref, and an
 * Escape-closes handler on top of the shared Dialog. These tests
 * pin those invariants so a future Dialog refactor can't silently
 * regress accessibility.
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

  it("focuses the destructive confirm button on open", async () => {
    setup();
    // The Dialog defers focus to the next animation frame so it
    // beats React's commit phase. Wait a tick so the focus has
    // landed before we assert.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(document.activeElement).toBe(confirm);
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
