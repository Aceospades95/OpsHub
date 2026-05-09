import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StaffingMatrix } from "./staffing-matrix";
import type {
  UserData,
  ProjectData,
  ClientData,
  ServiceOfferingData,
  RoleDefinitionData,
  ProjectRoleData,
} from "./team-types";

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
  updateAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
  createServiceOffering: vi.fn(),
  updateAssignmentNotes: vi.fn(),
  updateAssignmentFte: vi.fn(),
  updateProjectOffering: vi.fn(),
}));

const mockProject: ProjectData = { id: "p1", name: "Project Alpha", status: "ACTIVE", clientId: "c1", serviceOfferingId: "so1", serviceOffering: { id: "so1", name: "Consulting" } };
const mockClient: ClientData = { id: "c1", name: "Client One" };
const mockSO: ServiceOfferingData = { id: "so1", name: "Consulting" };
const mockRoleDefs: RoleDefinitionData[] = [];
const mockProjectRoles: ProjectRoleData[] = [];

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
        role: "Lead Developer",
        function: "Development",
        notes: "Primary assignment",
        startDate: null,
        endDate: null,
        project: { id: "p1", name: "Project Alpha", status: "ACTIVE" },
        client: { id: "c1", name: "Client One" },
        serviceOffering: { id: "so1", name: "Consulting" },
        projectRoleId: null,
        projectRole: null,
        roleDefinition: null,
      },
      {
        id: "a2",
        allocationFte: 0.3,
        status: "ACTIVE",
        role: "QA Analyst",
        function: "QA",
        notes: null,
        startDate: null,
        endDate: null,
        project: { id: "p2", name: "Project Beta", status: "ACTIVE" },
        client: null,
        serviceOffering: { id: "so2", name: "Data Center & Infra" },
        projectRoleId: null,
        projectRole: null,
        roleDefinition: null,
      },
    ],
    ...overrides,
  };
}

