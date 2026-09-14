import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft } from "lucide-react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import LineItemRow from "@/components/LineItemRow";
import type { LineItem as LineItemType } from "@/lib/types";
import AddLineItemWizard from "@/components/AddLineItemWizard";
import type { LineItemFormData } from "@/components/AddLineItemWizard";
import EditLineItemDialog from "@/components/EditLineItemDialog";
import type { EditLineItemFormData } from "@/components/EditLineItemDialog";
import ThemeToggle from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Room, Project, DexCategory } from "@/lib/types";
import { sortLineItemsByCategory } from "@/lib/types";

export default function RoomDetail() {
  const [, params] = useRoute("/room/:id");
  const roomId = params?.id || "";
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [editItemDialogOpen, setEditItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LineItemType | null>(null);
  const { toast } = useToast();

  const { data: room } = useQuery<Room>({
    queryKey: ['/api/rooms', roomId],
    enabled: !!roomId,
  });

  const { data: project } = useQuery<Project>({
    queryKey: ['/api/projects', room?.projectId],
    enabled: !!room?.projectId,
  });

  const { data: lineItems = [] } = useQuery<LineItemType[]>({
    queryKey: ['/api/rooms', roomId, 'line-items'],
    enabled: !!roomId,
  });

  const createLineItemMutation = useMutation({
    mutationFn: async (data: LineItemFormData) => {
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
      // Invalidate and refetch to update UI immediately
      // Using invalidateQueries with refetchType: 'all' ensures immediate refetch
      queryClient.invalidateQueries({ 
        queryKey: ['/api/rooms', roomId, 'line-items'],
        refetchType: 'all'
      });
      if (room?.projectId) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/projects', room.projectId, 'line-items'],
          refetchType: 'all'
        });
        queryClient.invalidateQueries({ 
          queryKey: ['/api/projects', room.projectId, 'rooms'],
          refetchType: 'all'
        });
      }
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

  const deleteLineItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/line-items/${id}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rooms', roomId, 'line-items'] });
      if (room?.projectId) {
        queryClient.invalidateQueries({ queryKey: ['/api/projects', room.projectId, 'line-items'] });
      }
      toast({
        title: "Success",
        description: "Line item deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete line item",
        variant: "destructive",
      });
    },
  });

  const updateLineItemMutation = useMutation({
    mutationFn: async (data: EditLineItemFormData) => {
      const res = await apiRequest('PATCH', `/api/line-items/${data.id}`, {
        lengthFt: data.lengthFt,
        heightFt: data.heightFt,
        quantity: data.quantity,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ['/api/rooms', roomId, 'line-items'],
        refetchType: 'all'
      });
      if (room?.projectId) {
        queryClient.invalidateQueries({ 
          queryKey: ['/api/projects', room.projectId, 'line-items'],
          refetchType: 'all'
        });
        queryClient.invalidateQueries({ 
          queryKey: ['/api/projects', room.projectId, 'rooms'],
          refetchType: 'all'
        });
      }
      setEditItemDialogOpen(false);
      setEditingItem(null);
      toast({
        title: "Success",
        description: "Line item updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update line item",
        variant: "destructive",
      });
    },
  });

  const handleAddLineItem = async (data: LineItemFormData) => {
    // Use mutateAsync to properly await the mutation
    try {
      await createLineItemMutation.mutateAsync(data);
      // Close dialog only after mutation succeeds
      setAddItemDialogOpen(false);
    } catch (error) {
      // Error is handled by onError callback
      console.error('[handleAddLineItem] Mutation failed:', error);
    }
  };

  const total = lineItems.reduce((sum, item) => sum + item.amount, 0);
  
  // Check if project is finalized (read-only mode)
  const isFinalized = project?.status === "Generated";

  if (!room || !project) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => window.location.href = `/project/${room.projectId}`}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold" data-testid="text-room-name">{room.roomName}</h1>
              <p className="text-sm text-muted-foreground">{room.roomType} • {project.clientName}</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 md:px-6 py-8">
        <div className="flex items-center justify-between gap-2 mb-6">
          <h2 className="text-xl sm:text-2xl font-semibold">Line Items</h2>
          {!isFinalized && (
            <Button onClick={() => setAddItemDialogOpen(true)} size="sm" data-testid="button-add-line-item">
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Add Line Item</span>
              <span className="sm:hidden">Add</span>
            </Button>
          )}
        </div>

        {lineItems.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground mb-4">
              {isFinalized ? "No line items in this space" : "No line items yet. Add your first item to begin"}
            </p>
            {!isFinalized && (
              <Button onClick={() => setAddItemDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Line Item
              </Button>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[250px]">Description</TableHead>
                    <TableHead className="text-right w-[100px]">Length (ft)</TableHead>
                    <TableHead className="text-right w-[100px]">Height (ft)</TableHead>
                    <TableHead className="text-right w-[80px]">Qty</TableHead>
                    <TableHead className="text-right w-[130px]">Amount</TableHead>
                    {(project?.discount || 0) > 0 && <TableHead className="text-right w-[150px]">Amount After Discount</TableHead>}
                    {!isFinalized && <TableHead className="text-right w-[100px]">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortLineItemsByCategory(lineItems).map((item) => (
                    <LineItemRow
                      key={item.id}
                      item={item}
                      onEdit={() => {
                        setEditingItem(item);
                        setEditItemDialogOpen(true);
                      }}
                      onDelete={() => deleteLineItemMutation.mutate(item.id)}
                      isFinalized={isFinalized}
                      discount={project?.discount || 0}
                    />
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableHead colSpan={4} className="text-right">Total</TableHead>
                    <TableHead className="text-right font-mono" data-testid="text-room-total">
                      ₹{Math.round(total).toLocaleString('en-IN')}
                    </TableHead>
                    {(project?.discount || 0) > 0 && <TableHead></TableHead>}
                    {!isFinalized && <TableHead></TableHead>}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </main>

      <AddLineItemWizard
        open={addItemDialogOpen}
        onOpenChange={setAddItemDialogOpen}
        onSubmit={handleAddLineItem}
        projectId={project.id}
        roomType={room.roomType}
        category={room.category || project.defaultCategory}
        isSubmitting={createLineItemMutation.isPending}
      />

      <EditLineItemDialog
        open={editItemDialogOpen}
        onOpenChange={(open) => {
          setEditItemDialogOpen(open);
          if (!open) setEditingItem(null);
        }}
        onSubmit={(data) => updateLineItemMutation.mutate(data)}
        item={editingItem}
        isSubmitting={updateLineItemMutation.isPending}
      />
    </div>
  );
}
