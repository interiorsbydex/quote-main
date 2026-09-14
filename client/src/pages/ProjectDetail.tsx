import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link as WouterLink } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, ArrowLeft, FileDown, Share2, Copy, Check, Link, Loader2, CheckCircle, FileEdit, AlertTriangle, Pencil, Wallet, CreditCard } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import MaterialSpecBlock from "@/components/MaterialSpecBlock";
import PricingVersionBadge from "@/components/PricingVersionBadge";
import ProjectCatalogExtras from "@/components/ProjectCatalogExtras";
import RoomCard from "@/components/RoomCard";
import QuotationSummary from "@/components/QuotationSummary";
import AddRoomDialog from "@/components/AddRoomDialog";
import type { RoomFormData } from "@/components/AddRoomDialog";
import AddLineItemWizard from "@/components/AddLineItemWizard";
import type { LineItemFormData } from "@/components/AddLineItemWizard";
import PrintableQuotation from "@/components/PrintableQuotation";
import ThemeToggle from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, Room, LineItem, MaterialSpec, ProjectCredits } from "@/lib/types";

export default function ProjectDetail() {
  const [, params] = useRoute("/project/:id");
  const projectId = params?.id || "";
  const [addRoomDialogOpen, setAddRoomDialogOpen] = useState(false);
  const [addLineItemDialogOpen, setAddLineItemDialogOpen] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDetailedPricing, setShowDetailedPricing] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [deleteRoomDialogOpen, setDeleteRoomDialogOpen] = useState(false);
  const [roomToDelete, setRoomToDelete] = useState<{ id: string; name: string } | null>(null);
  const [editRoomDialogOpen, setEditRoomDialogOpen] = useState(false);
  const [roomToEdit, setRoomToEdit] = useState<{ id: string; name: string } | null>(null);
  const [editRoomName, setEditRoomName] = useState("");
  const [editProjectDialogOpen, setEditProjectDialogOpen] = useState(false);
  const [editClientName, setEditClientName] = useState("");
  const [editPid, setEditPid] = useState("");
  const printRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const handleDownloadPdf = async () => {
    if (!projectId) return;
    
    setIsGeneratingPdf(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showDetailedPricing }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.headers.get('Content-Disposition')?.split('filename="')[1]?.replace('"', '') || 'quotation.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "PDF Downloaded",
        description: "Your quotation PDF has been generated and downloaded.",
      });
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({
        title: "Error",
        description: "Failed to generate PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const { data: project } = useQuery<Project>({
    queryKey: ['/api/projects', projectId],
    enabled: !!projectId,
  });

  const { data: rooms = [] } = useQuery<Room[]>({
    queryKey: ['/api/projects', projectId, 'rooms'],
    enabled: !!projectId,
  });

  const { data: lineItems = [] } = useQuery<LineItem[]>({
    queryKey: ['/api/projects', projectId, 'line-items'],
    enabled: !!projectId,
  });

  // The client no longer wants the Material Specification panel shown for XPRESS or XPAND
  // projects. There is nothing to fetch or render for them, so skip the request entirely
  // rather than fetch data the page will not display.
  const hideMaterialSpec = project?.defaultCategory === "DeX - Xpress" || project?.defaultCategory === "DeX - Xpand";

  const { data: materialSpecs, isLoading: specsLoading } = useQuery<MaterialSpec>({
    queryKey: [`/api/catalog/material-specs/${project?.defaultCategory || ''}`],
    enabled: !!project?.defaultCategory && !hideMaterialSpec,
  });

  const { data: credits } = useQuery<ProjectCredits>({
    queryKey: ['/api/projects', projectId, 'credits'],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/credits`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch credits');
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: companySettings } = useQuery<{
    companyName?: string;
    logoUrl?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
    email?: string;
    website?: string;
    gstNumber?: string;
    termsAndConditions?: string;
  }>({
    queryKey: ['/api/company-settings'],
  });

  const createRoomMutation = useMutation({
    mutationFn: async (data: RoomFormData) => {
      const res = await apiRequest('POST', `/api/projects/${projectId}/rooms`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'rooms'] });
      toast({
        title: "Success",
        description: "Room added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add room",
        variant: "destructive",
      });
    },
  });

  const deleteRoomMutation = useMutation({
    mutationFn: async (roomId: string) => {
      const res = await apiRequest('DELETE', `/api/rooms/${roomId}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'rooms'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'line-items'] });
      setDeleteRoomDialogOpen(false);
      setRoomToDelete(null);
      toast({
        title: "Success",
        description: "Room deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete room",
        variant: "destructive",
      });
    },
  });

  const duplicateRoomMutation = useMutation({
    mutationFn: async (roomId: string) => {
      const res = await apiRequest('POST', `/api/rooms/${roomId}/duplicate`, undefined);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'rooms'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'line-items'] });
      toast({
        title: "Success",
        description: "Room duplicated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to duplicate room",
        variant: "destructive",
      });
    },
  });

  const updateRoomMutation = useMutation({
    mutationFn: async ({ roomId, roomName }: { roomId: string; roomName: string }) => {
      const res = await apiRequest('PATCH', `/api/rooms/${roomId}`, { roomName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'rooms'] });
      setEditRoomDialogOpen(false);
      setRoomToEdit(null);
      setEditRoomName("");
      toast({
        title: "Success",
        description: "Room name updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update room",
        variant: "destructive",
      });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: async ({ clientName, pid }: { clientName: string; pid: string }) => {
      const res = await apiRequest('PATCH', `/api/projects/${projectId}`, { clientName, pid });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId] });
      setEditProjectDialogOpen(false);
      setEditClientName("");
      setEditPid("");
      toast({
        title: "Success",
        description: "Project details updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update project",
        variant: "destructive",
      });
    },
  });

  const createLineItemMutation = useMutation({
    mutationFn: async ({ roomId, data }: { roomId: string; data: LineItemFormData }) => {
      // Use rate from wizard (which correctly filtered by category) instead of re-looking up
      // This fixes the bug where Xpand items could get Xpress pricing
      if (!data.rate && data.rate !== 0) {
        throw new Error("Rate not provided. Please try again.");
      }

      const res = await apiRequest('POST', `/api/rooms/${roomId}/line-items`, {
        description: data.description,
        unitType: data.unitType,
        lengthFt: data.lengthFt,
        heightFt: data.heightFt,
        quantity: data.quantity,
        rate: data.rate,
        catalogItemId: data.catalogItemId, // Pass for server-side verification
        itemType: data.itemType, // Pass itemType for GST calculation
      });
      return res.json();
    },
    onSuccess: () => {
      // Invalidate and refetch line-items and rooms to update UI immediately
      // Using invalidateQueries with refetchType: 'all' ensures immediate refetch even with staleTime: Infinity
      queryClient.invalidateQueries({ 
        queryKey: ['/api/projects', projectId, 'line-items'],
        refetchType: 'all'
      });
      queryClient.invalidateQueries({ 
        queryKey: ['/api/projects', projectId, 'rooms'],
        refetchType: 'all'
      });
      toast({
        title: "Success",
        description: "Line item added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add line item",
        variant: "destructive",
      });
    },
  });

  const updateMarkupMutation = useMutation({
    mutationFn: async (markup: number) => {
      const res = await apiRequest('PATCH', `/api/projects/${projectId}`, { markup });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId] });
    },
  });

  const updateDiscountMutation = useMutation({
    mutationFn: async (discount: number) => {
      const res = await apiRequest('PATCH', `/api/projects/${projectId}`, { discount });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId] });
    },
  });

  const generateShareLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/projects/${projectId}/share`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId] });
      toast({
        title: "Share link created",
        description: "Your quote is now shareable with clients",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create share link",
        variant: "destructive",
      });
    },
  });

  const toggleShareMutation = useMutation({
    mutationFn: async (shareEnabled: boolean) => {
      const res = await apiRequest('PATCH', `/api/projects/${projectId}/share`, { shareEnabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to toggle sharing",
        variant: "destructive",
      });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/projects/${projectId}/finalize`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId] });
      toast({
        title: "Quote Finalized",
        description: "This quotation has been marked as finalized",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to finalize quote",
        variant: "destructive",
      });
    },
  });

  const getShareUrl = () => {
    if (!project?.shareToken) return '';
    return `${window.location.origin}/quote/${project.shareToken}`;
  };

  const copyShareLink = async () => {
    const url = getShareUrl();
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Link copied",
      description: "Share link copied to clipboard",
    });
  };

  const handleAddRoom = (data: RoomFormData) => {
    createRoomMutation.mutate(data);
  };

  const handleAddLineItem = (roomId: string) => {
    setSelectedRoomId(roomId);
    setAddLineItemDialogOpen(true);
  };

  const handleLineItemSubmit = async (data: LineItemFormData) => {
    if (!selectedRoomId || !project) {
      toast({
        title: "Error",
        description: "Please select a room before adding a line item.",
        variant: "destructive",
      });
      return;
    }
    // Use mutateAsync to properly await the mutation
    try {
      await createLineItemMutation.mutateAsync({ roomId: selectedRoomId, data });
      // Close dialog only after mutation succeeds
      setAddLineItemDialogOpen(false);
    } catch (error) {
      // Error is handled by onError callback
      console.error('[handleLineItemSubmit] Mutation failed:', error);
    }
  };

  // Calculate room totals
  const roomsWithTotals = rooms.map(room => {
    const roomLineItems = lineItems.filter(item => item.roomId === room.id);
    const total = roomLineItems.reduce((sum, item) => sum + item.amount, 0);
    return {
      ...room,
      itemCount: roomLineItems.length,
      totalAmount: total,
    };
  });

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  
  // Check if project is finalized (read-only mode)
  const isFinalized = project?.status === "Generated";

  if (!project) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => window.location.href = '/'} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold" data-testid="text-client-name">{project.clientName}</h1>
                {project.pid && (
                  <span className="text-sm text-muted-foreground font-mono" data-testid="text-project-pid">
                    ({project.pid})
                  </span>
                )}
                {!isFinalized && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditClientName(project.clientName);
                      setEditPid(project.pid || "");
                      setEditProjectDialogOpen(true);
                    }}
                    data-testid="button-edit-project"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
                <Badge 
                  variant={project.status === "Generated" ? "default" : "secondary"}
                  className="gap-1"
                  data-testid="badge-project-status"
                >
                  {project.status === "Generated" ? (
                    <>
                      <CheckCircle className="h-3 w-3" />
                      Finalized
                    </>
                  ) : (
                    <>
                      <FileEdit className="h-3 w-3" />
                      Draft
                    </>
                  )}
                </Badge>
                <PricingVersionBadge projectId={project.id} />
                <ProjectCatalogExtras projectId={project.id} />
              </div>
              <p className="text-sm text-muted-foreground">{project.projectType}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {project.status !== "Generated" && (
              <Button 
                variant="outline" 
                onClick={() => finalizeMutation.mutate()}
                disabled={lineItems.length === 0 || finalizeMutation.isPending}
                data-testid="button-finalize"
              >
                {finalizeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" />
                    <span className="hidden sm:inline">Finalizing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Finalize</span>
                  </>
                )}
              </Button>
            )}
            <Button 
              variant="outline" 
              onClick={() => setShareDialogOpen(true)}
              disabled={lineItems.length === 0}
              data-testid="button-share"
            >
              <Share2 className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Share</span>
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setPrintDialogOpen(true)}
              disabled={lineItems.length === 0}
              data-testid="button-export-pdf"
            >
              <FileDown className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export PDF</span>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 md:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Material Spec */}
            {!hideMaterialSpec && materialSpecs && (
              <MaterialSpecBlock
                category={project.defaultCategory}
                specs={materialSpecs}
              />
            )}

            {/* Rooms Section */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold">Spaces</h2>
                {!isFinalized && (
                  <Button onClick={() => setAddRoomDialogOpen(true)} data-testid="button-add-space">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Space
                  </Button>
                )}
              </div>

              {roomsWithTotals.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-lg">
                  <p className="text-muted-foreground mb-4">
                    {isFinalized ? "No spaces in this quote" : "No rooms yet. Add your first space to begin"}
                  </p>
                  {!isFinalized && (
                    <Button onClick={() => setAddRoomDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Space
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {roomsWithTotals.map((room) => (
                    <RoomCard
                      key={room.id}
                      id={room.id}
                      roomName={room.roomName}
                      roomType={room.roomType}
                      unitGroupName={room.unitGroupName || undefined}
                      itemCount={room.itemCount}
                      totalAmount={room.totalAmount}
                      onClick={() => window.location.href = `/room/${room.id}`}
                      onAddLineItem={() => handleAddLineItem(room.id)}
                      onEdit={() => {
                        setRoomToEdit({ id: room.id, name: room.roomName });
                        setEditRoomName(room.roomName);
                        setEditRoomDialogOpen(true);
                      }}
                      onDelete={() => {
                        setRoomToDelete({ id: room.id, name: room.roomName });
                        setDeleteRoomDialogOpen(true);
                      }}
                      onDuplicate={() => duplicateRoomMutation.mutate(room.id)}
                      isFinalized={isFinalized}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Summary */}
          <div className="lg:col-span-1">
            {credits && (
              <Card className="mb-4" data-testid="card-credits-summary">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">Design Credits</span>
                    </div>
                    <WouterLink href={`/admin/credits/${projectId}`}>
                      <Button variant="ghost" size="sm" data-testid="button-manage-credits">
                        <CreditCard className="h-3 w-3 mr-1" /> Manage
                      </Button>
                    </WouterLink>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="text-sm font-semibold" data-testid="text-total-credits">
                        {Math.round(credits.totalCredits).toLocaleString()} Credits
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Used</p>
                      <p className="text-sm font-semibold text-orange-600" data-testid="text-used-credits">
                        {Math.round(credits.usedCredits).toLocaleString()} Credits
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Available</p>
                      <p className="text-sm font-semibold text-green-600" data-testid="text-available-credits">
                        {Math.round(credits.availableCredits).toLocaleString()} Credits
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            <QuotationSummary
              lineItems={lineItems}
              initialMarkup={project.markup || 0}
              initialDiscount={project.discount || 0}
              onMarkupChange={(markup) => updateMarkupMutation.mutate(markup)}
              onDiscountChange={(discount) => updateDiscountMutation.mutate(discount)}
              isFinalized={isFinalized}
            />
          </div>
        </div>
      </main>

      <AddRoomDialog
        open={addRoomDialogOpen}
        onOpenChange={setAddRoomDialogOpen}
        onSubmit={handleAddRoom}
        multiStyleEnabled={project.multiStyleEnabled}
        projectDefaultCategory={project.defaultCategory}
      />

      <AddLineItemWizard
        open={addLineItemDialogOpen}
        onOpenChange={setAddLineItemDialogOpen}
        onSubmit={handleLineItemSubmit}
        projectId={project.id}
        roomType={selectedRoomId ? rooms.find(r => r.id === selectedRoomId)?.roomType : undefined}
        category={selectedRoomId 
          ? (rooms.find(r => r.id === selectedRoomId)?.category || project.defaultCategory) 
          : project.defaultCategory}
        isSubmitting={createLineItemMutation.isPending}
      />

      <AlertDialog open={deleteRoomDialogOpen} onOpenChange={setDeleteRoomDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Room
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{roomToDelete?.name}"? This will also delete all line items in this room. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-room">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => roomToDelete && deleteRoomMutation.mutate(roomToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-room"
            >
              {deleteRoomMutation.isPending ? "Deleting..." : "Delete Room"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editRoomDialogOpen} onOpenChange={setEditRoomDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Room Name</DialogTitle>
            <DialogDescription>
              Update the name for this room.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="edit-room-name">Room Name</Label>
            <Input
              id="edit-room-name"
              value={editRoomName}
              onChange={(e) => setEditRoomName(e.target.value)}
              placeholder="Enter room name"
              className="mt-2"
              data-testid="input-edit-room-name"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditRoomDialogOpen(false);
                setRoomToEdit(null);
                setEditRoomName("");
              }}
              data-testid="button-cancel-edit-room"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (roomToEdit && editRoomName.trim()) {
                  updateRoomMutation.mutate({ roomId: roomToEdit.id, roomName: editRoomName.trim() });
                }
              }}
              disabled={!editRoomName.trim() || updateRoomMutation.isPending}
              data-testid="button-save-room-name"
            >
              {updateRoomMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editProjectDialogOpen} onOpenChange={setEditProjectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project Details</DialogTitle>
            <DialogDescription>
              Update the client name and project ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="edit-client-name">Client Name</Label>
              <Input
                id="edit-client-name"
                value={editClientName}
                onChange={(e) => setEditClientName(e.target.value)}
                placeholder="Enter client name"
                className="mt-2"
                data-testid="input-edit-client-name"
              />
            </div>
            <div>
              <Label htmlFor="edit-pid">Project ID (PID)</Label>
              <Input
                id="edit-pid"
                value={editPid}
                onChange={(e) => setEditPid(e.target.value)}
                placeholder="e.g., DeX-Xpress-107"
                className="mt-2"
                data-testid="input-edit-pid"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditProjectDialogOpen(false);
                setEditClientName("");
                setEditPid("");
              }}
              data-testid="button-cancel-edit-project"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editClientName.trim()) {
                  updateProjectMutation.mutate({ clientName: editClientName.trim(), pid: editPid.trim() });
                }
              }}
              disabled={!editClientName.trim() || updateProjectMutation.isPending}
              data-testid="button-save-project"
            >
              {updateProjectMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-4 flex-wrap">
              <span>Quotation Preview</span>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="detailed-pricing"
                    checked={showDetailedPricing}
                    onCheckedChange={setShowDetailedPricing}
                    data-testid="switch-detailed-pricing"
                  />
                  <Label htmlFor="detailed-pricing" className="text-sm font-normal">
                    Show detailed pricing
                  </Label>
                </div>
                <Button 
                  onClick={handleDownloadPdf} 
                  disabled={isGeneratingPdf}
                  data-testid="button-download-pdf"
                >
                  {isGeneratingPdf ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <FileDown className="h-4 w-4 mr-2" />
                      Download PDF
                    </>
                  )}
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          <PrintableQuotation
            ref={printRef}
            project={project}
            rooms={rooms}
            lineItems={lineItems}
            markup={project.markup || 0}
            discount={project.discount || 0}
            companySettings={companySettings}
            showDetailedPricing={showDetailedPricing}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Share Quotation
            </DialogTitle>
            <DialogDescription>
              Share this quote with your client. They'll see a read-only view of the quotation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!project.shareToken ? (
              <div className="text-center space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <Link className="h-12 w-12 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mt-2">
                    Create a shareable link for your client
                  </p>
                </div>
                <Button 
                  onClick={() => generateShareLinkMutation.mutate()}
                  disabled={generateShareLinkMutation.isPending}
                  data-testid="button-generate-link"
                >
                  Generate Share Link
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center space-x-2">
                  <Label htmlFor="share-toggle" className="flex-1">
                    Sharing enabled
                  </Label>
                  <Switch
                    id="share-toggle"
                    checked={project.shareEnabled || false}
                    onCheckedChange={(checked) => toggleShareMutation.mutate(checked)}
                    data-testid="switch-share-toggle"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Share Link</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={getShareUrl()} 
                      readOnly 
                      className="font-mono text-sm"
                      data-testid="input-share-url"
                    />
                    <Button 
                      size="icon" 
                      variant="outline"
                      onClick={copyShareLink}
                      disabled={!project.shareEnabled}
                      data-testid="button-copy-link"
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                
                {!project.shareEnabled && (
                  <p className="text-sm text-muted-foreground">
                    Enable sharing to let clients view this quote
                  </p>
                )}
                
                <div className="pt-2 border-t">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => generateShareLinkMutation.mutate()}
                    disabled={generateShareLinkMutation.isPending}
                    data-testid="button-regenerate-link"
                  >
                    Regenerate Link
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">
                    This will invalidate the previous link
                  </p>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
