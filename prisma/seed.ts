import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Users
  const adminPassword = await hash("admin123", 12);
  const managerPassword = await hash("manager123", 12);
  const contribPassword = await hash("contrib123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@wynndalco.local" },
    update: {},
    create: {
      name: "Alex Wynne",
      email: "admin@wynndalco.local",
      hashedPassword: adminPassword,
      role: "ADMIN",
      department: "Operations",
      jobTitle: "Director of Operations",
      phone: "555-100-0001",
      isActive: true,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@wynndalco.local" },
    update: {},
    create: {
      name: "Jordan Rivera",
      email: "manager@wynndalco.local",
      hashedPassword: managerPassword,
      role: "MANAGER",
      department: "Project Management",
      jobTitle: "Senior Project Manager",
      phone: "555-100-0002",
      managerId: admin.id,
      isActive: true,
    },
  });

  const contributor = await prisma.user.upsert({
    where: { email: "contributor@wynndalco.local" },
    update: {},
    create: {
      name: "Casey Morgan",
      email: "contributor@wynndalco.local",
      hashedPassword: contribPassword,
      role: "CONTRIBUTOR",
      department: "Engineering",
      jobTitle: "Solutions Engineer",
      phone: "555-100-0003",
      managerId: manager.id,
      isActive: true,
    },
  });

  // Clients
  const clientAcme = await prisma.client.upsert({
    where: { id: "client-acme" },
    update: {},
    create: {
      id: "client-acme",
      name: "Acme Corp",
      description: "Leading provider of industrial solutions and manufacturing equipment.",
      summary: "Long-standing client since 2018. Primary focus on fleet management and facility maintenance. Key decision maker is VP of Operations. Annual contract value ~$250K.",
      industry: "Manufacturing",
      website: "https://acme-corp.example.com",
      status: "ACTIVE",
    },
  });

  const clientGlobal = await prisma.client.upsert({
    where: { id: "client-globaltech" },
    update: {},
    create: {
      id: "client-globaltech",
      name: "GlobalTech Solutions",
      description: "IT consulting and managed services provider serving mid-market enterprises.",
      summary: "New client acquired Q1 2025. Currently in onboarding phase with three active SOWs. Growth potential for additional service lines.",
      industry: "Technology",
      website: "https://globaltech.example.com",
      status: "ACTIVE",
    },
  });

  const clientSilver = await prisma.client.upsert({
    where: { id: "client-silverline" },
    update: {},
    create: {
      id: "client-silverline",
      name: "Silverline Properties",
      description: "Commercial real estate management company with 50+ properties.",
      industry: "Real Estate",
      status: "PROSPECT",
    },
  });

  // Client Contacts
  await prisma.clientContact.upsert({
    where: { id: "contact-acme-1" },
    update: {},
    create: {
      id: "contact-acme-1",
      name: "Sarah Chen",
      title: "VP of Operations",
      email: "s.chen@acme-corp.example.com",
      phone: "555-200-0001",
      isPrimary: true,
      clientId: clientAcme.id,
    },
  });

  await prisma.clientContact.upsert({
    where: { id: "contact-acme-2" },
    update: {},
    create: {
      id: "contact-acme-2",
      name: "Mike Torres",
      title: "Procurement Manager",
      email: "m.torres@acme-corp.example.com",
      phone: "555-200-0002",
      isPrimary: false,
      clientId: clientAcme.id,
    },
  });

  await prisma.clientContact.upsert({
    where: { id: "contact-global-1" },
    update: {},
    create: {
      id: "contact-global-1",
      name: "David Park",
      title: "CTO",
      email: "d.park@globaltech.example.com",
      isPrimary: true,
      clientId: clientGlobal.id,
    },
  });

  // Projects
  const projectFleet = await prisma.project.upsert({
    where: { id: "proj-fleet" },
    update: {},
    create: {
      id: "proj-fleet",
      name: "Fleet Management Overhaul",
      description: "Complete redesign of Acme's fleet tracking and maintenance scheduling system.",
      status: "ACTIVE",
      startDate: new Date("2025-01-15"),
      endDate: new Date("2025-09-30"),
      clientId: clientAcme.id,
    },
  });

  const projectFleetSub = await prisma.project.upsert({
    where: { id: "proj-fleet-gps" },
    update: {},
    create: {
      id: "proj-fleet-gps",
      name: "GPS Integration Module",
      description: "Sub-project for integrating real-time GPS tracking into the fleet system.",
      status: "PLANNING",
      startDate: new Date("2025-04-01"),
      endDate: new Date("2025-07-31"),
      clientId: clientAcme.id,
      parentProjectId: projectFleet.id,
    },
  });

  const projectOnboard = await prisma.project.upsert({
    where: { id: "proj-onboard" },
    update: {},
    create: {
      id: "proj-onboard",
      name: "GlobalTech Onboarding",
      description: "Client onboarding and initial service delivery setup for GlobalTech Solutions.",
      status: "ACTIVE",
      startDate: new Date("2025-02-01"),
      endDate: new Date("2025-05-31"),
      clientId: clientGlobal.id,
    },
  });

  const projectSecurity = await prisma.project.upsert({
    where: { id: "proj-security" },
    update: {},
    create: {
      id: "proj-security",
      name: "Security Audit & Compliance",
      description: "Comprehensive security audit and compliance remediation for GlobalTech infrastructure.",
      status: "PLANNING",
      startDate: new Date("2025-06-01"),
      clientId: clientGlobal.id,
    },
  });

  // Project Members
  for (const proj of [projectFleet, projectFleetSub, projectOnboard, projectSecurity]) {
    await prisma.projectMember.upsert({
      where: { userId_projectId: { userId: admin.id, projectId: proj.id } },
      update: {},
      create: { userId: admin.id, projectId: proj.id, role: "ADMIN" },
    });
  }
  await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: manager.id, projectId: projectFleet.id } },
    update: {},
    create: { userId: manager.id, projectId: projectFleet.id, role: "MANAGER" },
  });
  await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: contributor.id, projectId: projectFleet.id } },
    update: {},
    create: { userId: contributor.id, projectId: projectFleet.id, role: "CONTRIBUTOR" },
  });
  await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: manager.id, projectId: projectOnboard.id } },
    update: {},
    create: { userId: manager.id, projectId: projectOnboard.id, role: "MANAGER" },
  });

  // Milestones
  const ms1 = await prisma.milestone.upsert({
    where: { id: "ms-fleet-1" },
    update: {},
    create: {
      id: "ms-fleet-1",
      title: "Requirements Gathering Complete",
      description: "Finalize all stakeholder requirements and sign off on scope.",
      dueDate: new Date("2025-02-28"),
      completed: true,
      completedAt: new Date("2025-02-25"),
      projectId: projectFleet.id,
    },
  });

  await prisma.milestone.upsert({
    where: { id: "ms-fleet-2" },
    update: {},
    create: {
      id: "ms-fleet-2",
      title: "System Architecture Approved",
      dueDate: new Date("2025-03-31"),
      completed: false,
      projectId: projectFleet.id,
    },
  });

  await prisma.milestone.upsert({
    where: { id: "ms-fleet-3" },
    update: {},
    create: {
      id: "ms-fleet-3",
      title: "Beta Launch",
      dueDate: new Date("2025-07-15"),
      completed: false,
      projectId: projectFleet.id,
    },
  });

  await prisma.milestoneAssignee.upsert({
    where: { milestoneId_userId: { milestoneId: ms1.id, userId: manager.id } },
    update: {},
    create: { milestoneId: ms1.id, userId: manager.id },
  });

  // Contracts
  const contractMsa = await prisma.contract.upsert({
    where: { id: "contract-acme-msa" },
    update: {},
    create: {
      id: "contract-acme-msa",
      title: "Acme Corp Master Service Agreement",
      description: "Umbrella agreement covering all professional services engagements with Acme Corp.",
      status: "ACTIVE",
      contractNumber: "MSA-2024-001",
      contractType: "MSA",
      value: 250000,
      currency: "USD",
      startDate: new Date("2024-01-01"),
      endDate: new Date("2026-12-31"),
      renewalDate: new Date("2026-10-01"),
      noticePeriodDays: 90,
      autoRenew: true,
      summary: "Three-year MSA with annual review. Covers fleet management, facility services, and consulting.",
      clientId: clientAcme.id,
    },
  });

  const contractSow = await prisma.contract.upsert({
    where: { id: "contract-acme-sow1" },
    update: {},
    create: {
      id: "contract-acme-sow1",
      title: "Fleet Management System - SOW",
      status: "ACTIVE",
      contractNumber: "SOW-2025-001",
      contractType: "SOW",
      value: 120000,
      startDate: new Date("2025-01-15"),
      endDate: new Date("2025-09-30"),
      parentContractId: contractMsa.id,
      clientId: clientAcme.id,
      projectId: projectFleet.id,
    },
  });

  await prisma.contract.upsert({
    where: { id: "contract-global-nda" },
    update: {},
    create: {
      id: "contract-global-nda",
      title: "GlobalTech NDA",
      status: "ACTIVE",
      contractType: "NDA",
      startDate: new Date("2025-01-01"),
      clientId: clientGlobal.id,
    },
  });

  // Contract Terms
  await prisma.contractTerm.upsert({
    where: { id: "term-msa-1" },
    update: {},
    create: {
      id: "term-msa-1",
      type: "SLA",
      title: "Response Time SLA",
      description: "Critical issues must be acknowledged within 2 hours and resolved within 24 hours during business days.",
      priority: "HIGH",
      contractId: contractMsa.id,
    },
  });

  await prisma.contractTerm.upsert({
    where: { id: "term-msa-2" },
    update: {},
    create: {
      id: "term-msa-2",
      type: "BILLING",
      title: "Payment Terms",
      description: "Net 30 from invoice date. Invoices submitted monthly based on time and materials.",
      priority: "MEDIUM",
      contractId: contractMsa.id,
    },
  });

  await prisma.contractTerm.upsert({
    where: { id: "term-sow-1" },
    update: {},
    create: {
      id: "term-sow-1",
      type: "DELIVERABLE",
      title: "Phase 1 Delivery",
      description: "Deliver requirements documentation and system architecture by end of Q1 2025.",
      priority: "HIGH",
      dueDate: new Date("2025-03-31"),
      contractId: contractSow.id,
    },
  });

  // Suppliers
  const supplierTech = await prisma.supplier.upsert({
    where: { id: "supplier-techfix" },
    update: {},
    create: {
      id: "supplier-techfix",
      name: "TechFix Solutions",
      category: "it_services",
      contactName: "Robert Kim",
      contactEmail: "robert@techfix.example.com",
      contactPhone: "555-300-0001",
      website: "https://techfix.example.com",
      notes: "Preferred vendor for hardware repairs and IT infrastructure. Fast turnaround on service calls.",
      status: "ACTIVE",
      isPreferred: true,
    },
  });

  await prisma.supplier.upsert({
    where: { id: "supplier-cleanpro" },
    update: {},
    create: {
      id: "supplier-cleanpro",
      name: "CleanPro Maintenance",
      category: "maintenance",
      contactName: "Lisa Nguyen",
      contactEmail: "lisa@cleanpro.example.com",
      contactPhone: "555-300-0002",
      address: "456 Industrial Blvd, Suite 200, Springfield, IL 62701",
      status: "ACTIVE",
      isPreferred: false,
    },
  });

  await prisma.supplier.upsert({
    where: { id: "supplier-safeguard" },
    update: {},
    create: {
      id: "supplier-safeguard",
      name: "SafeGuard Alarms",
      category: "alarm_security",
      contactName: "Tom Bradley",
      contactPhone: "555-300-0003",
      status: "ACTIVE",
      isPreferred: true,
    },
  });

  // Supplier-Project Links
  await prisma.supplierProject.upsert({
    where: { supplierId_projectId: { supplierId: supplierTech.id, projectId: projectFleet.id } },
    update: {},
    create: {
      supplierId: supplierTech.id,
      projectId: projectFleet.id,
      notes: "Providing GPS hardware for fleet tracking module",
    },
  });

  // Tools
  const toolTracker = await prisma.tool.upsert({
    where: { id: "tool-time-tracker" },
    update: {},
    create: {
      id: "tool-time-tracker",
      name: "Project Time Tracker",
      description: "Internal time tracking tool for logging hours against projects and clients.",
      category: "tracker",
      toolType: "internal",
      isGlobal: true,
    },
  });

  await prisma.tool.upsert({
    where: { id: "tool-expense-calc" },
    update: {},
    create: {
      id: "tool-expense-calc",
      name: "Expense Calculator",
      description: "Calculate mileage reimbursement and per diem for client site visits.",
      category: "calculator",
      toolType: "internal",
      isGlobal: true,
    },
  });

  await prisma.tool.upsert({
    where: { id: "tool-site-survey" },
    update: {},
    create: {
      id: "tool-site-survey",
      name: "Site Survey Form",
      description: "Standardized form for capturing site survey data during client visits.",
      category: "form",
      toolType: "embedded",
      isGlobal: true,
    },
  });

  const toolReport = await prisma.tool.upsert({
    where: { id: "tool-report-gen" },
    update: {},
    create: {
      id: "tool-report-gen",
      name: "Monthly Report Generator",
      description: "Generates client-facing monthly status reports from project data.",
      category: "report",
      toolType: "internal",
      isGlobal: true,
    },
  });

  // Tool Embeds
  await prisma.embed.upsert({
    where: { id: "embed-survey-form" },
    update: {},
    create: {
      id: "embed-survey-form",
      title: "Site Survey Form",
      embedUrl: "https://docs.google.com/forms/d/e/example/viewform?embedded=true",
      embedType: "google_form",
      description: "Complete this form during each client site visit",
      toolId: "tool-site-survey",
    },
  });

  // Project-Tool Links
  await prisma.projectTool.upsert({
    where: { projectId_toolId: { projectId: projectFleet.id, toolId: toolTracker.id } },
    update: {},
    create: { projectId: projectFleet.id, toolId: toolTracker.id },
  });

  await prisma.projectTool.upsert({
    where: { projectId_toolId: { projectId: projectFleet.id, toolId: toolReport.id } },
    update: {},
    create: { projectId: projectFleet.id, toolId: toolReport.id },
  });

  // Documents
  await prisma.document.upsert({
    where: { id: "doc-fleet-req" },
    update: {},
    create: {
      id: "doc-fleet-req",
      title: "Fleet Management Requirements",
      content: "# Fleet Management System Requirements\n\n## Overview\nThis document outlines the functional and non-functional requirements for the Fleet Management System overhaul.\n\n## Functional Requirements\n1. Real-time GPS tracking for all fleet vehicles\n2. Automated maintenance scheduling based on mileage and date\n3. Driver assignment and dispatch management\n4. Fuel consumption tracking and reporting\n5. Integration with existing ERP system\n\n## Non-Functional Requirements\n- System uptime: 99.9%\n- Response time: < 2 seconds for all queries\n- Support for 500+ concurrent users",
      type: "REFERENCE",
      version: 2,
      published: true,
      projectId: projectFleet.id,
    },
  });

  await prisma.documentVersion.upsert({
    where: { id: "docver-fleet-req-1" },
    update: {},
    create: {
      id: "docver-fleet-req-1",
      version: 1,
      content: "# Fleet Management System Requirements\n\n## Overview\nInitial draft of requirements.\n\n## Requirements\n1. GPS tracking\n2. Maintenance scheduling\n3. Driver management",
      changelog: "Initial draft",
      documentId: "doc-fleet-req",
    },
  });

  await prisma.document.upsert({
    where: { id: "doc-onboard-sop" },
    update: {},
    create: {
      id: "doc-onboard-sop",
      title: "Client Onboarding SOP",
      content: "# Standard Operating Procedure: Client Onboarding\n\n## Step 1: Initial Meeting\nConduct kickoff meeting with client stakeholders.\n\n## Step 2: Access Setup\nProvide necessary system access and credentials.\n\n## Step 3: Documentation\nShare relevant SOPs and templates.\n\n## Step 4: Training\nSchedule and deliver initial training sessions.\n\n## Step 5: Go-Live Checklist\nComplete all items on the go-live checklist before cutover.",
      type: "SOP",
      version: 1,
      published: true,
      projectId: projectOnboard.id,
    },
  });

  // Intranet Resources
  await prisma.intranetResource.upsert({
    where: { id: "intranet-expense" },
    update: {},
    create: {
      id: "intranet-expense",
      title: "Expense Report Submission Guide",
      description: "How to submit expense reports through the company portal.",
      content: "# Expense Report Guidelines\n\n## Submission Process\n1. Log into the HR portal\n2. Navigate to Finance > Expense Reports\n3. Click 'New Report'\n4. Attach all receipts (photos are acceptable)\n5. Submit for manager approval\n\n## Deadlines\n- Reports must be submitted within 30 days of the expense\n- Monthly reports due by the 5th of the following month\n\n## Reimbursable Items\n- Client travel (mileage at IRS rate)\n- Client meals (with prior approval)\n- Office supplies under $50",
      category: "EXPENSE_REPORT",
      published: true,
      pinned: true,
      sortOrder: 1,
    },
  });

  await prisma.intranetResource.upsert({
    where: { id: "intranet-timeoff" },
    update: {},
    create: {
      id: "intranet-timeoff",
      title: "PTO & Time Off Policy",
      description: "Company policy on paid time off, sick days, and holidays.",
      content: "# PTO Policy\n\n## Accrual\n- Full-time employees accrue 15 days PTO per year\n- PTO accrues monthly (1.25 days/month)\n- Maximum carryover: 5 days\n\n## Request Process\n1. Submit request via HR portal at least 2 weeks in advance\n2. Manager approval required\n3. Blackout dates apply during Q4 close\n\n## Sick Days\n- 5 sick days per year\n- Doctor's note required for 3+ consecutive days",
      category: "TIME_OFF",
      published: true,
      pinned: false,
      sortOrder: 2,
    },
  });

  await prisma.intranetResource.upsert({
    where: { id: "intranet-announcement" },
    update: {},
    create: {
      id: "intranet-announcement",
      title: "Q1 2025 All-Hands Recap",
      description: "Summary of the Q1 company all-hands meeting and key initiatives.",
      content: "# Q1 2025 All-Hands Meeting Recap\n\n## Company Performance\n- Revenue up 15% YoY\n- 3 new clients acquired\n- Employee satisfaction score: 4.2/5\n\n## Key Initiatives\n1. OpsHub platform launch (you're using it!)\n2. New training program for project managers\n3. Office renovation planned for Q3\n\n## Action Items\n- All managers: complete team skill assessments by March 31\n- All employees: update emergency contact info in HR portal",
      category: "ANNOUNCEMENT",
      published: true,
      pinned: true,
      sortOrder: 0,
    },
  });

  await prisma.intranetResource.upsert({
    where: { id: "intranet-security-sop" },
    update: {},
    create: {
      id: "intranet-security-sop",
      title: "Information Security Policy",
      description: "Company information security standards and procedures.",
      category: "SOP",
      published: true,
      sortOrder: 3,
    },
  });

  await prisma.intranetResource.upsert({
    where: { id: "intranet-orgchart" },
    update: {},
    create: {
      id: "intranet-orgchart",
      title: "Company Org Chart",
      description: "Current organizational chart and reporting structure.",
      category: "ORG_CHART",
      published: true,
      sortOrder: 4,
    },
  });

  // Comments
  await prisma.comment.upsert({
    where: { id: "comment-fleet-1" },
    update: {},
    create: {
      id: "comment-fleet-1",
      content: "Great progress on the fleet management project. The requirements doc looks solid \u2014 let's schedule a review with the Acme team next week.",
      authorId: admin.id,
      projectId: projectFleet.id,
    },
  });

  await prisma.comment.upsert({
    where: { id: "comment-fleet-2" },
    update: {},
    create: {
      id: "comment-fleet-2",
      content: "I've spoken with TechFix about the GPS hardware pricing. They can offer a 10% volume discount if we commit to 100+ units.",
      authorId: contributor.id,
      projectId: projectFleet.id,
    },
  });

  await prisma.comment.upsert({
    where: { id: "comment-acme-1" },
    update: {},
    create: {
      id: "comment-acme-1",
      content: "Sarah mentioned they're considering expanding the scope to include facility management. Let's set up a discovery call.",
      authorId: manager.id,
      clientId: clientAcme.id,
    },
  });

  // Tasks
  await prisma.task.upsert({
    where: { id: "task-1" },
    update: {},
    create: {
      id: "task-1",
      title: "Review GPS hardware quotes from TechFix",
      description: "Compare pricing for 100+ unit orders and negotiate volume discount.",
      status: "TODO",
      priority: "HIGH",
      dueDate: new Date("2025-04-15"),
      projectId: projectFleet.id,
      clientId: clientAcme.id,
      assigneeId: contributor.id,
      createdById: admin.id,
    },
  });

  await prisma.task.upsert({
    where: { id: "task-2" },
    update: {},
    create: {
      id: "task-2",
      title: "Schedule architecture review with Acme team",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: new Date("2025-04-10"),
      projectId: projectFleet.id,
      clientId: clientAcme.id,
      assigneeId: manager.id,
      createdById: admin.id,
    },
  });

  await prisma.task.upsert({
    where: { id: "task-3" },
    update: {},
    create: {
      id: "task-3",
      title: "Prepare onboarding materials for GlobalTech",
      description: "Create welcome packet, access request forms, and training schedule.",
      status: "TODO",
      priority: "MEDIUM",
      dueDate: new Date("2025-04-20"),
      projectId: projectOnboard.id,
      clientId: clientGlobal.id,
      assigneeId: manager.id,
      createdById: admin.id,
    },
  });

  await prisma.task.upsert({
    where: { id: "task-4" },
    update: {},
    create: {
      id: "task-4",
      title: "Update fleet requirements doc with stakeholder feedback",
      status: "TODO",
      priority: "MEDIUM",
      projectId: projectFleet.id,
      assigneeId: contributor.id,
      createdById: manager.id,
    },
  });

  await prisma.task.upsert({
    where: { id: "task-5" },
    update: {},
    create: {
      id: "task-5",
      title: "Review and renew SafeGuard Alarms contract",
      status: "TODO",
      priority: "LOW",
      dueDate: new Date("2025-05-01"),
      assigneeId: admin.id,
      createdById: admin.id,
    },
  });

  await prisma.task.upsert({
    where: { id: "task-6" },
    update: {},
    create: {
      id: "task-6",
      title: "Complete security audit scope document",
      status: "TODO",
      priority: "MEDIUM",
      dueDate: new Date("2025-04-25"),
      projectId: projectSecurity.id,
      clientId: clientGlobal.id,
      assigneeId: admin.id,
      createdById: admin.id,
    },
  });

  // Activity Logs
  const activities = [
    { action: "created", entityType: "client", entityId: clientAcme.id, details: "Acme Corp", userId: admin.id },
    { action: "created", entityType: "client", entityId: clientGlobal.id, details: "GlobalTech Solutions", userId: admin.id },
    { action: "created", entityType: "project", entityId: projectFleet.id, details: "Fleet Management Overhaul", userId: admin.id },
    { action: "created", entityType: "project", entityId: projectOnboard.id, details: "GlobalTech Onboarding", userId: manager.id },
    { action: "created", entityType: "contract", entityId: contractMsa.id, details: "Acme Corp MSA", userId: admin.id },
    { action: "updated", entityType: "project", entityId: projectFleet.id, details: "Updated status to Active", userId: manager.id },
    { action: "commented", entityType: "project", entityId: projectFleet.id, details: "Great progress on the fleet management project.", userId: admin.id },
    { action: "created", entityType: "document", entityId: "doc-fleet-req", details: "Fleet Management Requirements", userId: contributor.id },
    { action: "updated", entityType: "document", entityId: "doc-fleet-req", details: "Updated requirements (v2)", userId: contributor.id },
    { action: "created", entityType: "supplier", entityId: supplierTech.id, details: "TechFix Solutions", userId: admin.id },
  ];

  for (const log of activities) {
    await prisma.activityLog.create({ data: log });
  }

  // ─── SERVICE OFFERINGS ──────────────────────────────
  const offeringFieldServices = await prisma.serviceOffering.upsert({
    where: { name: "End User Device Field Services" },
    update: {},
    create: { name: "End User Device Field Services", description: "On-site field services for end user device deployment, repair, and support." },
  });

  const offeringDeviceDeployment = await prisma.serviceOffering.upsert({
    where: { name: "End User Device Deployment" },
    update: {},
    create: { name: "End User Device Deployment", description: "Large-scale device deployment and imaging projects." },
  });

  const offeringDataCenter = await prisma.serviceOffering.upsert({
    where: { name: "Data Center & Infra" },
    update: {},
    create: { name: "Data Center & Infra", description: "Data center operations, migrations, and infrastructure services." },
  });

  const offeringBPO = await prisma.serviceOffering.upsert({
    where: { name: "Business Process Outsourcing" },
    update: {},
    create: { name: "Business Process Outsourcing", description: "Outsourced business process management and operations." },
  });

  const offeringConsulting = await prisma.serviceOffering.upsert({
    where: { name: "Consulting" },
    update: {},
    create: { name: "Consulting", description: "Strategic consulting, security audits, and advisory services." },
  });

  // ─── ASSIGNMENTS / ALLOCATIONS ────────────────────────
  // Admin (Alex Wynne) — Director of Operations, split across oversight roles
  await prisma.assignment.upsert({
    where: { id: "assign-admin-fleet" },
    update: {},
    create: {
      id: "assign-admin-fleet",
      employeeId: admin.id,
      projectId: projectFleet.id,
      clientId: clientAcme.id,
      serviceOfferingId: offeringFieldServices.id,
      function: "Operations Management",
      role: "Operations Manager",
      allocationFte: 0.4,
      status: "ACTIVE",
      startDate: new Date("2025-01-15"),
    },
  });

  await prisma.assignment.upsert({
    where: { id: "assign-admin-security" },
    update: {},
    create: {
      id: "assign-admin-security",
      employeeId: admin.id,
      projectId: projectSecurity.id,
      clientId: clientGlobal.id,
      serviceOfferingId: offeringConsulting.id,
      function: "Security Consulting",
      role: "Lead Consultant",
      allocationFte: 0.3,
      status: "ACTIVE",
      startDate: new Date("2025-06-01"),
    },
  });

  await prisma.assignment.upsert({
    where: { id: "assign-admin-bpo" },
    update: {},
    create: {
      id: "assign-admin-bpo",
      employeeId: admin.id,
      serviceOfferingId: offeringBPO.id,
      function: "Program Oversight",
      role: "Team Lead",
      allocationFte: 0.3,
      status: "ACTIVE",
      notes: "Manages Event processing Team",
    },
  });

  // Manager (Jordan Rivera) — Senior Project Manager
  await prisma.assignment.upsert({
    where: { id: "assign-manager-fleet" },
    update: {},
    create: {
      id: "assign-manager-fleet",
      employeeId: manager.id,
      projectId: projectFleet.id,
      clientId: clientAcme.id,
      serviceOfferingId: offeringFieldServices.id,
      function: "Project Management",
      role: "Project Lead",
      allocationFte: 0.5,
      status: "ACTIVE",
      startDate: new Date("2025-01-15"),
      endDate: new Date("2025-09-30"),
    },
  });

  await prisma.assignment.upsert({
    where: { id: "assign-manager-onboard" },
    update: {},
    create: {
      id: "assign-manager-onboard",
      employeeId: manager.id,
      projectId: projectOnboard.id,
      clientId: clientGlobal.id,
      serviceOfferingId: offeringDeviceDeployment.id,
      function: "Client Onboarding",
      role: "Scheduler / Tech Lead",
      allocationFte: 0.5,
      status: "ACTIVE",
      startDate: new Date("2025-02-01"),
      endDate: new Date("2025-05-31"),
    },
  });

  // Contributor (Casey Morgan) — Solutions Engineer
  await prisma.assignment.upsert({
    where: { id: "assign-contributor-fleet" },
    update: {},
    create: {
      id: "assign-contributor-fleet",
      employeeId: contributor.id,
      projectId: projectFleet.id,
      clientId: clientAcme.id,
      serviceOfferingId: offeringFieldServices.id,
      function: "Field Services",
      role: "FSS Technician II",
      allocationFte: 0.6,
      status: "ACTIVE",
      startDate: new Date("2025-01-15"),
      notes: "3 certified techs for PM",
    },
  });

  await prisma.assignment.upsert({
    where: { id: "assign-contributor-gps" },
    update: {},
    create: {
      id: "assign-contributor-gps",
      employeeId: contributor.id,
      projectId: projectFleetSub.id,
      clientId: clientAcme.id,
      serviceOfferingId: offeringDeviceDeployment.id,
      function: "Device Deployment",
      role: "Installation Tech",
      allocationFte: 0.4,
      status: "PLANNED",
      startDate: new Date("2025-04-01"),
      endDate: new Date("2025-07-31"),
      notes: "Workload dependent - can be shifted to other projects as needed",
    },
  });

  console.log("Seed complete!");
  console.log("\nDemo accounts:");
  console.log("  admin@wynndalco.local / admin123");
  console.log("  manager@wynndalco.local / manager123");
  console.log("  contributor@wynndalco.local / contrib123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
