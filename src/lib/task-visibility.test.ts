import { describe, expect, it } from "vitest";
import { PUBLIC_TASKS_ONLY, taskVisibilityWhere } from "./task-visibility";

describe("taskVisibilityWhere", () => {
  it("admits public tasks plus the viewer's own private ones — nothing else", () => {
    expect(taskVisibilityWhere("user_1")).toEqual({
      OR: [
        { visibility: "PUBLIC" },
        { createdById: "user_1" },
        { assigneeId: "user_1" },
      ],
    });
  });

  it("viewer-less surfaces get public-only", () => {
    expect(PUBLIC_TASKS_ONLY).toEqual({ visibility: "PUBLIC" });
  });
});