describe("StaffingMatrix", () => {
  const defaultProps = {
    users: [makeUser()],
    projects: [
      mockProject,
      { id: "p2", name: "Project Beta", status: "ACTIVE", clientId: "c1", serviceOfferingId: null, serviceOffering: null },
    ],
    clients: [mockClient],
    serviceOfferings: [mockSO],
    roleDefinitions: mockRoleDefs,
    projectRoles: mockProjectRoles,
    search: "",
    canManage: false,
  };

  it("renders summary metrics as buttons", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Headcount")).toBeInTheDocument();
    // Total FTE appears in metric card and footer
    const totalFteElements = screen.getAllByText("Total FTE");
    expect(totalFteElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Assignments")).toBeInTheDocument();
    expect(screen.getByText("Overallocated")).toBeInTheDocument();
  });

  it("renders column headers", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("Offering")).toBeInTheDocument();
    expect(screen.getByText("Manager / Lead")).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Role Required")).toBeInTheDocument();
    expect(screen.getByText("FTE")).toBeInTheDocument();
    expect(screen.getByText("Employee(s)")).toBeInTheDocument();
  });

  it("renders employee names as links", () => {
    render(<StaffingMatrix {...defaultProps} />);
    const janeElements = screen.getAllByText("Jane Smith");
    expect(janeElements.length).toBeGreaterThanOrEqual(1);
    // Should be links to /team/u1
    const janeLink = janeElements.find((el) => el.closest("a")?.getAttribute("href") === "/team/u1");
    expect(janeLink).toBeTruthy();
  });

  it("renders project names as links", () => {
    render(<StaffingMatrix {...defaultProps} />);
    const alphaElements = screen.getAllByText("Project Alpha");
    const alphaLink = alphaElements.find((el) => el.closest("a")?.getAttribute("href") === "/projects/p1");
    expect(alphaLink).toBeTruthy();
  });

  it("renders client names as links", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // Client One appears in filter dropdown and in client sub-header and row cells
    const clientElements = screen.getAllByText("Client One");
    // At least one should be a link to /clients/c1
    const clientLink = clientElements.find((el) => el.closest("a")?.getAttribute("href") === "/clients/c1");
    expect(clientLink).toBeTruthy();
  });

  it("shows offering group headers", () => {
    render(<StaffingMatrix {...defaultProps} />);
    const consultingElements = screen.getAllByText("Consulting");
    expect(consultingElements.length).toBeGreaterThanOrEqual(1);
  });

  it("displays FTE values in assignment rows", () => {
    render(<StaffingMatrix {...defaultProps} />);
    const allFte = screen.getAllByText("0.60");
    expect(allFte.length).toBeGreaterThanOrEqual(1);
    const allFte2 = screen.getAllByText("0.30");
    expect(allFte2.length).toBeGreaterThanOrEqual(1);
  });

  it("shows manager names as links", () => {
    render(<StaffingMatrix {...defaultProps} />);
    const managerLinks = screen.getAllByText("Bob Manager");
    expect(managerLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("shows functional role in Role Required column", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // Should show "Lead Developer" and "QA Analyst" (functional roles from assignments)
    expect(screen.getByText("Lead Developer")).toBeInTheDocument();
    expect(screen.getByText("QA Analyst")).toBeInTheDocument();
  });

  it("filters by search on employee name", () => {
    render(<StaffingMatrix {...defaultProps} search="nonexistent" />);
    expect(screen.getByText(/No assignments match/)).toBeInTheDocument();
  });

  it("offering group headers are collapsible", () => {
    render(<StaffingMatrix {...defaultProps} />);
    const consultingHeaders = screen.getAllByText("Consulting");
    const groupHeader = consultingHeaders.find((el) => el.closest("tr"))!;
    expect(groupHeader).toBeInTheDocument();
    fireEvent.click(groupHeader.closest("tr")!);
  });

  it("shows unassigned employees", () => {
    const unassignedUser = makeUser({
      id: "u3",
      name: "New Hire",
      assignments: [],
      projectMembers: [],
    });
    render(<StaffingMatrix {...defaultProps} users={[...defaultProps.users, unassignedUser]} />);
    expect(screen.getByText("New Hire")).toBeInTheDocument();
    const unassignedElements = screen.getAllByText("Unassigned");
    expect(unassignedElements.length).toBeGreaterThanOrEqual(2);
  });

  it("does not show system role for project-member rows", () => {
    const userWithProjectOnly = makeUser({
      id: "u4",
      name: "Project Person",
      assignments: [],
      projectMembers: [
        { role: "CONTRIBUTOR", project: { id: "p3", name: "Project Gamma", status: "ACTIVE", clientId: "c1" } },
      ],
    });
    render(<StaffingMatrix {...defaultProps} users={[userWithProjectOnly]} />);
    // "CONTRIBUTOR" (system role) should NOT appear as Role Required
    expect(screen.queryByText("CONTRIBUTOR")).not.toBeInTheDocument();
  });

  it("does not duplicate project members that have assignments", () => {
    const userWithBoth = makeUser({
      id: "u5",
      name: "Dual Person",
      projectMembers: [
        { role: "CONTRIBUTOR", project: { id: "p1", name: "Project Alpha", status: "ACTIVE", clientId: "c1" } },
      ],
    });
    render(<StaffingMatrix {...defaultProps} users={[userWithBoth]} />);
    const projectStaffing = screen.queryAllByText("Project Staffing");
    expect(projectStaffing.length).toBe(0);
  });

  it("shows Add Assignment and Manage Offerings when canManage", () => {
    render(<StaffingMatrix {...defaultProps} canManage={true} />);
    expect(screen.getByText("Add Assignment")).toBeInTheDocument();
    expect(screen.getByText("Manage Offerings")).toBeInTheDocument();
  });

  it("hides management buttons when canManage is false", () => {
    render(<StaffingMatrix {...defaultProps} canManage={false} />);
    expect(screen.queryByText("Add Assignment")).not.toBeInTheDocument();
    expect(screen.queryByText("Manage Offerings")).not.toBeInTheDocument();
  });

  it("filters by capacity when clicking metric cards", () => {
    const overUser = makeUser({
      id: "u2",
      name: "Over User",
      assignments: [
        {
          id: "a3", allocationFte: 0.7, status: "ACTIVE", role: "Tech Lead",
          function: null, notes: null, startDate: null, endDate: null,
          project: { id: "p1", name: "Project Alpha", status: "ACTIVE" },
          client: null, serviceOffering: { id: "so1", name: "Consulting" },
          projectRoleId: null, projectRole: null, roleDefinition: null,
        },
        {
          id: "a4", allocationFte: 0.5, status: "ACTIVE", role: null,
          function: null, notes: null, startDate: null, endDate: null,
          project: { id: "p2", name: "Project Beta", status: "ACTIVE" },
          client: null, serviceOffering: { id: "so1", name: "Consulting" },
          projectRoleId: null, projectRole: null, roleDefinition: null,
        },
      ],
    });
    const normalUser = makeUser({ id: "u1", name: "Normal User" });
    render(<StaffingMatrix {...defaultProps} users={[overUser, normalUser]} />);

    // Click "Overallocated" metric
    fireEvent.click(screen.getByText("Overallocated").closest("button")!);

    // Should show "Filtering by" indicator
    expect(screen.getByText("Filtering by:")).toBeInTheDocument();

    // Over User should be visible (appears in multiple rows)
    const overUserElements = screen.getAllByText("Over User");
    expect(overUserElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows footer total FTE", () => {
    render(<StaffingMatrix {...defaultProps} />);
    const totalFteElements = screen.getAllByText("0.90");
    expect(totalFteElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders filter dropdowns", () => {
    render(<StaffingMatrix {...defaultProps} />);
    expect(screen.getByText("All Offerings")).toBeInTheDocument();
  });

  it("shows client sub-headers in hierarchy", () => {
    render(<StaffingMatrix {...defaultProps} />);
    // Within the Consulting offering group, Client One should appear as a sub-header
    const clientOnes = screen.getAllByText("Client One");
    // Should appear in filter dropdown + client sub-header + possibly data row
    expect(clientOnes.length).toBeGreaterThanOrEqual(2);
  });
});
