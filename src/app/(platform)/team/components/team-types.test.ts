import { describe, it, expect } from "vitest";
import {
  getAllocationStatus,
  getAllocationBadge,
  computeEmployeeFte,
  formatFte,
} from "./team-types";
import type { UserData } from "./team-types";

function makeUser(assignments: { allocationFte: number; status?: string }[]): UserData {
  return {
    id: "u1",
    name: "Test User",
    email: "test@test.com",
    role: "DEVELOPER",
    jobTitle: null,
    department: null,
    location: null,
    avatar: null,
    managerId: null,
    manager: null,
    directReports: [],
    isActive: true,
    projectMembers: [],
    assignments: assignments.map((a, i) => ({
      id: `a${i}`,
      allocationFte: a.allocationFte,
      status: a.status || "ACTIVE",
      role: null,
      function: null,
      notes: null,
      startDate: null,
      endDate: null,
      project: null,
      client: null,
      serviceOffering: null,
      projectRoleId: null,
      projectRole: null,
      roleDefinition: null,
    })),
  };
}

describe("getAllocationStatus", () => {
  it("returns 'unassigned' for 0 FTE", () => {
    expect(getAllocationStatus(0)).toBe("unassigned");
  });

  it("returns 'overallocated' for > 1.0 FTE", () => {
    expect(getAllocationStatus(1.5)).toBe("overallocated");
    expect(getAllocationStatus(1.01)).toBe("overallocated");
  });

  it("returns 'fully-allocated' for >= 0.95 and <= 1.0", () => {
    expect(getAllocationStatus(1.0)).toBe("fully-allocated");
    expect(getAllocationStatus(0.95)).toBe("fully-allocated");
    expect(getAllocationStatus(0.97)).toBe("fully-allocated");
  });

  it("returns 'underallocated' for > 0 and < 0.95", () => {
    expect(getAllocationStatus(0.5)).toBe("underallocated");
    expect(getAllocationStatus(0.1)).toBe("underallocated");
    expect(getAllocationStatus(0.94)).toBe("underallocated");
  });
});

describe("getAllocationBadge", () => {
  it("returns correct labels", () => {
    expect(getAllocationBadge("overallocated").label).toBe("Over");
    expect(getAllocationBadge("fully-allocated").label).toBe("Full");
    expect(getAllocationBadge("underallocated").label).toBe("Available");
    expect(getAllocationBadge("unassigned").label).toBe("Unassigned");
  });

  it("returns non-empty classNames", () => {
    expect(getAllocationBadge("overallocated").className).toBeTruthy();
    expect(getAllocationBadge("fully-allocated").className).toBeTruthy();
  });
});

describe("computeEmployeeFte", () => {
  it("returns 0 for no assignments", () => {
    const user = makeUser([]);
    expect(computeEmployeeFte(user)).toBe(0);
  });

  it("sums all assignment FTEs", () => {
    const user = makeUser([
      { allocationFte: 0.5 },
      { allocationFte: 0.3 },
      { allocationFte: 0.2 },
    ]);
    expect(computeEmployeeFte(user)).toBeCloseTo(1.0);
  });

  it("handles overallocation", () => {
    const user = makeUser([
      { allocationFte: 0.8 },
      { allocationFte: 0.5 },
    ]);
    expect(computeEmployeeFte(user)).toBeCloseTo(1.3);
  });

  it("handles single assignment", () => {
    const user = makeUser([{ allocationFte: 0.75 }]);
    expect(computeEmployeeFte(user)).toBe(0.75);
  });
});

describe("formatFte", () => {
  it("formats whole numbers without decimals", () => {
    expect(formatFte(1)).toBe("1");
    expect(formatFte(0)).toBe("0");
    expect(formatFte(2)).toBe("2");
  });

  it("formats decimals to 2 places", () => {
    expect(formatFte(0.5)).toBe("0.50");
    expect(formatFte(0.25)).toBe("0.25");
    expect(formatFte(1.33)).toBe("1.33");
  });
});
