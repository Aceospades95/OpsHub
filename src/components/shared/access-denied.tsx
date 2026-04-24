import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RequestAccessButton } from "./request-access-button";

interface AccessDeniedProps {
  module: string;
  moduleLabel: string;
  moduleDescription?: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
}

export function AccessDenied({
  module,
  moduleLabel,
  moduleDescription,
  entityType,
  entityId,
  entityLabel,
}: AccessDeniedProps) {
  const isEntityRequest = !!entityType && !!entityId;
  const title = isEntityRequest
    ? `You don’t have permission to view this ${entityType}.`
    : `You don’t have permission to view ${moduleLabel}.`;

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center text-center p-8">
          <div className="rounded-full bg-muted p-4 mb-4">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Access Required</h2>
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          {entityLabel && (
            <p className="text-xs text-muted-foreground font-medium">&ldquo;{entityLabel}&rdquo;</p>
          )}
          {moduleDescription && (
            <p className="text-xs text-muted-foreground mt-1">{moduleDescription}</p>
          )}
          <div className="mt-6">
            <RequestAccessButton
              module={module}
              moduleLabel={moduleLabel}
              entityType={entityType}
              entityId={entityId}
              entityLabel={entityLabel}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
