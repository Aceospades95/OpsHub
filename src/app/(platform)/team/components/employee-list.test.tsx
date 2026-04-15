import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmployeeList } from "./employee-list";
import type { UserData } from "./team-types";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    id: "u1",
    name: "Alice Johnson",
    email: "alice@test.com",
    role: "DEVELOPER",
    jobTitle: "Frontend Developer",
    department: "Engineering",
    location: "San Francisco",
    avatar: null,
    managerId: "m1",
    manager: { id: "m1", name: "Bob Manager" },
    directReports: [],
    isActive: true,
    projectMembers: [],
    assignments: [
      {
        id: "a1",
        allocationFte: 0.5,
        status: "ACTIVE",
        role: "Developer",
        function: "Development",
        notes: null,
        startDate: null,
        endDate: null,
        project: { id: "p1", name: "Project Alpha", status: "ACTIVE" },
        client: null,
        serviceOffering: null,
        projectRoleId: null,
        projectRole: null,
        roleDefinition: null,
      },
    ],
    ...overrides,
  };
}

describe("EmployeeList", () => {
  const defaultProps = {
    users: [
      makeUser(),
      makeUser({
        id: "u2",
        name: "Charlie Wilson",
        email: "charlie@test.com",
        department: "Design",
        location: "London",
        role: "MANAGER",
        manager: { id: "m2", name: "Dana Director" },
        assignments: [],
      }),
    ],
    inactiveUsers: [
      makeUser({
        id: "u3",
        name: "Former Employee",
        email: "former@test.com",
        isActive: false,
        assignments: [],
      }),
    ],
    search: "",
  };

  it("renders employee names", () => {
    render(<EmployeeList {...defaultProps} />);
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.getByText("Charlie Wilson")).toBeInTheDocument();
  });

  it("shows quick stats bar", () => {
    render(<EmployeeList {...defaultProps} />);
    expect(screen.getByText("2 employees")).toBeInTheDocument();
  });

  it("shows FTE allocation", () => {
    render(<EmployeeList {...defaultProps} />);
    // Alice has 0.50 FTE
    expect(screen.getByText("0.50")).toBeInTheDocument();
  });

  it("shows allocation status badges", () => {
    render(<EmployeeList {...defaultProps} />);
    // Alice is underallocated, Charlie is unassigned
    // "Available" appears in both the filter dropdown option and a badge
    const availableBadges = screen.getAllByText("Available");
    expect(availableBadges.length).toBeGreaterThanOrEqual(1);
    const unassignedBadges = screen.getAllByText("Unassigned");
    expect(unassignedBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by search", () => {
    render(<EmployeeList {...defaultProps} search="alice" />);
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.queryByText("Charlie Wilson")).not.toBeInTheDocument();
  });

  it("filters by department", () => {
    render(<EmployeeList {...defaultProps} />);
    const deptSelect = screen.getByDisplayValue("All Departments");
    fireEvent.change(deptSelect, { target: { value: "Engineering" } });
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.queryByText("Charlie Wilson")).not.toBeInTheDocument();
  });

  it("filters by role", () => {
    render(<EmployeeList {...defaultProps} />);
    const roleSelect = screen.getByDisplayValue("All Roles");
    fireEvent.change(roleSelect, { target: { value: "MANAGER" } });
    expect(screen.queryByText("Alice Johnson")).not.toBeInTheDocument();
    expect(screen.getByText("Charlie Wilson")).toBeInTheDocument();
  });

  it("shows inactive employees when toggled", () => {
    render(<EmployeeList {...defaultProps} />);
    // Click to show former employees
    const formerBtn = screen.getByText(/Former Employees/);
    fireEvent.click(formerBtn);
    expect(screen.getByText("Former Employee")).toBeInTheDocument();
  });

  it("links employees to detail page", () => {
    render(<EmployeeList {...defaultProps} />);
    const link = screen.getByText("Alice Johnson").closest("a");
    expect(link).toHaveAttribute("href", "/team/u1");
  });

  it("expands row to show assignment details", () => {
    render(<EmployeeList {...defaultProps} />);
    // The expand button is inside the table row
    const rows = screen.getAllByRole("row");
    // Row 0 is header, Row 1 is Alice
    const aliceRow = rows[1];
    const expandBtn = aliceRow.querySelector("button");
    if (expandBtn) fireEvent.click(expandBtn);
    // Should show the assignment
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
  });

  it("shows capacity bar in expanded detail", () => {
    render(<EmployeeList {...defaultProps} />);
    const rows = screen.getAllByRole("row");
    const aliceRow = rows[1];
    const expandBtn = aliceRow.querySelector("button");
    if (expandBtn) fireEvent.click(expandBtn);
    expect(screen.getByText("Capacity Usage")).toBeInTheDocument();
  });

  it("filters by allocation status", () => {
    render(<EmployeeList {...defaultProps} />);
    const allocSelect = screen.getByDisplayValue("All Allocations");
    fireEvent.change(allocSelect, { target: { value: "unassigned" } });
    expect(screen.queryByText("Alice Johnson")).not.toBeInTheDocument();
    expect(screen.getByText("Charlie Wilson")).toBeInTheDocument();
  });
});
