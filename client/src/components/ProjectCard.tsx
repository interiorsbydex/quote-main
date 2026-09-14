import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface ProjectCardProps {
  id: string;
  clientName: string;
  projectType: "Residential" | "Commercial" | "Others";
  status: "Draft" | "Generated";
  totalQuotes?: number;
  lastUpdated: Date;
  onClick?: () => void;
}

export default function ProjectCard({
  clientName,
  projectType,
  status,
  totalQuotes,
  lastUpdated,
  onClick,
}: ProjectCardProps) {
  return (
    <Card 
      className="hover-elevate active-elevate-2 cursor-pointer transition-all" 
      onClick={onClick}
      data-testid={`card-project-${clientName.toLowerCase().replace(/\s/g, '-')}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate" data-testid="text-client-name">
              {clientName}
            </h3>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-project-type">
              {projectType}
            </p>
          </div>
          <Badge 
            variant={status === "Generated" ? "default" : "secondary"}
            data-testid="badge-status"
          >
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {totalQuotes !== undefined && (
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground" data-testid="text-total-quotes">
              {totalQuotes} {totalQuotes === 1 ? 'line item' : 'line items'}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span data-testid="text-last-updated">
            {formatDistanceToNow(lastUpdated, { addSuffix: true })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
