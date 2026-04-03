"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  createCustomWidget,
  updateCustomWidget,
  deleteCustomWidget,
} from "@/actions/widgets";
import {
  QUERYABLE_MODELS,
  MODEL_FILTERS,
  AVAILABLE_ICONS,
  MODEL_HREF_MAP,
} from "@/lib/widget-registry";
import { Plus, Pencil, Trash2 } from "lucide-react";

type WidgetTypeValue = "stat" | "embed" | "markdown" | "data-list";

interface WidgetRecord {
  id: string;
  name: string;
  description: string | null;
  type: string;
  config: string;
}

interface WidgetBuilderProps {
  mode: "create" | "edit" | "delete";
  widget?: WidgetRecord;
}

const WIDGET_TYPES: { label: string; value: WidgetTypeValue; description: string }[] = [
  { label: "Stat Counter", value: "stat", description: "Shows a count from any data source" },
  { label: "Embed", value: "embed", description: "Embed an iframe or external content" },
  { label: "Text Block", value: "markdown", description: "Plain text content block" },
  { label: "Data List", value: "data-list", description: "List records from any module" },
];

export function WidgetBuilder({ mode, widget }: WidgetBuilderProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // --- Delete mode ---
  if (mode === "delete") {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Delete Widget">
          <p className="text-sm text-muted-foreground mb-4">
            Are you sure you want to delete <strong>{widget?.name}</strong>? This action cannot be
            undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (widget) {
                  await deleteCustomWidget(widget.id);
                  setOpen(false);
                  router.refresh();
                }
              }}
            >
              Delete
            </Button>
          </div>
        </Dialog>
      </>
    );
  }

  // --- Create / Edit mode ---
  return (
    <>
      {mode === "create" ? (
        <Button onClick={() => setOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Create Widget
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {open && (
        <WidgetFormDialog
          mode={mode}
          widget={widget}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// -------------------------------------------------------------------
// Form Dialog (separated so hooks only mount when dialog is open)
// -------------------------------------------------------------------

interface WidgetFormDialogProps {
  mode: "create" | "edit";
  widget?: WidgetRecord;
  onClose: () => void;
}

function WidgetFormDialog({ mode, widget, onClose }: WidgetFormDialogProps) {
  const router = useRouter();
  const serverAction = mode === "create" ? createCustomWidget : updateCustomWidget;
  const [state, action] = useFormState(serverAction, null);

  // Parse existing config for edit mode
  const existingConfig = useMemo(() => {
    if (widget?.config) {
      try {
        return JSON.parse(widget.config) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }, [widget]);

  // Step state: 1 = pick type, 2 = configure
  const [step, setStep] = useState(mode === "edit" ? 2 : 1);
  const [widgetType, setWidgetType] = useState<WidgetTypeValue>(
    (widget?.type as WidgetTypeValue) || "stat"
  );

  // Field state
  const [name, setName] = useState(widget?.name || "");
  const [description, setDescription] = useState(widget?.description || "");

  // Stat fields
  const [statModel, setStatModel] = useState<string>((existingConfig.model as string) || "client");
  const [statFilter, setStatFilter] = useState<string>((existingConfig.filterKey as string) || "all");
  const [statLabel, setStatLabel] = useState<string>((existingConfig.label as string) || "");
  const [statIcon, setStatIcon] = useState<string>((existingConfig.icon as string) || "Building2");
  const [statHref, setStatHref] = useState<string>((existingConfig.href as string) || "/clients");

  // Embed fields
  const [embedUrl, setEmbedUrl] = useState<string>((existingConfig.url as string) || "");
  const [embedTitle, setEmbedTitle] = useState<string>((existingConfig.title as string) || "");
  const [embedHeight, setEmbedHeight] = useState<string>((existingConfig.height as string) || "400px");

  // Markdown fields
  const [mdTitle, setMdTitle] = useState<string>((existingConfig.title as string) || "");
  const [mdContent, setMdContent] = useState<string>((existingConfig.content as string) || "");

  // Data-list fields
  const [dlModel, setDlModel] = useState<string>((existingConfig.model as string) || "client");
  const [dlFilter, setDlFilter] = useState<string>((existingConfig.filterKey as string) || "all");
  const [dlTitle, setDlTitle] = useState<string>((existingConfig.title as string) || "");
  const [dlLimit, setDlLimit] = useState<string>(String((existingConfig.limit as number) || 5));
  const [dlFields, setDlFields] = useState<string>(
    Array.isArray(existingConfig.fields)
      ? (existingConfig.fields as string[]).join(", ")
      : "name"
  );

  // Auto-fill href when stat model changes
  useEffect(() => {
    setStatHref(MODEL_HREF_MAP[statModel] || "");
  }, [statModel]);

  // Build config JSON
  const buildConfig = useCallback((): string => {
    const filterEntry = (model: string, filterKey: string) => {
      const filters = MODEL_FILTERS[model] || [];
      const match = filters.find((f) => f.value === filterKey);
      return match ? match.where : {};
    };

    switch (widgetType) {
      case "stat":
        return JSON.stringify({
          model: statModel,
          filter: filterEntry(statModel, statFilter),
          filterKey: statFilter,
          label: statLabel,
          icon: statIcon,
          href: statHref,
        });
      case "embed":
        return JSON.stringify({
          url: embedUrl,
          title: embedTitle,
          height: embedHeight || "400px",
        });
      case "markdown":
        return JSON.stringify({
          title: mdTitle,
          content: mdContent,
        });
      case "data-list":
        return JSON.stringify({
          model: dlModel,
          filter: filterEntry(dlModel, dlFilter),
          filterKey: dlFilter,
          title: dlTitle,
          limit: parseInt(dlLimit, 10) || 5,
          fields: dlFields.split(",").map((f) => f.trim()).filter(Boolean),
          href: MODEL_HREF_MAP[dlModel] || "",
        });
      default:
        return "{}";
    }
  }, [
    widgetType,
    statModel, statFilter, statLabel, statIcon, statHref,
    embedUrl, embedTitle, embedHeight,
    mdTitle, mdContent,
    dlModel, dlFilter, dlTitle, dlLimit, dlFields,
  ]);

  // Close on success
  useEffect(() => {
    if (state?.success) {
      onClose();
      router.refresh();
    }
  }, [state, onClose, router]);

  const modelOptions = QUERYABLE_MODELS.map((m) => ({ label: m.label, value: m.value }));

  const filterOptions = (model: string) =>
    (MODEL_FILTERS[model] || []).map((f) => ({ label: f.label, value: f.value }));

  const iconOptions = AVAILABLE_ICONS.map((i) => ({ label: i, value: i }));

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "create" ? "Create Widget" : "Edit Widget"}
      className="max-w-xl"
    >
      {/* Step 1: Pick Type */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground mb-2">Choose a widget type:</p>
          <div className="grid grid-cols-2 gap-3">
            {WIDGET_TYPES.map((wt) => (
              <button
                key={wt.value}
                type="button"
                onClick={() => {
                  setWidgetType(wt.value);
                  setStep(2);
                }}
                className={`text-left rounded border p-3 transition-colors hover:border-primary hover:bg-muted/50 ${
                  widgetType === wt.value
                    ? "border-primary bg-muted/50"
                    : "border-border"
                }`}
              >
                <p className="text-sm font-medium">{wt.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{wt.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && (
        <form action={action} className="space-y-4">
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          {/* Hidden fields for the server action */}
          {mode === "edit" && widget && (
            <input type="hidden" name="id" value={widget.id} />
          )}
          <input type="hidden" name="type" value={widgetType} />
          <input type="hidden" name="config" value={buildConfig()} />

          {/* Common fields */}
          <Input
            name="name"
            label="Widget Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Active Clients Count"
          />
          <Input
            name="description"
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />

          {/* Type indicator */}
          <div className="rounded border border-border bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Type:{" "}
              <span className="font-medium text-foreground">
                {WIDGET_TYPES.find((t) => t.value === widgetType)?.label}
              </span>
              {mode === "create" && (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="ml-2 text-primary hover:underline"
                >
                  Change
                </button>
              )}
            </p>
          </div>

          {/* Type-specific fields */}
          {widgetType === "stat" && (
            <StatFields
              model={statModel}
              onModelChange={setStatModel}
              filter={statFilter}
              onFilterChange={setStatFilter}
              label={statLabel}
              onLabelChange={setStatLabel}
              icon={statIcon}
              onIconChange={setStatIcon}
              href={statHref}
              onHrefChange={setStatHref}
              modelOptions={modelOptions}
              filterOptions={filterOptions(statModel)}
              iconOptions={iconOptions}
            />
          )}

          {widgetType === "embed" && (
            <EmbedFields
              url={embedUrl}
              onUrlChange={setEmbedUrl}
              title={embedTitle}
              onTitleChange={setEmbedTitle}
              height={embedHeight}
              onHeightChange={setEmbedHeight}
            />
          )}

          {widgetType === "markdown" && (
            <MarkdownFields
              title={mdTitle}
              onTitleChange={setMdTitle}
              content={mdContent}
              onContentChange={setMdContent}
            />
          )}

          {widgetType === "data-list" && (
            <DataListFields
              model={dlModel}
              onModelChange={setDlModel}
              filter={dlFilter}
              onFilterChange={setDlFilter}
              title={dlTitle}
              onTitleChange={setDlTitle}
              limit={dlLimit}
              onLimitChange={setDlLimit}
              fields={dlFields}
              onFieldsChange={setDlFields}
              modelOptions={modelOptions}
              filterOptions={filterOptions(dlModel)}
            />
          )}

          <div className="flex justify-end gap-2 pt-2">
            {mode === "create" && (
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {mode === "create" ? "Create Widget" : "Save Changes"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// -------------------------------------------------------------------
// Type-specific field components
// -------------------------------------------------------------------

interface StatFieldsProps {
  model: string;
  onModelChange: (v: string) => void;
  filter: string;
  onFilterChange: (v: string) => void;
  label: string;
  onLabelChange: (v: string) => void;
  icon: string;
  onIconChange: (v: string) => void;
  href: string;
  onHrefChange: (v: string) => void;
  modelOptions: { label: string; value: string }[];
  filterOptions: { label: string; value: string }[];
  iconOptions: { label: string; value: string }[];
}

function StatFields({
  model, onModelChange,
  filter, onFilterChange,
  label, onLabelChange,
  icon, onIconChange,
  href, onHrefChange,
  modelOptions, filterOptions, iconOptions,
}: StatFieldsProps) {
  return (
    <div className="space-y-3">
      <Select
        label="Data Model"
        options={modelOptions}
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
      />
      <Select
        label="Filter"
        options={filterOptions}
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
      />
      <Input
        label="Display Label"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        placeholder="e.g. Active Clients"
      />
      <Select
        label="Icon"
        options={iconOptions}
        value={icon}
        onChange={(e) => onIconChange(e.target.value)}
      />
      <Input
        label="Link (href)"
        value={href}
        onChange={(e) => onHrefChange(e.target.value)}
        placeholder="/clients"
      />
    </div>
  );
}

interface EmbedFieldsProps {
  url: string;
  onUrlChange: (v: string) => void;
  title: string;
  onTitleChange: (v: string) => void;
  height: string;
  onHeightChange: (v: string) => void;
}

function EmbedFields({
  url, onUrlChange,
  title, onTitleChange,
  height, onHeightChange,
}: EmbedFieldsProps) {
  return (
    <div className="space-y-3">
      <Input
        label="URL"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="https://example.com"
        required
      />
      <Input
        label="Title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Optional title"
      />
      <Input
        label="Height"
        value={height}
        onChange={(e) => onHeightChange(e.target.value)}
        placeholder="400px"
      />
    </div>
  );
}

interface MarkdownFieldsProps {
  title: string;
  onTitleChange: (v: string) => void;
  content: string;
  onContentChange: (v: string) => void;
}

function MarkdownFields({
  title, onTitleChange,
  content, onContentChange,
}: MarkdownFieldsProps) {
  return (
    <div className="space-y-3">
      <Input
        label="Title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Optional title"
      />
      <Textarea
        label="Content"
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        placeholder="Enter plain text content..."
        rows={6}
        required
      />
    </div>
  );
}

interface DataListFieldsProps {
  model: string;
  onModelChange: (v: string) => void;
  filter: string;
  onFilterChange: (v: string) => void;
  title: string;
  onTitleChange: (v: string) => void;
  limit: string;
  onLimitChange: (v: string) => void;
  fields: string;
  onFieldsChange: (v: string) => void;
  modelOptions: { label: string; value: string }[];
  filterOptions: { label: string; value: string }[];
}

function DataListFields({
  model, onModelChange,
  filter, onFilterChange,
  title, onTitleChange,
  limit, onLimitChange,
  fields, onFieldsChange,
  modelOptions, filterOptions,
}: DataListFieldsProps) {
  return (
    <div className="space-y-3">
      <Select
        label="Data Model"
        options={modelOptions}
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
      />
      <Select
        label="Filter"
        options={filterOptions}
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
      />
      <Input
        label="Title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="e.g. Recent Clients"
        required
      />
      <Input
        label="Limit"
        type="number"
        value={limit}
        onChange={(e) => onLimitChange(e.target.value)}
        min={1}
        max={50}
        placeholder="5"
      />
      <Input
        label="Fields (comma-separated)"
        value={fields}
        onChange={(e) => onFieldsChange(e.target.value)}
        placeholder="name, status, createdAt"
      />
    </div>
  );
}
