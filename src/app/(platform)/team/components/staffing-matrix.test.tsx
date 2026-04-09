import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StaffingMatrix } from "./staffing-matrix";
import type { UserData, ProjectData, ClientData, ServiceOfferingData } from "./team-types";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const mockProject: ProjectData = { id: "p1", name: "Project Alpha", status: "ACTIVE", clientId: "c1" };
const mockClient: ClientData = { id: "c1", name: "Client One" };
const mockSO: ServiceOfferingData = { id: "so1", name: "Consulting" };

function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    id: "u1",
    name: "Jane Smith",
    email: "jane@test.com",
    role: "DEVELOPER",
    jobTitle: "Senior Engineer",
    department: "Engineering",
    location: "New York",
    avatar: null,
    managerId: "m1",
    manager: { id: "m1", name: "Bob Manager" },
    directReports: [],
    isActive: true,
    projectMembers: [],
    assignments: [
      {
        id: "a1",
        allocationFte: 0.6,
        status: "ACTIVE",
        role: "Lead",
        function: "Development",
        notes: null,
        startDate: null,
        endDate: null,
        project: { id: "p1", name: "Project Alpha", status: "ACTIVE" },
        client: { id: "c1", name: "Client One" },
        serviceOffering: { id: "so1", name: "Consulting" },
      },
      {
        id: "a2",
        allocationFte: 0.3,
        status: "ACTIVE",
        role: "Member",
        function: "QA",
        notes: null,
        startDate: null,
        endDate: null,
        project: { id: "p2", name: "Project Beta", status: "ACTIVE" },
        client: null,
        serviceOffering: null,
      },
    ],
    ...overrides,
  };
}

describe("StaffingMatrix", () => {
  const defaultProps = {
    users: [makeUser()],
    projects: [mockProject, { id: "p2", name: "Project Beta", status: "ACTIVE", clientId: "c1" }],
    clients: [mockClient],
    serviceOfferings: [mockSO],
    search: "",
  };

  it("renders summary metrics", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Headcount")).toBeInTheDocument();
    expect(screen.getByText("Total Allocated FTE")).toBeInTheDocument();
    expect(screen.getByText("Available Capacity")).toBeInTheDocument();
  });

  it("renders employee name", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it("shows total FTE for employee", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // 0.6 + 0.3 = 0.9 — appears in summary metric, row, and footer
    const allFte = screen.getAllByText("0.90");
    expect(allFte.length).toBeGreaterThanOrEqual(1);
  });

  it("renders dynamic columns for projects", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    expect(screen.getByText("Project Beta")).toBeInTheDocument();
  });

  it("allows switching dimensions", () => {
    render(<StaffingMatrix {...defaultProps} />);
    const select = screen.getByDisplayValue("Project");
    fireEvent.change(select, { target: { value: "client" } });
    expect(screen.getByText("Client One")).toBeInTheDocument();
  });

  it("shows 'Available' badge for underallocated employee", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("shows overallocated warning", () => {
    const overUser = makeUser({
      id: "u2",
      name: "Over User",
      assignments: [
        {
          id: "a3", allocationFte: 0.7, status: "ACTIVE", role: null,
          function: null, notes: null, startDate: null, endDate: null,
          project: { id: "p1", name: "Project Alpha", status: "ACTIVE" },
          client: null, serviceOffering: null,
        },
        {
          id: "a4", allocationFte: 0.5, status: "ACTIVE", role: null,
          function: null, notes: null, startDate: null, endDate: null,
          project: { id: "p2", name: "Project Beta", status: "ACTIVE" },
          client: null, serviceOffering: null,
        },
      ],
    });
    render(<StaffingMatrix {...defaultProps} users={[overUser]} />);
    expect(screen.getByText("Over")).toBeInTheDocument();
  });

  it("filters employees by search", () => {
    render(<StaffingMatrix {...defaultProps} search="nonexistent" />);
    expect(screen.getByText(/No employees match/)).toBeInTheDocument();
  });

  it("expands row on click to show assignment details", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // The expand button is the one inside the table row with the chevron
    const rows = screen.getAllByRole("row");
    // Row 0 is header, row 1 is the data row
    const dataRow = rows[1];
    const expandBtn = dataRow.querySelector("button");
    if (expandBtn) fireEvent.click(expandBtn);
    // Should show assignment count text
    expect(screen.getByText(/2 assignments/i)).toBeInTheDocument();
  });
});
