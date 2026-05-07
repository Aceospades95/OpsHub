"use client";

import { useFormState } from "react-dom";
import { useRef, useEffect, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { addComment, deleteComment } from "@/actions/comments";
import { MentionTextarea } from "./mention-textarea";
import { segmentMentions } from "@/lib/mentions";

interface CommentData {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string };
}

interface CommentSectionProps {
  comments: CommentData[];
  entityType: "client" | "project" | "contract" | "document" | "supplier" | "certification" | "subcontractor" | "partnership";
  entityId: string;
  canComment: boolean;
  canDelete: boolean;
  currentUserId: string;
}

/**
 * Render comment content, turning `@[Name](userId)` tokens into links to
 * the referenced employee. Plain-text segments keep their whitespace and
 * line breaks so the surrounding `whitespace-pre-wrap` still works.
 */
function RenderedCommentContent({ content }: { content: string }) {
  const segments = segmentMentions(content);
  return (
    <p className="text-sm text-foreground whitespace-pre-wrap">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <Fragment key={`t-${i}`}>{seg.value}</Fragment>
        ) : (
          <Link
            key={`m-${i}`}
            href={`/team/${seg.userId}`}
            className="inline-flex items-center rounded bg-primary/10 px-1 text-primary hover:bg-primary/20 hover:underline"
          >
            @{seg.name}
          </Link>
        )
      )}
    </p>
  );
}

function AddCommentForm({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const [state, formAction] = useFormState(addComment, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      setValue("");
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <MentionTextarea
        name="content"
        value={value}
        onChange={setValue}
        placeholder="Add a comment… use @ to mention an employee"
        required
      />
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={value.trim().length === 0}>
          Post Comment
        </Button>
      </div>
    </form>
  );
}

export function CommentSection({
  comments,
  entityType,
  entityId,
  canComment,
  canDelete,
  currentUserId,
}: CommentSectionProps) {
  const router = useRouter();

  async function handleDelete(commentId: string) {
    const formData = new FormData();
    formData.set("commentId", commentId);
    await deleteComment(null, formData);
    router.refresh();
  }

  // Display comments chronologically with oldest at top and newest at bottom,
  // so the newest comment sits right above the compose box. Callers often pass
  // data already sorted descending — we normalize here so every place that
  // uses this component gets the same behavior.
  const sortedComments = [...comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="space-y-4">
      {/* Header is owned by the calling page (every caller wraps this
       *  in a <Card> with a "Comments" CardTitle). Keeping a second
       *  h3 here stacked two identical headings on every detail page. */}
      {sortedComments.length === 0 && (
        <p className="text-sm text-muted-foreground">No comments yet</p>
      )}

      <div className="space-y-3">
        {sortedComments.map((comment) => (
          <div key={comment.id} className="flex gap-3">
            <Avatar name={comment.author.name} size="sm" />
            <div className="flex-1 rounded border border-border bg-muted p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/team/${comment.author.id}`}
                    className="text-sm font-medium hover:text-primary hover:underline"
                  >
                    {comment.author.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
                  </span>
                </div>
                {(canDelete || comment.author.id === currentUserId) && (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <RenderedCommentContent content={comment.content} />
            </div>
          </div>
        ))}
      </div>

      {canComment && <AddCommentForm entityType={entityType} entityId={entityId} />}
    </div>
  );
}
