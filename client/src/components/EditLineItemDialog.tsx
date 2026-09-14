import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import type { LineItem, RoomSubcategory } from "@/lib/types";

// Sentinel value for the "no sub-category" option, since Radix Select doesn't allow
// an item with an empty string value.
const NO_SUBCATEGORY = "__none__";

export interface EditLineItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: EditLineItemFormData) => void;
  item: LineItem | null;
  isSubmitting?: boolean;
  // Sub-categories available in this item's room, so the item can be moved into/out
  // of one. Omit or pass an empty list when the room has none.
  subcategories?: RoomSubcategory[];
}

export interface EditLineItemFormData {
  id: string;
  lengthFt: number;
  heightFt: number;
  quantity: number;
  subcategoryId?: string | null;
  isComplimentary?: boolean;
  complimentaryOfferName?: string | null;
}

export default function EditLineItemDialog({ 
  open, 
  onOpenChange, 
  onSubmit,
  item,
  isSubmitting = false,
  subcategories = [],
}: EditLineItemDialogProps) {
  const [formData, setFormData] = useState<EditLineItemFormData>({
    id: "",
    lengthFt: 0,
    heightFt: 0,
    quantity: 1,
    subcategoryId: null,
    isComplimentary: false,
    complimentaryOfferName: "",
  });

  useEffect(() => {
    if (item && open) {
      setFormData({
        id: item.id,
        lengthFt: item.lengthFt,
        heightFt: item.heightFt,
        quantity: item.quantity,
        subcategoryId: item.subcategoryId ?? null,
        isComplimentary: item.isComplimentary || false,
        complimentaryOfferName: item.complimentaryOfferName || "",
      });
    }
  }, [item, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  // Check if item is woodwork (requires dimensions) or non-woodwork (quantity only)
  const isWoodwork = item?.itemType === "woodworks";
  
  const sqft = formData.lengthFt * formData.heightFt;
  const lengthMm = Math.round(formData.lengthFt * 304.8);
  const heightMm = Math.round(formData.heightFt * 304.8);
  const rate = item?.rate || 0;
  
  // For woodwork: rate × sqft × quantity, for non-woodwork: rate × quantity
  const estimatedAmount = isWoodwork 
    ? rate * sqft * formData.quantity
    : rate * formData.quantity;

  // For woodwork: need dimensions > 0, for non-woodwork: only quantity > 0
  const dimensionsValid = isWoodwork 
    ? formData.lengthFt > 0 && formData.heightFt > 0 && formData.quantity > 0
    : formData.quantity > 0;
  const complimentaryValid = !formData.isComplimentary || !!formData.complimentaryOfferName?.trim();
  const isValid = dimensionsValid && complimentaryValid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-edit-line-item">
        <DialogHeader>
          <DialogTitle>Edit Line Item</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {item?.description}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {subcategories.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="subcategory">Sub-category</Label>
              <Select
                value={formData.subcategoryId ?? NO_SUBCATEGORY}
                onValueChange={(value) =>
                  setFormData({ ...formData, subcategoryId: value === NO_SUBCATEGORY ? null : value })
                }
              >
                <SelectTrigger id="subcategory" data-testid="select-subcategory">
                  <SelectValue placeholder="Directly in room" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUBCATEGORY}>Directly in room</SelectItem>
                  {subcategories.map((sc) => (
                    <SelectItem key={sc.id} value={sc.id}>
                      {sc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isWoodwork && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lengthFt">Length (ft)</Label>
                <Input
                  id="lengthFt"
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={formData.lengthFt || ""}
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value);
                    setFormData({ ...formData, lengthFt: isNaN(raw) ? 0 : raw });
                  }}
                  onBlur={() => {
                    if (formData.lengthFt > 0) {
                      setFormData({ ...formData, lengthFt: Math.round(formData.lengthFt * 4) / 4 });
                    }
                  }}
                  data-testid="input-edit-length"
                />
                <p className="text-xs text-muted-foreground">{lengthMm.toFixed(0)} mm</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="heightFt">Height (ft)</Label>
                <Input
                  id="heightFt"
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={formData.heightFt || ""}
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value);
                    setFormData({ ...formData, heightFt: isNaN(raw) ? 0 : raw });
                  }}
                  onBlur={() => {
                    if (formData.heightFt > 0) {
                      setFormData({ ...formData, heightFt: Math.round(formData.heightFt * 4) / 4 });
                    }
                  }}
                  data-testid="input-edit-height"
                />
                <p className="text-xs text-muted-foreground">{heightMm.toFixed(0)} mm</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              type="number"
              min="0.5"
              step="0.5"
              value={formData.quantity || ""}
              onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 1 })}
              data-testid="input-edit-quantity"
            />
          </div>

          <div className="p-4 bg-muted rounded-lg">
            <div className="flex justify-between font-semibold">
              <span>Estimated Amount:</span>
              <span className="font-mono" data-testid="text-edit-estimated-amount">
                ₹{Math.round(estimatedAmount).toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          <div className="space-y-3 border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="edit-complimentary-toggle" className="font-semibold">Complimentary Offer</Label>
                <p className="text-xs text-muted-foreground">
                  MRP shows as usual, but this item shows as a ₹0 offer and is excluded from the grand total.
                </p>
              </div>
              <Switch
                id="edit-complimentary-toggle"
                checked={formData.isComplimentary || false}
                onCheckedChange={(checked) => setFormData({ ...formData, isComplimentary: checked })}
                data-testid="switch-edit-complimentary"
              />
            </div>
            {formData.isComplimentary && (
              <div className="space-y-2">
                <Label htmlFor="edit-offer-name">Offer Name</Label>
                <Input
                  id="edit-offer-name"
                  placeholder="e.g. Mother's Day Offer"
                  value={formData.complimentaryOfferName || ""}
                  onChange={(e) => setFormData({ ...formData, complimentaryOfferName: e.target.value })}
                  data-testid="input-edit-offer-name"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              data-testid="button-edit-cancel"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!isValid || isSubmitting}
              data-testid="button-edit-save"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
