import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tag } from "lucide-react";

interface PricingVersionInfo {
  version: {
    id: string;
    name: string;
    versionNumber: number;
    status: string;
  } | null;
  isLatest: boolean;
  latestName: string | null;
}

/**
 * Shows which price list a quotation is being built against.
 *
 * Users never choose a version. A project is pinned to whichever version was live when
 * it was created, so its prices stay put even after the catalog is republished. This
 * badge exists purely so nobody is surprised when an older quotation quotes older
 * prices than a new one.
 */
export default function PricingVersionBadge({ projectId }: { projectId?: string }) {
  const { data } = useQuery<PricingVersionInfo>({
    queryKey: ["/api/pricing-version", projectId],
    queryFn: async () => {
      const url = projectId
        ? `/api/pricing-version?projectId=${encodeURIComponent(projectId)}`
        : "/api/pricing-version";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load pricing version");
      return res.json();
    },
    // No stale window. This badge names the price list the quotation is being served, and
    // that can change under it — an admin publishing, or flipping the review switch, moves
    // every project onto a different list. A badge that lags the catalog by a minute is a
    // badge that tells someone the wrong prices are on screen.
    staleTime: 0,
  });

  if (!data?.version) return null;

  const { version, isLatest, latestName } = data;

  return (
    <TooltipProvider>
      <Tooltip>
        {/* Badge does not forward refs, so the trigger needs a real element to attach to. */}
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Badge
              variant="outline"
              className="gap-1 font-normal cursor-default"
              data-testid="badge-pricing-version"
            >
              <Tag className="h-3 w-3" />
              {version.name}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {isLatest ? (
            <p>This quotation uses the current price list ({version.name}).</p>
          ) : (
            <p>
              This quotation is priced using {version.name}, the price list that was current when it
              was created. Its prices will not change
              {latestName ? `, even though ${latestName} is now current.` : "."}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
