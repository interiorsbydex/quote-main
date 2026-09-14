import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft, FolderPlus, Trash2 } from "lucide-react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import LineItemRow from "@/components/LineItemRow";
import type { LineItem as LineItemType } from "@/lib/types";
import AddLineItemWizard from "@/components/AddLineItemWizard";
import type { LineItemFormData } from "@/components/AddLineItemWizard";
import EditLineItemDialog from "@/components/EditLineItemDialog";
import type { EditLineItemFormData } from "@/components/EditLineItemDialog";
import AddSubcategoryDialog from "@/components/AddSubcategoryDialog";
import ThemeToggle from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Room, Project, RoomSubcategory } from "@/lib/types";
import { sortLineItemsByCategory } from "@/lib/types";
import { computeRoomSubtotalDisplay } from "@shared/calculations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// A single sub-total table of line items, used both for a named sub-category group
// and for the room's ungrouped items. Kept identical in markup to the original flat
// table so rooms with no sub-categories render exactly as before.
function LineItemsTable({
  items,
  discount,
  isFinalized,
  onEdit,
  onDelete,
}: {
  items: LineItemType[];
  discount: number;
  isFinalized: boolean;
  onEdit: (item: LineItemType) => void;
  onDelete: (id: string) => void;
}) {
  const subtotal = computeRoomSubtotalDisplay(items, discount);
  // A complimentary item's ₹0/offer label needs its own column even when no
  // project-level discount is set -- otherwise it has nowhere to show at all.
  const hasComplimentary = items.some((item) => item.isComplimentary);
  const showDiscountColumn = discount > 0 || hasComplimentary;
  return (
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
              {showDiscountColumn && <TableHead className="text-right w-[150px]">Amount After Discount</TableHead>}
              {!isFinalized && <TableHead className="text-right w-[100px]">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortLineItemsByCategory(items).map((item) => (
              <LineItemRow
                key={item.id}
                item={item}
                onEdit={() => onEdit(item)}
                onDelete={() => onDelete(item.id)}
                isFinalized={isFinalized}
                discount={discount}
                showDiscountColumn={showDiscountColumn}
              />
            ))}
            <TableRow className="bg-muted/50">
              <TableHead colSpan={5 + (showDiscountColumn ? 1 : 0) + (!isFinalized ? 1 : 0)}>
                <div className="flex justify-end gap-4 font-semibold">
                  <span>Subtotal (After Discount)</span>
                  <span className="font-mono">
                    ₹{Math.round(subtotal.afterDiscount).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-end gap-4 text-xs font-normal text-muted-foreground">
                  <span>Pre-Discount</span>
                  <span className="font-mono">
                    ₹{Math.round(subtotal.preDiscount).toLocaleString('en-IN')}
                  </span>
                </div>
              </TableHead>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function RoomDetail() {
  const [, params] = useRoute("/room/:id");
  const roomId = params?.id || "";
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [addItemTargetSubcategoryId, setAddItemTargetSubcategoryId] = useState<string | null>(null);
  const [editItemDialogOpen, setEditItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LineItemType | null>(null);
  const [addSubcategoryDialogOpen, setAddSubcategoryDialogOpen] = useState(false);
  const [deletingSubcategory, setDeletingSubcategory] = useState<RoomSubcategory | null>(null);
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

  const { data: subcategories = [] } = useQuery<RoomSubcategory[]>({
    queryKey: ['/api/rooms', roomId, 'subcategories'],
    enabled: !!roomId,
  });

  const invalidateRoomData = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/rooms', roomId, 'line-items'], refetchType: 'all' });
    queryClient.invalidateQueries({ queryKey: ['/api/rooms', roomId, 'subcategories'], refetchType: 'all' });
    if (room?.projectId) {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', room.projectId, 'line-items'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', room.projectId, 'rooms'], refetchType: 'all' });
    }
  };

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
        depthFt: data.depthFt,
        quantity: data.quantity,
        rate: data.rate,
        catalogItemId: data.catalogItemId, // Pass for server-side verification
        itemType: data.itemType, // Pass itemType for GST calculation
        subcategoryId: addItemTargetSubcategoryId,
        isComplimentary: data.isComplimentary,
        complimentaryOfferName: data.complimentaryOfferName,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateRoomData();
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
      invalidateRoomData();
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
        subcategoryId: data.subcategoryId,
        isComplimentary: data.isComplimentary,
        complimentaryOfferName: data.complimentaryOfferName,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateRoomData();
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

  const createSubcategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest('POST', `/api/rooms/${roomId}/subcategories`, { name });
      return res.json();
    },
    onSuccess: () => {
      invalidateRoomData();
      setAddSubcategoryDialogOpen(false);
      toast({
        title: "Success",
        description: "Sub-category added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add sub-category",
        variant: "destructive",
      });
    },
  });

  const deleteSubcategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/subcategories/${id}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      invalidateRoomData();
      setDeletingSubcategory(null);
      toast({
        title: "Success",
        description: "Sub-category removed. Its items now sit directly under the room.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete sub-category",
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

  
  // Check if project is finalized (read-only mode)
  const isFinalized = project?.status === "Generated";

  if (!room || !project) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  const discount = project?.discount || 0;
  const roomSubtotal = computeRoomSubtotalDisplay(lineItems, discount);
  const hasSubcategories = subcategories.length > 0;
  const ungroupedItems = lineItems.filter((item) => !item.subcategoryId);

  const openAddItemFor = (subcategoryId: string | null) => {
    setAddItemTargetSubcategoryId(subcategoryId);
    setAddItemDialogOpen(true);
  };

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
        <div className="flex items-center justify-between gap-2 mb-6 flex-wrap">
          <h2 className="text-xl sm:text-2xl font-semibold">Line Items</h2>
          {!isFinalized && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setAddSubcategoryDialogOpen(true)}
                size="sm"
                variant="outline"
                data-testid="button-add-subcategory"
              >
                <FolderPlus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Add Sub-category</span>
                <span className="sm:hidden">Group</span>
              </Button>
              <Button onClick={() => openAddItemFor(null)} size="sm" data-testid="button-add-line-item">
                <Plus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Add Line Item</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </div>
          )}
        </div>

        {lineItems.length === 0 && !hasSubcategories ? (
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground mb-4">
              {isFinalized ? "No line items in this space" : "No line items yet. Add your first item to begin"}
            </p>
            {!isFinalized && (
              <Button onClick={() => openAddItemFor(null)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Line Item
              </Button>
            )}
          </div>
        ) : hasSubcategories ? (
          <div className="space-y-8">
            {subcategories.map((subcategory) => {
              const items = lineItems.filter((item) => item.subcategoryId === subcategory.id);
              return (
                <div key={subcategory.id} data-testid={`section-subcategory-${subcategory.id}`}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-base font-semibold" data-testid={`text-subcategory-name-${subcategory.id}`}>
                      {subcategory.name}
                    </h3>
                    {!isFinalized && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openAddItemFor(subcategory.id)}
                          data-testid={`button-add-item-to-${subcategory.id}`}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add Item
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeletingSubcategory(subcategory)}
                          data-testid={`button-delete-subcategory-${subcategory.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground border-2 border-dashed rounded-lg py-6 text-center">
                      No items yet in this sub-category
                    </p>
                  ) : (
                    <LineItemsTable
                      items={items}
                      discount={discount}
                      isFinalized={isFinalized}
                      onEdit={(item) => { setEditingItem(item); setEditItemDialogOpen(true); }}
                      onDelete={(id) => deleteLineItemMutation.mutate(id)}
                    />
                  )}
                </div>
              );
            })}

            {ungroupedItems.length > 0 && (
              <div data-testid="section-ungrouped-items">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-base font-medium text-muted-foreground">Other Items</h3>
                  {!isFinalized && (
                    <Button size="sm" variant="ghost" onClick={() => openAddItemFor(null)} data-testid="button-add-item-ungrouped">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Item
                    </Button>
                  )}
                </div>
                <LineItemsTable
                  items={ungroupedItems}
                  discount={discount}
                  isFinalized={isFinalized}
                  onEdit={(item) => { setEditingItem(item); setEditItemDialogOpen(true); }}
                  onDelete={(id) => deleteLineItemMutation.mutate(id)}
                />
              </div>
            )}

            <div className="space-y-1 border-t pt-4">
              <div className="flex items-center justify-end gap-4">
                <span className="font-semibold">Room Sub Total (After Discount)</span>
                <span className="font-mono font-semibold text-lg" data-testid="text-room-total">
                  ₹{Math.round(roomSubtotal.afterDiscount).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex items-center justify-end gap-4 text-xs text-muted-foreground">
                <span>Pre-Discount</span>
                <span className="font-mono">
                  ₹{Math.round(roomSubtotal.preDiscount).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <LineItemsTable
            items={lineItems}
            discount={discount}
            isFinalized={isFinalized}
            onEdit={(item) => { setEditingItem(item); setEditItemDialogOpen(true); }}
            onDelete={(id) => deleteLineItemMutation.mutate(id)}
          />
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
        subcategories={subcategories}
      />

      <AddSubcategoryDialog
        open={addSubcategoryDialogOpen}
        onOpenChange={setAddSubcategoryDialogOpen}
        onSubmit={(name) => createSubcategoryMutation.mutate(name)}
        isSubmitting={createSubcategoryMutation.isPending}
      />

      <AlertDialog open={!!deletingSubcategory} onOpenChange={(open) => !open && setDeletingSubcategory(null)}>
        <AlertDialogContent data-testid="dialog-delete-subcategory">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{deletingSubcategory?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Its line items will not be deleted — they'll move back to directly under the room.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-subcategory">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingSubcategory && deleteSubcategoryMutation.mutate(deletingSubcategory.id)}
              data-testid="button-confirm-delete-subcategory"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
