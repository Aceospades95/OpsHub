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

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Mock react-dom useFormState
vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom");
  return {
    ...actual,
    useFormState: () => [null, vi.fn()],
  };
});

// Mock server action modules to avoid next-auth import chain
vi.mock("@/actions/assignments", () => ({
  createAssignment: vi.fn(),
  createServiceOffering: vi.fn(),
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
        notes: "Primary assignment",
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
        serviceOffering: { id: "so2", name: "Data Center & Infra" },
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
    canManage: false,
  };

  it("renders summary metrics", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Headcount")).toBeInTheDocument();
    // "Total FTE" appears in both the metric card and footer
    const totalFteElements = screen.getAllByText("Total FTE");
    expect(totalFteElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Assignments")).toBeInTheDocument();
  });

  it("renders column headers for assignment-row layout", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Offering")).toBeInTheDocument();
    expect(screen.getByText("Manager / Lead")).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Role Required")).toBeInTheDocument();
    expect(screen.getByText("FTE")).toBeInTheDocument();
    expect(screen.getByText("Employee(s)")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
  });

  it("renders employee name in assignment rows", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // Jane appears in both assignment rows (two different assignments)
    const janeElements = screen.getAllByText("Jane Smith");
    expect(janeElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders project names in assignment rows", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    expect(screen.getByText("Project Beta")).toBeInTheDocument();
  });

  it("renders client name in assignment rows", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // "Client One" appears in filter dropdown and in the table row
    const clientElements = screen.getAllByText("Client One");
    expect(clientElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows offering group headers", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // Offering names appear in both filter dropdown and group headers
    const consultingElements = screen.getAllByText("Consulting");
    expect(consultingElements.length).toBeGreaterThanOrEqual(1);
    const dcElements = screen.getAllByText("Data Center & Infra");
    expect(dcElements.length).toBeGreaterThanOrEqual(1);
  });

  it("displays FTE values in assignment rows", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // 0.60 and 0.30 appear in rows, 0.90 in footer
    const allFte = screen.getAllByText("0.60");
    expect(allFte.length).toBeGreaterThanOrEqual(1);
    const allFte2 = screen.getAllByText("0.30");
    expect(allFte2.length).toBeGreaterThanOrEqual(1);
  });

  it("shows manager name in assignment rows", () => {
    render(<StaffingMatrix {...defaultProps} />);
    const managerLinks = screen.getAllByText("Bob Manager");
    expect(managerLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("shows role badges in assignment rows", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("shows notes in assignment rows", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Primary assignment")).toBeInTheDocument();
  });

  it("shows overallocated metric count", () => {
    const overUser = makeUser({
      id: "u2",
      name: "Over User",
      assignments: [
        {
          id: "a3", allocationFte: 0.7, status: "ACTIVE", role: null,
          function: null, notes: null, startDate: null, endDate: null,
          project: { id: "p1", name: "Project Alpha", status: "ACTIVE" },
          client: null, serviceOffering: { id: "so1", name: "Consulting" },
        },
        {
          id: "a4", allocationFte: 0.5, status: "ACTIVE", role: null,
          function: null, notes: null, startDate: null, endDate: null,
          project: { id: "p2", name: "Project Beta", status: "ACTIVE" },
          client: null, serviceOffering: { id: "so1", name: "Consulting" },
        },
      ],
    });
    render(<StaffingMatrix {...defaultProps} users={[overUser]} />);
    expect(screen.getByText("Overallocated")).toBeInTheDocument();
  });

  it("filters rows by search on employee name", () => {
    render(<StaffingMatrix {...defaultProps} search="nonexistent" />);
    expect(screen.getByText(/No assignments match/)).toBeInTheDocument();
  });

  it("filters rows by search matching assignment fields", () => {
    render(<StaffingMatrix {...defaultProps} search="Alpha" />);
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
  });

  it("offering group headers are clickable", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // Verify group headers render and are clickable without errors
    const consultingHeaders = screen.getAllByText("Consulting");
    const groupHeader = consultingHeaders.find((el) => el.closest("tr"))!;
    expect(groupHeader).toBeInTheDocument();
    // Click should not throw
    fireEvent.click(groupHeader.closest("tr")!);
  });

  it("shows unassigned employees as separate rows", () => {
    const unassignedUser = makeUser({
      id: "u3",
      name: "New Hire",
      assignments: [],
    });
    render(<StaffingMatrix {...defaultProps} users={[...defaultProps.users, unassignedUser]} />);
    expect(screen.getByText("New Hire")).toBeInTheDocument();
    // "Unassigned" appears in metric card label and as an offering group header
    const unassignedElements = screen.getAllByText("Unassigned");
    expect(unassignedElements.length).toBeGreaterThanOrEqual(2);
  });

  it("shows Add Assignment button when canManage is true", () => {
    render(<StaffingMatrix {...defaultProps} canManage={true} />);
    expect(screen.getByText("Add Assignment")).toBeInTheDocument();
  });

  it("shows Manage Offerings button when canManage is true", () => {
    render(<StaffingMatrix {...defaultProps} canManage={true} />);
    expect(screen.getByText("Manage Offerings")).toBeInTheDocument();
  });

  it("hides management buttons when canManage is false", () => {
    render(<StaffingMatrix {...defaultProps} canManage={false} />);
    expect(screen.queryByText("Add Assignment")).not.toBeInTheDocument();
    expect(screen.queryByText("Manage Offerings")).not.toBeInTheDocument();
  });

  it("shows footer total FTE", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // Total FTE: 0.60 + 0.30 = 0.90
    const totalFteElements = screen.getAllByText("0.90");
    expect(totalFteElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders filter dropdowns", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("All Offerings")).toBeInTheDocument();
  });

  it("shows project members without assignments as 'Project Staffing' rows", () => {
    const userWithProjectOnly = makeUser({
      id: "u4",
      name: "Project Person",
      assignments: [],
      projectMembers: [
        { role: "CONTRIBUTOR", project: { id: "p3", name: "Project Gamma", status: "ACTIVE", clientId: "c1" } },
      ],
    });
    render(<StaffingMatrix {...defaultProps} users={[userWithProjectOnly]} />);
    expect(screen.getByText("Project Person")).toBeInTheDocument();
    expect(screen.getByText("Project Gamma")).toBeInTheDocument();
    // Should show under "Project Staffing" offering group
    const projectStaffing = screen.getAllByText("Project Staffing");
    expect(projectStaffing.length).toBeGreaterThanOrEqual(1);
  });

  it("does not duplicate project members that already have assignments", () => {
    // User has an assignment to p1 AND is a project member of p1
    const userWithBoth = makeUser({
      id: "u5",
      name: "Dual Person",
      projectMembers: [
        { role: "CONTRIBUTOR", project: { id: "p1", name: "Project Alpha", status: "ACTIVE", clientId: "c1" } },
      ],
    });
    render(<StaffingMatrix {...defaultProps} users={[userWithBoth]} />);
    // "Dual Person" should appear but NOT under "Project Staffing" since they have an assignment for p1
    const projectStaffing = screen.queryAllByText("Project Staffing");
    expect(projectStaffing.length).toBe(0);
  });

  it("shows 'Create assignment' link for project-member rows when canManage", () => {
    const userWithProjectOnly = makeUser({
      id: "u6",
      name: "Needs Assignment",
      assignments: [],
      projectMembers: [
        { role: "DEVELOPER", project: { id: "p3", name: "Project Gamma", status: "ACTIVE", clientId: "c1" } },
      ],
    });
    render(<StaffingMatrix {...defaultProps} users={[userWithProjectOnly]} canManage={true} />);
    expect(screen.getByText("Create assignment")).toBeInTheDocument();
  });
});
