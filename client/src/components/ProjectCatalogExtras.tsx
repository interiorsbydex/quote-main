import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, PackagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Exception = {
  itemCode: string;
  description: string | null;
  categoryName: string | null;
  sellingPrice: number | null;
  sourceVersionName: string;
  reason: string | null;
  addedByName: string | null;
  createdAt: string;
};

type VersionInfo = { version: { name: string } | null; isLatest: boolean; latestName: string | null };

const money = (n?: number | null) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Adds a product from the current price list to ONE older quotation.
 *
 * The alternative — editing the older published version — would change what every other
 * quotation pinned to that version can be built from, and published versions are frozen
 * precisely so that cannot happen. Recording the extra product against this project
 * keeps the exception exactly as wide as the problem.
 */
export default function ProjectCatalogExtras({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [itemCode, setItemCode] = useState("");
  const [reason, setReason] = useState("");

  const isAdmin = (user as any)?.role === "admin";

  const versionInfo = useQuery<VersionInfo>({
    queryKey: ["/api/pricing-version", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/pricing-version?projectId=${encodeURIComponent(projectId)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load pricing version");
      return r.json();
    },
    // See PricingVersionBadge: the served price list can change under this screen, so it
    // must not be shown from a stale cache.
    staleTime: 0,
  });

  const exceptions = useQuery<Exception[]>({
    queryKey: [`/api/projects/${projectId}/catalog-exceptions`],
    enabled: !!projectId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/catalog-exceptions`] });
    // The wizard's catalog now includes (or no longer includes) this product.
    queryClient.invalidateQueries({ queryKey: ["/api/catalog"] });
  };

  const add = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/projects/${projectId}/catalog-exceptions`, {
        itemCode: itemCode.trim(),
        reason: reason.trim() || undefined,
      }).then(r => r.json()),
    onSuccess: (d) => {
      setItemCode("");
      setReason("");
      invalidate();
      toast({ title: "Product added to this quotation", description: d.message });
    },
    onError: (e: Error) => toast({ title: "Could not add the product", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (code: string) =>
      apiRequest("DELETE", `/api/projects/${projectId}/catalog-exceptions/${encodeURIComponent(code)}`).then(r => r.json()),
    onSuccess: (d) => { invalidate(); toast({ title: "Product removed", description: d.message }); },
    onError: (e: Error) => toast({ title: "Could not remove the product", description: e.message, variant: "destructive" }),
  });

  const rows = exceptions.data || [];
  const onLatest = versionInfo.data?.isLatest !== false;

  // Nothing to show a non-admin unless products have actually been added, and nothing
  // to offer an admin when the quotation is already on the current price list.
  if (!isAdmin && rows.length === 0) return null;
  if (isAdmin && onLatest && rows.length === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        data-testid="button-project-catalog-extras"
      >
        <PackagePlus className="h-3.5 w-3.5" />
        {rows.length > 0 ? `${rows.length} added product${rows.length === 1 ? "" : "s"}` : "Add a newer product"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PackagePlus className="h-5 w-5 text-primary" />Products added to this quotation</DialogTitle>
            <DialogDescription>
              This quotation is priced from {versionInfo.data?.version?.name || "its own price list"}, so products introduced later are not normally available on it.
              Adding one here offers it to this quotation only, at the current price. Every other price on this quotation stays exactly where it is, and no other quotation is affected.
            </DialogDescription>
          </DialogHeader>

          {rows.length > 0 && (
            <div className="overflow-hidden rounded border">
              <div className="grid grid-cols-[7rem_1fr_6rem_auto] gap-3 bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
                <span>Code</span><span>Product</span><span className="text-right">Price</span><span />
              </div>
              <div className="divide-y">
                {rows.map(r => (
                  <div key={r.itemCode} className="grid grid-cols-[7rem_1fr_6rem_auto] items-center gap-3 px-4 py-2 text-sm" data-testid={`exception-${r.itemCode}`}>
                    <span className="font-mono text-xs">{r.itemCode}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{r.description || "Unnamed product"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        from {r.sourceVersionName}{r.addedByName ? ` · added by ${r.addedByName}` : ""}{r.reason ? ` · ${r.reason}` : ""}
                      </span>
                    </span>
                    <span className="text-right font-mono text-xs">{money(r.sellingPrice)}</span>
                    {isAdmin && (
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(r.itemCode)} disabled={remove.isPending} data-testid={`button-remove-exception-${r.itemCode}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="space-y-3 rounded border bg-muted/30 p-4">
              <div>
                <Label htmlFor="exception-code">Item code from the current price list</Label>
                <Input id="exception-code" value={itemCode} onChange={e => setItemCode(e.target.value)} placeholder="e.g. ACC-0042" data-testid="input-exception-code" />
              </div>
              <div>
                <Label htmlFor="exception-reason">Why (optional)</Label>
                <Input id="exception-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. client asked for the new handle range" data-testid="input-exception-reason" />
              </div>
              <Button onClick={() => add.mutate()} disabled={add.isPending || !itemCode.trim()} data-testid="button-add-exception">
                {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add to this quotation
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-close-extras">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
