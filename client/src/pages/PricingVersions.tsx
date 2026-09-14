import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, ClipboardCheck,
  Database, Eye, FileSpreadsheet, History, Loader2, LockKeyhole, PackagePlus,
  RefreshCw, RotateCcw, Search, ShieldCheck, Upload, Zap
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Version = { id: string; versionNumber: number; name?: string; status: "draft" | "active" | "archived"; itemCount: number; actualItemCount: number; projectCount: number; notes?: string; publishedAt?: string; createdAt: string };
type Change = { itemCode: string; roomType?: string | null; categoryName: string; description: string; oldRate?: number; newRate?: number; oldSellingPrice?: number; newSellingPrice?: number; oldImageUrl?: string | null; newImageUrl?: string | null; priceChanged?: boolean; imageChanged?: boolean; changePct?: number };
type Diff = { draftItemCount: number; changed: Change[]; added: Change[]; removed: Change[]; unchangedCount: number; uncomparable?: { from: number; to: number } };
type Tab = { sheetTabId: number; tabTitle: string; categoryName: string; itemCodePrefix: string; layout: string; itemType: string; enabled: boolean; sortOrder: number };
type CodePreview = { totalToAssign: number; totalAlreadyCoded: number; totalDataRows: number; tabs: Array<{ sheetTabId: string; tabTitle: string; prefix: string; headerPresent: boolean; dataRows: number; alreadyCoded: number; toAssign: number; duplicateCodes: string[]; malformedCodes: string[]; sample: string[] }> };
type Audit = { id: string; action: string; summary: string; itemCode?: string; createdAt: string; performed_by_name?: string };
type DraftTab = { sheetTabId: number; tabTitle: string; categoryName: string; itemCount: number; lastSyncedAt?: string | null; lastSyncedBy?: string | null };
type DraftStatus = {
  draft: { id: string; name: string; itemCount: number; updatedAt?: string } | null;
  tabs: DraftTab[];
  lastSync: { startedAt: string; completedAt?: string | null; status: string; totalItems: number; errorCount: number; warningCount: number; syncedBy?: string | null } | null;
};
type VersionItem = { itemCode: string | null; categoryName: string | null; roomType: string | null; unitType: string | null; materialType: string | null; brand: string | null; description: string | null; rate: number | null; markup: number | null; sellingPrice: number | null };
type VersionItems = { version: { id: string; name: string; status: string }; total: number; limit: number; offset: number; items: VersionItem[] };
type NewProductTab = {
  sheetTabId: number;
  tabTitle: string;
  categoryName: string;
  itemCodePrefix: string;
  layout: string;
  headers: Array<{ index: number; column: string; label: string }>;
  priceColumn: { index: number; column: string; label: string };
};
type NewProductOptions = {
  tabs: NewProductTab[];
  versions: Array<{ id: string; versionNumber: number; name: string; status: "draft" | "active" | "archived"; itemCount: number }>;
};

const money = (n?: number | null) => n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

async function getJson<T>(url: string): Promise<T> { const r = await fetch(url, { credentials: "include" }); if (!r.ok) throw new Error(await r.text() || "Request failed"); return r.json(); }

function Skeleton({ className = "" }: { className?: string }) { return <div className={`animate-pulse rounded bg-muted ${className}`} />; }

