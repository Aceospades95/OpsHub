"use client";

import dynamic from "next/dynamic";

const DashboardGrid = dynamic(
  () => import("./dashboard-grid").then((mod) => mod.DashboardGrid),
  {
    ssr: false,
    loading: () => (
      <div className="h-96 flex items-center justify-center text-muted-foreground">
        Loading dashboard...
      </div>
    ),
  }
);

export { DashboardGrid as DashboardGridLoader };
