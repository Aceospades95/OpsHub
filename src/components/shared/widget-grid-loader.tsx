"use client";

import dynamic from "next/dynamic";

const WidgetGrid = dynamic(
  () => import("./widget-grid").then((mod) => mod.WidgetGrid),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    ),
  }
);

export { WidgetGrid as WidgetGridLoader };