function ChangeRow({ row, kind }: { row: Change; kind: "up" | "down" | "image" | "added" | "removed" }) {
  const pct = row.changePct ?? 0;
  const color = kind === "up" ? "text-rose-700 bg-rose-50 border-rose-200" : kind === "down" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : kind === "image" ? "text-violet-700 bg-violet-50 border-violet-200" : kind === "added" ? "text-sky-700 bg-sky-50 border-sky-200" : "text-slate-600 bg-slate-50 border-slate-200";
  return <div className="grid grid-cols-[minmax(6rem,1fr)_minmax(12rem,2fr)_auto_auto_auto] gap-3 items-center px-4 py-3 border-b last:border-0 text-sm">
    <span className="font-mono text-xs font-semibold text-foreground">{row.itemCode}</span>
    <span className="min-w-0"><span className="block truncate font-medium">{row.description || "Unnamed item"}</span><span className="text-xs text-muted-foreground">{row.categoryName}{row.roomType ? ` · ${row.roomType}` : ""}</span></span>
    {kind === "image"
      ? <span className="text-xs text-muted-foreground whitespace-nowrap">Product image updated</span>
      : <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{money(row.oldSellingPrice ?? row.oldRate)} <span className="mx-1">→</span> <strong className="text-foreground">{money(row.newSellingPrice ?? row.newRate)}</strong>{row.imageChanged && <span className="ml-2 font-sans text-violet-700">· image updated</span>}</span>}
    <span className={`rounded border px-2 py-1 text-xs font-semibold whitespace-nowrap ${color}`}>{kind === "added" ? "New" : kind === "removed" ? "Removed" : kind === "image" ? "Image" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}</span>
    {kind !== "image" && Math.abs(pct) >= 25 && <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Large price movement" />}
  </div>;
}

function DiffSection({ title, rows, kind }: { title: string; rows: Change[]; kind: "up" | "down" | "image" | "added" | "removed" }) {
  const [open, setOpen] = useState(true);
  if (!rows.length) return null;
  return <section className="border rounded-lg overflow-hidden">
    <button className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover-elevate text-left" onClick={() => setOpen(!open)} data-testid={`button-toggle-${kind}-changes`}>
      <span className="flex items-center gap-2 font-semibold text-sm">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{title}<Badge variant="secondary">{rows.length}</Badge></span>
      {kind === "up" && <span className="text-xs text-rose-700">Raises client-facing prices for new quotes</span>}
      {kind === "down" && <span className="text-xs text-emerald-700">Lowers prices for new quotes</span>}
      {kind === "image" && <span className="text-xs text-violet-700">Updates the product image shown in the catalog</span>}
    </button>
    {open && <div className="max-h-[25rem] overflow-auto">{rows.map((r, i) => <ChangeRow key={`${r.itemCode}-${i}`} row={r} kind={kind} />)}</div>}
  </section>;
}

/**
 * What is sitting in the Draft, and who put it there.
 *
 * The Draft carries over between syncs, so the person publishing is often not the
 * person who last synced. Showing each tab's last sync means nobody publishes changes
 * they have never seen.
 */
function DraftProvenance({ status, loading }: { status?: DraftStatus; loading: boolean }) {
  if (loading) return <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>;
  if (!status?.draft) return null;

  const stale = status.tabs.filter(t => !t.lastSyncedAt);
  const lastSync = status.lastSync;

  return <Card data-testid="card-draft-provenance">
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-amber-600" />What is in the Draft right now</CardTitle>
      <CardDescription>
        {status.draft.itemCount.toLocaleString()} items in total.
        {lastSync ? ` Last sync ${dateTime(lastSync.completedAt || lastSync.startedAt)} by ${lastSync.syncedBy || "an admin"}.` : " Nothing has been synced into it yet."}
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {lastSync && (lastSync.errorCount > 0 || lastSync.warningCount > 0) && <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        The last sync finished with {lastSync.errorCount} error{lastSync.errorCount === 1 ? "" : "s"} and {lastSync.warningCount} warning{lastSync.warningCount === 1 ? "" : "s"}. Check those rows in the Sheet before publishing.
      </div>}
      {stale.length > 0 && <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
        {stale.length} tab{stale.length === 1 ? " has" : "s have"} never been synced into this Draft: {stale.map(t => t.categoryName).join(", ")}. Those prices are carried over from the last published version.
      </div>}
      <div className="overflow-hidden rounded border">
        <div className="grid grid-cols-[2fr_auto_1.5fr] gap-3 bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"><span>Sheet tab</span><span className="text-right">Items</span><span>Last synced</span></div>
        <div className="divide-y">{status.tabs.map(t => <div key={t.sheetTabId} className="grid grid-cols-[2fr_auto_1.5fr] gap-3 px-4 py-2 text-sm" data-testid={`draft-tab-${t.sheetTabId}`}>
          <span className="min-w-0 truncate">{t.categoryName}</span>
          <span className="text-right font-mono text-xs">{t.itemCount.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">{t.lastSyncedAt ? `${dateTime(t.lastSyncedAt)}${t.lastSyncedBy ? ` · ${t.lastSyncedBy}` : ""}` : "carried over"}</span>
        </div>)}</div>
      </div>
    </CardContent>
  </Card>;
}

/** Read-only look at the prices inside any version, so a past quote can be explained. */
function VersionViewer({ version, onClose }: { version: Version | null; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setOffset(0); }, 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { if (!version) { setSearch(""); setDebounced(""); setOffset(0); } }, [version]);

  const q = useQuery<VersionItems>({
    queryKey: [`/api/admin/pricing-versions/${version?.id}/items`, debounced, offset],
    queryFn: () => getJson<VersionItems>(`/api/admin/pricing-versions/${version!.id}/items?search=${encodeURIComponent(debounced)}&limit=${LIMIT}&offset=${offset}`),
    enabled: !!version,
  });

  return <Dialog open={!!version} onOpenChange={open => !open && onClose()}>
    <DialogContent className="max-w-5xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5" />Prices in Version {version?.versionNumber}{version?.name ? ` · ${version.name}` : ""}</DialogTitle>
        <DialogDescription>Read-only. This is exactly what quotations on this version are priced from — nothing here can be edited.</DialogDescription>
      </DialogHeader>
      <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search by code, description, category or brand" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-version-search" /></div>
      <div className="overflow-hidden rounded border">
        <div className="grid grid-cols-[7rem_1fr_8rem_6rem] gap-3 bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"><span>Code</span><span>Item</span><span>Category</span><span className="text-right">Price</span></div>
        <div className="max-h-[24rem] divide-y overflow-auto">
          {q.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            : !q.data?.items.length ? <div className="p-10 text-center text-sm text-muted-foreground">No items match that search.</div>
              : q.data.items.map((it, i) => <div key={`${it.itemCode}-${i}`} className="grid grid-cols-[7rem_1fr_8rem_6rem] gap-3 px-4 py-2 text-sm" data-testid={`version-item-${it.itemCode}`}>
                <span className="font-mono text-xs">{it.itemCode || "—"}</span>
                <span className="min-w-0 truncate">{it.description || "Unnamed item"}{it.brand ? <span className="text-muted-foreground"> · {it.brand}</span> : ""}</span>
                <span className="truncate text-xs text-muted-foreground">{it.categoryName}</span>
                <span className="text-right font-mono text-xs">{money(it.sellingPrice ?? it.rate)}</span>
              </div>)}
        </div>
      </div>
      <DialogFooter className="items-center justify-between sm:justify-between">
        <span className="text-xs text-muted-foreground">{q.data ? `Showing ${q.data.items.length ? offset + 1 : 0}–${offset + q.data.items.length} of ${q.data.total.toLocaleString()}` : ""}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} data-testid="button-version-prev">Previous</Button>
          <Button variant="outline" size="sm" disabled={!q.data || offset + LIMIT >= q.data.total} onClick={() => setOffset(offset + LIMIT)} data-testid="button-version-next">Next</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function PricingVersions() {
  const { toast } = useToast();
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishAck, setPublishAck] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateAck, setUpdateAck] = useState(false);
  const [updateNotes, setUpdateNotes] = useState("");
  const [revertTarget, setRevertTarget] = useState<Version | null>(null);
  const [viewing, setViewing] = useState<Version | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [selectedGids, setSelectedGids] = useState<number[] | null>(null);
  const [publishName, setPublishName] = useState("");
  const [publishNotes, setPublishNotes] = useState("");
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProductTabId, setNewProductTabId] = useState<number | null>(null);
  const [newProductCode, setNewProductCode] = useState("");
  const [newProductCells, setNewProductCells] = useState<Record<number, string>>({});
  const [newProductPrices, setNewProductPrices] = useState<Record<string, string>>({});
  const [tab, setTab] = useState("overview");

  const versions = useQuery<Version[]>({ queryKey: ["/api/admin/pricing-versions"] });
  const preview = useQuery<Diff>({ queryKey: ["/api/admin/pricing-versions/preview"] });
  const draftStatus = useQuery<DraftStatus>({ queryKey: ["/api/admin/pricing-versions/draft-status"] });
  const sheetTabs = useQuery<Tab[]>({ queryKey: ["/api/admin/sheet-tabs"] });
  const codePreview = useQuery<CodePreview>({ queryKey: ["/api/admin/item-codes/preview"] });
  const audit = useQuery<Audit[]>({ queryKey: ["/api/admin/pricing-versions/audit?limit=100"] });
  const instantSync = useQuery<{ enabled: boolean }>({ queryKey: ["/api/admin/settings/instant-sync"] });
  const newProductOptions = useQuery<NewProductOptions>({
    queryKey: ["/api/admin/new-products/options"],
    enabled: newProductOpen,
  });
  const instantSyncOn = instantSync.data?.enabled ?? false;

  const live = versions.data?.find(v => v.status === "active");
  const draft = versions.data?.find(v => v.status === "draft");
  const diff = preview.data;
  const totalChanges = (diff?.changed.length || 0) + (diff?.added.length || 0) + (diff?.removed.length || 0);
  const priceChanges = diff?.changed.filter(change => change.priceChanged !== false) || [];
  const imageOnlyChanges = diff?.changed.filter(change => change.imageChanged && change.priceChanged === false) || [];
  const imageChangeCount = diff?.changed.filter(change => change.imageChanged).length || 0;
  const enabledTabs = useMemo(() => (sheetTabs.data || []).filter(t => t.enabled), [sheetTabs.data]);
  // No explicit choice means every tab, which is what the button says it will do.
  const gidsToSync = selectedGids ?? enabledTabs.map(t => t.sheetTabId);
  const selectedProductTab = newProductOptions.data?.tabs.find(t => t.sheetTabId === newProductTabId);
  const selectedProductDestinations = Object.entries(newProductPrices)
    .filter(([, price]) => price !== "")
    .map(([versionId, price]) => ({ versionId, price: Number(price) }));
  const selectedDraft = newProductOptions.data?.versions.find(
    v => v.status === "draft" && newProductPrices[v.id] !== undefined
  );

  useEffect(() => {
    if (newProductOpen && !newProductTabId && newProductOptions.data?.tabs[0]) {
      setNewProductTabId(newProductOptions.data.tabs[0].sheetTabId);
    }
  }, [newProductOpen, newProductOptions.data, newProductTabId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-versions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-versions/preview"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-versions/draft-status"] });
  };

  const refresh = useMutation({
    mutationFn: (gids?: number[]) => apiRequest("POST", "/api/catalog/refresh", gids && gids.length ? { tabGids: gids } : undefined).then(r => r.json()),
    onSuccess: (d) => {
      setSyncOpen(false);
      setSelectedGids(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-versions/audit?limit=100"] });
      toast({
        title: d.liveError ? "Synced, but prices are not live" : d.appliedLive ? "Prices are live" : d.success ? "Draft refreshed" : "Draft refreshed with warnings",
        description: d.message,
        variant: d.liveError ? "destructive" : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });
  const publish = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/pricing-versions/publish", { name: publishName || undefined, notes: publishNotes || undefined }).then(r => r.json()),
    onSuccess: (d) => { setPublishOpen(false); setPublishAck(false); setPublishName(""); setPublishNotes(""); invalidate(); toast({ title: "Version published", description: d.message }); },
    onError: (e: Error) => toast({ title: "Publish failed", description: e.message, variant: "destructive" }),
  });
  const updateLive = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/pricing-versions/update-live", { notes: updateNotes || undefined }).then(r => r.json()),
    onSuccess: (d) => { setUpdateOpen(false); setUpdateAck(false); setUpdateNotes(""); invalidate(); queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-versions/audit?limit=100"] }); toast({ title: "Live price list updated", description: d.message }); },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
  const setInstantSync = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("PUT", "/api/admin/settings/instant-sync", { enabled }).then(r => r.json()),
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/instant-sync"] }); invalidate(); toast({ title: d.enabled ? "Sync now goes live immediately" : "Review step turned on", description: d.message }); },
    onError: (e: Error) => toast({ title: "Could not change the setting", description: e.message, variant: "destructive" }),
  });
  const revert = useMutation({
    mutationFn: (versionId: string) => apiRequest("POST", `/api/admin/pricing-versions/${versionId}/revert`).then(r => r.json()),
    onSuccess: (d) => { setRevertTarget(null); invalidate(); toast({ title: "Change applied", description: d.message }); },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });
  const generateCodes = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/item-codes/generate").then(r => r.json()),
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ["/api/admin/item-codes/preview"] }); toast({ title: "Codes generated", description: d.message }); },
    onError: (e: Error) => toast({ title: "Could not generate codes", description: e.message, variant: "destructive" }),
  });
  const addProduct = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/new-products", {
      sheetTabId: newProductTabId,
      itemCode: newProductCode || undefined,
      cells: newProductCells,
      destinations: selectedProductDestinations,
    }).then(r => r.json()),
    onSuccess: (data) => {
      setNewProductOpen(false);
      setNewProductTabId(null);
      setNewProductCode("");
      setNewProductCells({});
      setNewProductPrices({});
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/new-products/options"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-versions/audit?limit=100"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/item-codes/preview"] });
      toast({ title: "Product added", description: data.message });
    },
    onError: (error: Error) => toast({ title: "Could not add product", description: error.message, variant: "destructive" }),
  });
  const invalidCodes = useMemo(() => (codePreview.data?.tabs || []).reduce((n, t) => n + t.duplicateCodes.length + t.malformedCodes.length, 0), [codePreview.data]);

  const toggleGid = (gid: number) => {
    const current = gidsToSync;
    setSelectedGids(current.includes(gid) ? current.filter(g => g !== gid) : [...current, gid]);
  };

  return <div className="min-h-screen bg-background">
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3"><Link href="/admin" className="rounded-md p-2 hover-elevate" data-testid="link-back-admin"><ArrowLeft className="h-4 w-4" /></Link><div><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Interiors by DeX</p><h1 className="font-semibold">Pricing versions</h1></div></div>
        <Badge variant="outline" className="gap-2 border-emerald-300 text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> Protected pricing control</Badge>
      </div>
    </header>
    <main className="container mx-auto max-w-7xl space-y-7 px-4 py-8 md:px-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-2 text-sm font-medium text-primary">Catalog control room</p><h2 className="text-3xl font-semibold tracking-tight">Prices change here only when you say so.</h2><p className="mt-2 max-w-2xl text-muted-foreground">The Sheet is your source. The Draft is your review copy. Only Publish creates a frozen version for new quotations.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Button variant="outline" onClick={() => setNewProductOpen(true)} data-testid="button-add-new-product"><PackagePlus className="mr-2 h-4 w-4" />Add New Product</Button><Button onClick={() => { setSelectedGids(null); setSyncOpen(true); }} disabled={refresh.isPending} data-testid="button-sync-sheet"><RefreshCw className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} />{refresh.isPending ? "Syncing sheet…" : instantSyncOn ? "Sync sheet & go live" : "Sync Google Sheet"}</Button></div></div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-l-4 border-l-sky-500"><CardHeader className="pb-3"><CardDescription className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-sky-600" />1 · Google Sheet</CardDescription><CardTitle className="text-lg">Team’s working source</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Edit prices freely. Nothing changes for clients until this is synced, reviewed, and published.</p></CardContent></Card>
        <Card className="border-l-4 border-l-amber-500"><CardHeader className="pb-3"><CardDescription className="flex items-center gap-2"><Database className="h-4 w-4 text-amber-600" />2 · Draft</CardDescription><CardTitle className="text-lg">{draft ? `${draft.actualItemCount.toLocaleString()} items ready` : "Working copy"}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Syncing refreshes this one editable copy. Repeated syncs never create versions.</p></CardContent></Card>
        <Card className="border-l-4 border-l-emerald-600"><CardHeader className="pb-3"><CardDescription className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-emerald-700" />3 · Live version</CardDescription><CardTitle className="text-lg">{live ? `Version ${live.versionNumber}` : "No version published"}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{live ? `${live.projectCount} existing projects use their own frozen prices.` : "Publish a reviewed draft to start quoting."}</p></CardContent></Card>
      </div>
      <Card className={instantSyncOn ? "border-amber-300 bg-amber-50/60" : ""}>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium">{instantSyncOn ? "Reviewing is turned off — every sync goes live immediately" : "Reviewing is turned on — you decide when prices go live"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {instantSyncOn
                ? "Syncing the Google Sheet puts the new prices in front of everyone straight away, exactly as the app worked before pricing versions. Turn this off when the team is ready to review changes before they go live."
                : "Syncing the Google Sheet fills the Draft only. Nothing reaches users until you update the live price list or release a new version."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Label htmlFor="instant-sync" className="text-sm">Sync goes live instantly</Label>
            <Switch
              id="instant-sync"
              checked={instantSyncOn}
              disabled={instantSync.isLoading || setInstantSync.isPending}
              onCheckedChange={v => setInstantSync.mutate(v)}
              data-testid="switch-instant-sync"
            />
          </div>
        </CardContent>
      </Card>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950"><strong>Prices already saved on a quotation never move.</strong> Reviewed changes can either be applied to the live price list — so every project already on it can use the new items — or released as a brand new version. A new version is created only by the second one.</div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto"><TabsTrigger value="overview" data-testid="tab-price-preview">Draft preview {totalChanges > 0 && <Badge className="ml-2" variant="secondary">{totalChanges}</Badge>}</TabsTrigger><TabsTrigger value="versions" data-testid="tab-published-versions">Published versions</TabsTrigger><TabsTrigger value="wiring" data-testid="tab-sheet-wiring">Sheet wiring</TabsTrigger><TabsTrigger value="audit" data-testid="tab-audit-log">Audit log</TabsTrigger><TabsTrigger value="help" data-testid="tab-help">How this works</TabsTrigger></TabsList>
        <TabsContent value="overview" className="space-y-5 pt-5">
          <DraftProvenance status={draftStatus.data} loading={draftStatus.isLoading} />
          <Card><CardHeader><div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary" />Review Draft before publishing</CardTitle><CardDescription className="mt-1">{live ? `Draft compared with Live Version ${live.versionNumber}.` : "Your first draft is ready for review."} Price and product-image changes are shown here.</CardDescription></div><div className="flex flex-col items-end gap-2"><div className="flex flex-col gap-2 sm:flex-row"><Button disabled={!diff || totalChanges === 0 || !live || (diff?.uncomparable?.to ?? 0) > 0} onClick={() => { setUpdateAck(false); setUpdateOpen(true); }} data-testid="button-update-live"><Zap className="mr-2 h-4 w-4" />Update live price list</Button><Button variant="outline" disabled={!diff || totalChanges === 0} onClick={() => { setPublishAck(false); setPublishOpen(true); }} data-testid="button-publish-version"><Upload className="mr-2 h-4 w-4" />Release as new version</Button></div>{(diff?.uncomparable?.to ?? 0) > 0 && <p className="flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{diff!.uncomparable!.to} item{diff!.uncomparable!.to === 1 ? "" : "s"} in the Draft {diff!.uncomparable!.to === 1 ? "has" : "have"} no item code yet — go to <button className="underline underline-offset-2" onClick={() => setTab("wiring")}>Sheet Wiring → Item Codes</button>, generate codes, then re-sync before updating live.</p>}</div></div></CardHeader><CardContent>{preview.isLoading ? <div className="space-y-3"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div> : preview.isError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">Could not load the comparison. Refresh the page and try again.</div> : !diff || totalChanges === 0 ? <div className="flex flex-col items-center rounded-lg border border-dashed py-14 text-center"><Check className="mb-3 h-8 w-8 text-emerald-600" /><p className="font-medium">Draft matches Live</p><p className="mt-1 text-sm text-muted-foreground">There are no catalog changes waiting to be published.</p></div> : <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-5"><div className="rounded-lg bg-rose-50 p-3"><p className="text-xs text-rose-700">Price changes</p><p className="font-mono text-xl font-semibold text-rose-900">{priceChanges.length}</p></div><div className="rounded-lg bg-violet-50 p-3"><p className="text-xs text-violet-700">Image changes</p><p className="font-mono text-xl font-semibold text-violet-900">{imageChangeCount}</p></div><div className="rounded-lg bg-sky-50 p-3"><p className="text-xs text-sky-700">Added</p><p className="font-mono text-xl font-semibold text-sky-900">{diff.added.length}</p></div><div className="rounded-lg bg-slate-100 p-3"><p className="text-xs text-slate-600">Removed</p><p className="font-mono text-xl font-semibold">{diff.removed.length}</p></div><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Unchanged</p><p className="font-mono text-xl font-semibold">{diff.unchangedCount}</p></div></div>{priceChanges.length > 0 && <div className="rounded border bg-amber-50/60 p-3 text-sm text-amber-950"><AlertTriangle className="mr-2 inline h-4 w-4" />Rows with a 25% or larger movement are flagged. Check the Sheet for mistyped rates before publishing.</div>}<DiffSection title="Changed prices" rows={priceChanges.filter(r => (r.changePct || 0) >= 0)} kind="up" /><DiffSection title="Changed prices" rows={priceChanges.filter(r => (r.changePct || 0) < 0)} kind="down" /><DiffSection title="Changed product images" rows={imageOnlyChanges} kind="image" /><DiffSection title="New catalog items" rows={diff.added} kind="added" /><DiffSection title="Removed from Draft" rows={diff.removed} kind="removed" /></div>}</CardContent></Card>
        </TabsContent>
        <TabsContent value="versions" className="pt-5"><Card><CardHeader><CardTitle>Frozen snapshots</CardTitle><CardDescription>One version is Live at a time. Each snapshot keeps quotations safe from future catalog edits, and can be opened to see exactly what it holds.</CardDescription></CardHeader><CardContent className="p-0">{versions.isLoading ? <div className="space-y-3 p-6"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : !versions.data?.filter(v => v.status !== "draft").length ? <div className="p-12 text-center text-sm text-muted-foreground">No pricing versions yet. Review your Draft and publish the first one.</div> : <div className="divide-y">{versions.data.filter(v => v.status !== "draft").map(v => <div key={v.id} className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between" data-testid={`version-row-${v.versionNumber}`}><div className="flex items-start gap-3"><div className={`mt-1 rounded-full p-2 ${v.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}><LockKeyhole className="h-4 w-4" /></div><div><div className="flex items-center gap-2 font-semibold">Version {v.versionNumber} {v.name && <span className="font-normal text-muted-foreground">· {v.name}</span>}<Badge variant={v.status === "active" ? "default" : "secondary"}>{v.status === "active" ? "Live" : v.status}</Badge></div><p className="text-sm text-muted-foreground">{v.actualItemCount.toLocaleString()} items · {v.projectCount} projects · {v.publishedAt ? `published ${date(v.publishedAt)}` : `created ${date(v.createdAt)}`}</p></div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setViewing(v)} data-testid={`button-view-${v.versionNumber}`}><Eye className="mr-2 h-3.5 w-3.5" />View prices</Button>{v.status !== "active" && <Button variant="outline" size="sm" onClick={() => setRevertTarget(v)} data-testid={`button-revert-${v.versionNumber}`}><RotateCcw className="mr-2 h-3.5 w-3.5" />Make this live again</Button>}</div></div>)}</div>}</CardContent></Card></TabsContent>
        <TabsContent value="wiring" className="space-y-5 pt-5"><Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-primary" />Google Sheet tabs</CardTitle><CardDescription>These tabs are wired to the catalog sync. Disabled tabs are intentionally excluded and will not affect the Draft.</CardDescription></CardHeader><CardContent className="p-0">{sheetTabs.isLoading ? <div className="space-y-3 p-6"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : !sheetTabs.data?.length ? <div className="p-10 text-center text-sm text-muted-foreground">No Sheet tabs configured.</div> : <div className="divide-y">{sheetTabs.data.map(t => <div className={`flex items-center justify-between gap-4 px-5 py-4 ${!t.enabled ? "bg-muted/60 opacity-70" : ""}`} key={t.sheetTabId} data-testid={`sheet-tab-${t.sheetTabId}`}><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${t.enabled ? "bg-emerald-500" : "bg-slate-400"}`} /><div><p className="font-medium">{t.tabTitle} {!t.enabled && <Badge variant="outline" className="ml-2">Disabled · stale duplicate</Badge>}</p><p className="text-xs text-muted-foreground">{t.categoryName} · prefix <span className="font-mono">{t.itemCodePrefix}</span> · {t.layout}</p></div></div><span className="text-xs text-muted-foreground">{t.enabled ? "Syncs to Draft" : "Not synced"}</span></div>)}</div>}</CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-amber-600" />Item codes</CardTitle><CardDescription>Codes let the app track the same item safely across versions. Duplicate or malformed codes can make a comparison unreliable.</CardDescription></CardHeader><CardContent>{codePreview.isLoading ? <Skeleton className="h-24 w-full" /> : codePreview.data && <><div className="mb-4 grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Rows scanned</p><p className="font-mono text-lg">{codePreview.data.totalDataRows}</p></div><div><p className="text-xs text-muted-foreground">Already coded</p><p className="font-mono text-lg">{codePreview.data.totalAlreadyCoded}</p></div><div><p className="text-xs text-muted-foreground">Codes to assign</p><p className="font-mono text-lg">{codePreview.data.totalToAssign}</p></div></div>{invalidCodes > 0 && <div className="mb-4 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{invalidCodes} duplicate or malformed code issue{invalidCodes === 1 ? "" : "s"} found. Resolve these before relying on a diff.</div>}<Button variant="outline" onClick={() => generateCodes.mutate()} disabled={generateCodes.isPending || invalidCodes > 0 || codePreview.data.totalToAssign === 0} data-testid="button-generate-item-codes">{generateCodes.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{codePreview.data.totalToAssign ? `Generate ${codePreview.data.totalToAssign} codes` : "All rows have codes"}</Button></>}</CardContent></Card>
        </TabsContent>
        <TabsContent value="audit" className="pt-5"><Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Pricing audit trail</CardTitle><CardDescription>Every sync, publish, revert, and per-quotation product addition is recorded here with who did it and when.</CardDescription></CardHeader><CardContent className="p-0">{audit.isLoading ? <div className="space-y-3 p-6"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : !audit.data?.length ? <div className="p-12 text-center text-sm text-muted-foreground">No pricing actions recorded yet.</div> : <div className="divide-y">{audit.data.map(a => <div key={a.id} className="flex gap-3 px-5 py-3 text-sm"><div className="mt-1 h-2 w-2 rounded-full bg-primary" /><div><p className="font-medium">{a.summary}</p><p className="text-xs text-muted-foreground">{a.action}{a.itemCode ? ` · ${a.itemCode}` : ""} · {a.performed_by_name || "Admin"} · {date(a.createdAt)}</p></div></div>)}</div>}</CardContent></Card></TabsContent>
        <TabsContent value="help" className="space-y-5 pt-5">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" />The one rule</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
            <p className="text-base font-medium">A new version is created only when someone clicks “Release as new version”. Nothing else creates one.</p>
            <p className="text-muted-foreground">Editing the Google Sheet does not create a version. Syncing does not create a version. Neither does “Update live price list” — that applies your reviewed changes to the price list already in use, keeping its number. The number of versions you will ever have equals the number of times someone released one.</p>
            <div className="grid gap-3 md:grid-cols-2 pt-1">
              <div className="rounded-lg border-l-4 border-l-primary bg-muted/40 p-3"><p className="font-medium">Update live price list</p><p className="mt-1 text-muted-foreground">For everyday work: a new product, a corrected rate. The live list is updated in place, so every project already using it can pick the new items immediately. Nothing already saved on a quotation changes.</p></div>
              <div className="rounded-lg border-l-4 border-l-emerald-600 bg-muted/40 p-3"><p className="font-medium">Release as new version</p><p className="mt-1 text-muted-foreground">For a deliberate rate overhaul. Creates the next numbered edition and makes it live for new projects. Projects already created stay on the edition they were quoted from.</p></div>
            </div>
            <div className="grid gap-3 md:grid-cols-3 pt-2">
              <div className="rounded-lg border-l-4 border-l-sky-500 bg-muted/40 p-3"><p className="font-medium">The Sheet</p><p className="mt-1 text-muted-foreground">Your workshop. Change anything, any time. Clients never see it.</p></div>
              <div className="rounded-lg border-l-4 border-l-amber-500 bg-muted/40 p-3"><p className="font-medium">The Draft</p><p className="mt-1 text-muted-foreground">One tray. Syncing empties and refills it from the Sheet. There is only ever one.</p></div>
              <div className="rounded-lg border-l-4 border-l-emerald-600 bg-muted/40 p-3"><p className="font-medium">Published versions</p><p className="mt-1 text-muted-foreground">Frozen editions. Once published, the prices inside can never change.</p></div>
            </div>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Common situations</CardTitle><CardDescription>What actually happens, in plain terms.</CardDescription></CardHeader><CardContent className="divide-y text-sm">
            {[
              ["The team changes 30–40 items in the Sheet. Is that V2 automatically?", "No. Those edits sit in the Sheet until someone syncs, and then sit in the Draft until someone publishes. Nothing becomes a version on its own."],
              ["They then change one more item. Is that V3?", "No. That item joins the same Draft. Whether you changed one item or two thousand, the next Publish produces exactly one new version."],
              ["We raise prices 20% now, and another 20% in six months.", "Two publishes, so two versions. That is correct and expected — each one is a genuine price edition, and quotations sent between them keep the prices they were quoted at."],
              ["Only the plywood tab changed. Do we have to sync everything?", "No. Click Sync Google Sheet and tick only the tabs you changed. Untouched tabs keep the prices already in the Draft."],
              ["We published something wrong.", "Use \"Make this live again\" on the previous version. It becomes live immediately for new quotations. Quotations already created are unaffected either way — they were never at risk."],
              ["We added one new product. Do our existing projects have to wait for a new version?", "No. Sync it, review it, then use \"Update live price list\". Every project already on that price list can add the product straight away, and no numbered version is created."],
              ["A client on an old quotation wants a product we added recently.", "If that quotation is on the live price list, updating the live list is enough. If it is on an older archived version, open that quotation and add the product to it specifically — it is priced from the current list, recorded against that one quotation, and no other client is affected."],
              ["Does updating the live price list change quotations we have already sent?", "No. Every line on a quotation stores its own price at the moment it was added, so it stays exactly as quoted. The update only changes what can be added from now on, and at what price."],
              ["Can we correct a price inside an archived version?", "No, and this is deliberate. An archived version is the historical record of what those quotations were priced from. Correct the live list, or release a new version."],
            ].map(([q, a], i) => <div key={i} className="py-3 first:pt-0 last:pb-0"><p className="font-medium">{q}</p><p className="mt-1 text-muted-foreground">{a}</p></div>)}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </main>

    <VersionViewer version={viewing} onClose={() => setViewing(null)} />

    <Dialog open={newProductOpen} onOpenChange={open => {
      setNewProductOpen(open);
      if (!open && !addProduct.isPending) {
        setNewProductTabId(null);
        setNewProductCode("");
        setNewProductCells({});
        setNewProductPrices({});
      }
    }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackagePlus className="h-5 w-5 text-primary" />Add New Product</DialogTitle>
          <DialogDescription>
            Creates a brand-new item only in the versions you select. Existing products, prices, and quotations are not edited.
          </DialogDescription>
        </DialogHeader>
        {newProductOptions.isLoading ? <div className="space-y-3 py-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div>
          : newProductOptions.isError ? <div className="rounded border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not load the Sheet structure. Close this window and try again.</div>
          : <div className="space-y-6">
            <section className="space-y-3">
              <div>
                <Label htmlFor="new-product-tab">Destination catalog tab</Label>
                <select
                  id="new-product-tab"
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={newProductTabId ?? ""}
                  onChange={event => {
                    setNewProductTabId(Number(event.target.value));
                    setNewProductCells({});
                    setNewProductCode("");
                  }}
                  data-testid="select-new-product-tab"
                >
                  {(newProductOptions.data?.tabs || []).map(productTab => <option key={productTab.sheetTabId} value={productTab.sheetTabId}>{productTab.categoryName} · {productTab.tabTitle}</option>)}
                </select>
              </div>
              {selectedProductTab && <div className="rounded border bg-muted/30 p-4">
                <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                  <div><p className="font-medium">{selectedProductTab.categoryName}</p><p className="text-xs text-muted-foreground">Fields match the live Sheet headers and columns exactly.</p></div>
                  <div className="w-full sm:w-48"><Label htmlFor="new-product-code">Item Code</Label><Input id="new-product-code" value={newProductCode} onChange={event => setNewProductCode(event.target.value.toUpperCase())} placeholder={`${selectedProductTab.itemCodePrefix}-0000 (auto if blank)`} data-testid="input-new-product-code" /></div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {selectedProductTab.headers.map(field => {
                    const isDescription = field.index === 8;
                    const isImage = field.label.toLowerCase().includes("image") || field.label.toLowerCase().includes("imgae");
                    return <div key={field.index} className={isDescription ? "md:col-span-2" : ""}>
                      <Label htmlFor={`new-product-cell-${field.index}`}>{field.column} · {field.label}{isDescription ? " *" : ""}</Label>
                      {isDescription
                        ? <textarea id={`new-product-cell-${field.index}`} className="mt-1 min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={newProductCells[field.index] || ""} onChange={event => setNewProductCells(current => ({ ...current, [field.index]: event.target.value }))} data-testid={`input-new-product-cell-${field.index}`} />
                        : <Input id={`new-product-cell-${field.index}`} className="mt-1" value={newProductCells[field.index] || ""} onChange={event => setNewProductCells(current => ({ ...current, [field.index]: event.target.value }))} placeholder={isImage ? "Public HTTPS Drive or ImgVision link" : undefined} data-testid={`input-new-product-cell-${field.index}`} />}
                    </div>;
                  })}
                </div>
              </div>}
            </section>
            <section className="space-y-3">
              <div><p className="font-medium">Versions and prices</p><p className="text-sm text-muted-foreground">Tick only the snapshots that should receive this product, then enter that version’s price.</p></div>
              <div className="grid gap-2 md:grid-cols-2">
                {(newProductOptions.data?.versions || []).map(version => {
                  const checked = newProductPrices[version.id] !== undefined;
                  return <div key={version.id} className={`rounded border p-3 ${checked ? "border-primary bg-primary/5" : ""}`} data-testid={`new-product-version-${version.versionNumber}`}>
                    <div className="flex items-start gap-3">
                      <Checkbox checked={checked} onCheckedChange={value => setNewProductPrices(current => {
                        const next = { ...current };
                        if (value === true) next[version.id] = "";
                        else delete next[version.id];
                        return next;
                      })} data-testid={`checkbox-new-product-version-${version.versionNumber}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">Version {version.versionNumber} · {version.name}</span><Badge variant={version.status === "active" ? "default" : "secondary"}>{version.status}</Badge></div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{version.itemCount.toLocaleString()} stored items</p>
                        {checked && <div className="mt-3"><Label htmlFor={`new-product-price-${version.id}`}>{selectedProductTab?.priceColumn.label || "Price"} *</Label><Input id={`new-product-price-${version.id}`} type="number" min="0" step="0.01" value={newProductPrices[version.id]} onChange={event => setNewProductPrices(current => ({ ...current, [version.id]: event.target.value }))} placeholder="0.00" data-testid={`input-new-product-price-${version.versionNumber}`} /></div>}
                      </div>
                    </div>
                  </div>;
                })}
              </div>
              {selectedDraft && <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">Because Draft is selected, this product will also be appended as one new row to <strong>{selectedProductTab?.tabTitle}</strong>. The disabled legacy Services tab is never available to this feature.</div>}
            </section>
          </div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setNewProductOpen(false)} disabled={addProduct.isPending}>Cancel</Button>
          <Button
            onClick={() => addProduct.mutate()}
            disabled={addProduct.isPending || !selectedProductTab || !newProductCells[8]?.trim() || selectedProductDestinations.length === 0 || selectedProductDestinations.some(destination => !Number.isFinite(destination.price))}
            data-testid="button-save-new-product"
          >
            {addProduct.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add to {selectedProductDestinations.length || 0} version{selectedProductDestinations.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={syncOpen} onOpenChange={open => { setSyncOpen(open); if (!open) setSelectedGids(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-primary" />Sync the Google Sheet into the Draft</DialogTitle>
          <DialogDescription>Choose which tabs to pull in. Tabs you leave unticked are not read at all and keep whatever is already in the Draft. This never changes live prices.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sheet tabs</span>
            <button className="text-xs text-primary hover:underline" onClick={() => setSelectedGids(gidsToSync.length === enabledTabs.length ? [] : enabledTabs.map(t => t.sheetTabId))} data-testid="button-toggle-all-tabs">
              {gidsToSync.length === enabledTabs.length ? "Clear all" : "Select all"}
            </button>
          </div>
          {sheetTabs.isLoading ? <Skeleton className="h-32 w-full" /> : enabledTabs.map(t => <label key={t.sheetTabId} className="flex cursor-pointer items-center gap-3 rounded border p-3 hover-elevate" data-testid={`checkbox-tab-${t.sheetTabId}`}>
            <Checkbox checked={gidsToSync.includes(t.sheetTabId)} onCheckedChange={() => toggleGid(t.sheetTabId)} />
            <span className="min-w-0"><span className="block text-sm font-medium">{t.categoryName}</span><span className="block truncate text-xs text-muted-foreground">{t.tabTitle}</span></span>
          </label>)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSyncOpen(false)} data-testid="button-cancel-sync">Cancel</Button>
          <Button onClick={() => refresh.mutate(gidsToSync)} disabled={refresh.isPending || gidsToSync.length === 0} data-testid="button-confirm-sync">
            {refresh.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {gidsToSync.length === enabledTabs.length ? "Sync all tabs" : `Sync ${gidsToSync.length} tab${gidsToSync.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={publishOpen} onOpenChange={open => { setPublishOpen(open); if (!open) setPublishAck(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary" />Publish this Draft?</AlertDialogTitle>
          <AlertDialogDescription>Version {live ? live.versionNumber + 1 : 1} will become Live for new quotations. Existing projects and quotations will not change.</AlertDialogDescription>
        </AlertDialogHeader>
        {/* The Draft accumulates between publishes, so state plainly what is about to go
            live and who put it there — including syncs this admin may not have run. */}
        <div className="rounded border bg-muted/40 p-3 text-sm" data-testid="publish-summary">
          <p><strong>{totalChanges}</strong> catalog change{totalChanges === 1 ? "" : "s"} will take effect: {priceChanges.length} price change{priceChanges.length === 1 ? "" : "s"}, {imageChangeCount} image change{imageChangeCount === 1 ? "" : "s"}, {diff?.added.length ?? 0} added, {diff?.removed.length ?? 0} removed.</p>
          {draftStatus.data?.lastSync && <p className="mt-1 text-muted-foreground">Draft last synced {dateTime(draftStatus.data.lastSync.completedAt || draftStatus.data.lastSync.startedAt)} by {draftStatus.data.lastSync.syncedBy || "an admin"}.</p>}
          {draftStatus.data?.lastSync && draftStatus.data.lastSync.errorCount > 0 && <p className="mt-1 text-amber-800">That sync reported {draftStatus.data.lastSync.errorCount} error{draftStatus.data.lastSync.errorCount === 1 ? "" : "s"}.</p>}
          <p className="mt-1 text-muted-foreground">Once published, these prices are frozen and cannot be edited.</p>
        </div>
        <div className="space-y-4 py-2">
          <div><Label htmlFor="publish-name">Version name (optional)</Label><Input id="publish-name" value={publishName} onChange={e => setPublishName(e.target.value)} placeholder="e.g. April 2025 catalog" data-testid="input-publish-name" /></div>
          <div><Label htmlFor="publish-notes">Review notes (optional)</Label><Input id="publish-notes" value={publishNotes} onChange={e => setPublishNotes(e.target.value)} placeholder="What was reviewed?" data-testid="input-publish-notes" /></div>
          <label className="flex cursor-pointer items-start gap-3 text-sm"><Checkbox checked={publishAck} onCheckedChange={v => setPublishAck(v === true)} data-testid="checkbox-publish-ack" /><span>I have reviewed the {totalChanges} change{totalChanges === 1 ? "" : "s"} above and want them to go live.</span></label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-publish">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => publish.mutate()} disabled={publish.isPending || !publishAck} data-testid="button-confirm-publish">{publish.isPending ? "Publishing…" : "Publish reviewed Draft"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={updateOpen} onOpenChange={open => { setUpdateOpen(open); if (!open) setUpdateAck(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />Update the live price list?</AlertDialogTitle>
          <AlertDialogDescription>
            {live ? `These changes are applied to Version ${live.versionNumber}${live.name ? ` · ${live.name}` : ""} itself. No new version is created and the number does not change.` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded border bg-muted/40 p-3 text-sm" data-testid="update-live-summary">
          <p><strong>{totalChanges}</strong> catalog change{totalChanges === 1 ? "" : "s"}: {priceChanges.length} price change{priceChanges.length === 1 ? "" : "s"}, {imageChangeCount} image change{imageChangeCount === 1 ? "" : "s"}, {diff?.added.length ?? 0} added, {diff?.removed.length ?? 0} removed.</p>
          <p className="mt-1 text-emerald-800">All {live?.projectCount ?? 0} projects on this price list can use the new items straight away — no need to recreate a quotation.</p>
          <p className="mt-1 text-muted-foreground">Prices already saved on existing quotations do not move. Only lines added from now on use the new prices.</p>
          {(diff?.removed.length ?? 0) > 0 && <p className="mt-1 text-amber-800">{diff?.removed.length} item{(diff?.removed.length ?? 0) === 1 ? "" : "s"} will no longer be available to anyone on this price list.</p>}
        </div>
        <div className="space-y-4 py-2">
          <div><Label htmlFor="update-notes">Reason (optional)</Label><Input id="update-notes" value={updateNotes} onChange={e => setUpdateNotes(e.target.value)} placeholder="e.g. added new washbasin item" data-testid="input-update-notes" /></div>
          <label className="flex cursor-pointer items-start gap-3 text-sm"><Checkbox checked={updateAck} onCheckedChange={v => setUpdateAck(v === true)} data-testid="checkbox-update-ack" /><span>I have reviewed the {totalChanges} change{totalChanges === 1 ? "" : "s"} above and want them applied to the live price list.</span></label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-update-live">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => updateLive.mutate()} disabled={updateLive.isPending || !updateAck} data-testid="button-confirm-update-live">{updateLive.isPending ? "Updating…" : "Update live price list"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={!!revertTarget} onOpenChange={open => !open && setRevertTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />Make this version live again?</AlertDialogTitle>
          <AlertDialogDescription>{`Version ${revertTarget?.versionNumber} becomes live straight away and the version that is live now will be archived. From this moment, new quotations are priced from Version ${revertTarget?.versionNumber}. Quotations you have already created keep the version they were built on, so nothing you have sent to a client changes. Your Draft is left untouched.`}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-destructive">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => revertTarget && revert.mutate(revertTarget.id)} disabled={revert.isPending || !revertTarget} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-destructive">{revert.isPending ? "Applying…" : "Make it live"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
