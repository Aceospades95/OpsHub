"use client";

import { useFormState } from "react-dom";
import { useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { addComment, deleteComment } from "@/actions/comments";

interface CommentData {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string };
}

interface CommentSectionProps {
  comments: CommentData[];
  entityType: "client" | "project" | "contract" | "document" | "supplier" | "certification";
  entityId: string;
  canComment: boolean;
  canDelete: boolean;
  currentUserId: string;
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
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <Textarea name="content" placeholder="Add a comment..." required />
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm">
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

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Comments</h3>

      {comments.length === 0 && (
        <p className="text-sm text-muted-foreground">No comments yet</p>
      )}

      <div className="space-y-3">
        {comments.map((comment) => (
          <div key={comment.id} className="flex gap-3">
            <Avatar name={comment.author.name} size="sm" />
            <div className="flex-1 rounded border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{comment.author.name}</span>
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
              <p className="text-sm text-foreground whitespace-pre-wrap">{comment.content}</p>
            </div>
          </div>
        ))}
      </div>

      {canComment && <AddCommentForm entityType={entityType} entityId={entityId} />}
    </div>
  );
}
