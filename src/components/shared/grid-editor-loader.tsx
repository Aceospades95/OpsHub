"use client";

import dynamic from "next/dynamic";

const GridEditorInner = dynamic(
  () => import("./grid-editor").then((mod) => mod.GridEditor),
  { ssr: false, loading: () => null }
);

export function GridEditor(props: { pageType: string; initialCards: { id: string; visible: boolean; grid: { x: number; y: number; w: number; h: number; minW?: number; minH?: number } }[]; cardLabels: Record<string, string> }) {
  return <GridEditorInner {...props} />;
}
