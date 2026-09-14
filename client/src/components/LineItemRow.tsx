import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

export interface LineItem {
  id: string;
  description: string;
  lengthFt: number;
  heightFt: number;
  sqft: number;
  lengthMm: number;
  heightMm: number;
  rate: number;
  quantity: number;
  amount: number;
  itemType?: string;
  isComplimentary?: boolean;
  complimentaryOfferName?: string | null;
}

export interface LineItemRowProps {
  item: LineItem;
  onEdit?: () => void;
  onDelete?: () => void;
  showMmValues?: boolean;
  isFinalized?: boolean;
  showDimensions?: boolean;
  discount?: number;
  // Whether the "Amount After Discount" column is being rendered at all for this
  // table. The caller decides this (discount > 0 OR any row in the table is
  // complimentary) so every row in the table gets a consistent column count.
  showDiscountColumn?: boolean;
}

export default function LineItemRow({ 
  item, 
  onEdit, 
  onDelete,
  showMmValues = false,
  isFinalized = false,
  showDimensions = true,
  discount = 0,
  showDiscountColumn = false,
}: LineItemRowProps) {
  // Check if item has dimensions (non-zero length and height)
  const hasDimensions = item.lengthFt > 0 && item.heightFt > 0;
  
  return (
    <TableRow 
      className="hover-elevate group" 
      data-testid={`row-line-item-${item.id}`}
    >
      <TableCell className="font-medium" data-testid="text-description">
        {item.description}
      </TableCell>
      {showDimensions && (
        <>
          <TableCell className="text-right font-mono" data-testid="text-length">
            {hasDimensions ? item.lengthFt : "N/A"}
          </TableCell>
          <TableCell className="text-right font-mono" data-testid="text-height">
            {hasDimensions ? item.heightFt : ""}
          </TableCell>
        </>
      )}
      {showMmValues && showDimensions && (
        <>
          <TableCell className="text-right font-mono text-sm text-muted-foreground" data-testid="text-length-mm">
            {hasDimensions ? item.lengthMm : ""}
          </TableCell>
          <TableCell className="text-right font-mono text-sm text-muted-foreground" data-testid="text-height-mm">
            {hasDimensions ? item.heightMm : ""}
          </TableCell>
        </>
      )}
      <TableCell className="text-right font-mono" data-testid="text-quantity">
        {item.quantity}
      </TableCell>
      <TableCell className="text-right font-mono font-semibold" data-testid="text-amount">
        ₹{Math.round(item.amount).toLocaleString('en-IN')}
      </TableCell>
      {showDiscountColumn && (
        <TableCell className="text-right font-mono" data-testid="text-amount-after-discount">
          {item.isComplimentary ? (
            <>
              <div className="text-xs text-muted-foreground font-sans">
                Complimentary{item.complimentaryOfferName ? ` (${item.complimentaryOfferName})` : ''}
              </div>
              <div className="font-semibold">₹0</div>
            </>
          ) : discount > 0 ? (
            (item.itemType || 'woodworks') === 'woodworks'
              ? `₹${Math.round(item.amount * (1 - discount / 100)).toLocaleString('en-IN')}`
              : 'Not Applicable'
          ) : (
            'Not Applicable'
          )}
        </TableCell>
      )}
      {!isFinalized && (
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="ghost"
              onClick={onEdit}
              data-testid="button-edit"
              className="h-8 w-8"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onDelete}
              data-testid="button-delete"
              className="h-8 w-8"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}
