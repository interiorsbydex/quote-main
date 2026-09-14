import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import type { LineItem, ItemType } from "@/lib/types";
import { computeQuotationTotals } from "@shared/calculations";

export interface QuotationSummaryProps {
  lineItems: LineItem[];
  initialMarkup?: number;
  initialDiscount?: number;
  onMarkupChange?: (markup: number) => void;
  onDiscountChange?: (discount: number) => void;
  isFinalized?: boolean;
}

export default function QuotationSummary({ lineItems, initialMarkup = 0, initialDiscount = 0, onMarkupChange, onDiscountChange, isFinalized = false }: QuotationSummaryProps) {
  const [markup, setMarkup] = useState(initialMarkup);
  const [discount, setDiscount] = useState(initialDiscount);

  useEffect(() => {
    setMarkup(initialMarkup);
  }, [initialMarkup]);

  useEffect(() => {
    setDiscount(initialDiscount);
  }, [initialDiscount]);

  const handleMarkupChange = (value: string) => {
    const numValue = parseFloat(value) || 0;
    setMarkup(numValue);
    onMarkupChange?.(numValue);
  };

  const handleDiscountChange = (value: string) => {
    const numValue = parseFloat(value) || 0;
    setDiscount(numValue);
    onDiscountChange?.(numValue);
  };

  const {
    woodworksSubtotal, woodworksDiscountValue, woodworksAfterDiscount,
    woodworksGst, woodworksTotal,
    enablementFeeValue, enablementFeeGst, enablementFeeTotal,
    servicesSubtotal, servicesGst, servicesTotal,
    accessoriesTotal,
    lineItemsSubtotal, totalProjectValue, totalGst, grandTotal,
    hasWoodworks, hasServices, hasAccessories, hasAnyItems,
  } = computeQuotationTotals(lineItems, markup, discount);

  return (
    <Card className="sticky top-4" data-testid="card-quotation-summary">
      <CardHeader>
        <CardTitle>Quotation Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enablement Fee & Discount Inputs - Always show when there are any items */}
        {hasAnyItems && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm text-muted-foreground">Pricing Adjustments</h4>
            <p className="text-xs text-muted-foreground">Enablement fee and discount apply to woodworks only</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="markup" className="text-xs">Enablement Fee (%)</Label>
                <Input
                  id="markup"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={markup || ''}
                  onChange={(e) => handleMarkupChange(e.target.value)}
                  placeholder="0"
                  className="text-right font-mono h-8"
                  data-testid="input-markup"
                  disabled={isFinalized}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="discount" className="text-xs">Discount (%)</Label>
                <Input
                  id="discount"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={discount || ''}
                  onChange={(e) => handleDiscountChange(e.target.value)}
                  placeholder="0"
                  className="text-right font-mono h-8"
                  data-testid="input-discount"
                  disabled={isFinalized}
                />
              </div>
            </div>
          </div>
        )}

        {hasAnyItems && <Separator />}

        {/* Woodworks Section */}
        {hasWoodworks && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm text-muted-foreground">Woodworks</h4>
            <div className="flex justify-between items-center text-sm gap-2">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono" data-testid="text-woodworks-subtotal">
                ₹{Math.round(woodworksSubtotal).toLocaleString('en-IN')}
              </span>
            </div>
            
            {discount > 0 && (
              <div className="flex justify-between items-center text-sm gap-2">
                <span className="text-muted-foreground">Discount ({discount}%)</span>
                <span className="font-mono text-green-600" data-testid="text-discount-value">
                  -₹{Math.round(woodworksDiscountValue).toLocaleString('en-IN')}
                </span>
              </div>
            )}
            
            <div className="flex justify-between items-center text-sm gap-2">
              <span className="text-muted-foreground">GST (18%)</span>
              <span className="font-mono" data-testid="text-woodworks-gst">
                ₹{Math.round(woodworksGst).toLocaleString('en-IN')}
              </span>
            </div>
            
            <div className="flex justify-between items-center font-medium gap-2">
              <span>Woodworks Total</span>
              <span className="font-mono" data-testid="text-woodworks-total">
                ₹{Math.round(woodworksTotal).toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        )}

        {hasWoodworks && (hasServices || hasAccessories) && <Separator />}

        {/* Services Section */}
        {hasServices && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm text-muted-foreground">Services</h4>
            <div className="flex justify-between items-center text-sm gap-2">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono" data-testid="text-services-subtotal">
                ₹{Math.round(servicesSubtotal).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm gap-2">
              <span className="text-muted-foreground">GST (18%)</span>
              <span className="font-mono" data-testid="text-services-gst">
                ₹{Math.round(servicesGst).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="flex justify-between items-center font-medium gap-2">
              <span>Services Total</span>
              <span className="font-mono" data-testid="text-services-total">
                ₹{Math.round(servicesTotal).toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        )}

        {hasServices && hasAccessories && <Separator />}

        {/* Accessories Section */}
        {hasAccessories && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm text-muted-foreground">Accessories</h4>
            <div className="flex justify-between items-center text-sm gap-2">
              <span className="text-muted-foreground">Total (GST Inclusive)</span>
              <span className="font-mono" data-testid="text-accessories-total">
                ₹{Math.round(accessoriesTotal).toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        )}

        {/* Enablement Fee Section - between Accessories and Grand Total */}
        {markup > 0 && hasWoodworks && (
          <>
            {(hasWoodworks || hasServices || hasAccessories) && <Separator />}
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-muted-foreground">Enablement Fee</h4>
              <div className="flex justify-between items-center text-sm gap-2">
                <span className="text-muted-foreground">Fee ({markup}% on Woodworks)</span>
                <span className="font-mono" data-testid="text-enablement-fee-value">
                  ₹{Math.round(enablementFeeValue).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm gap-2">
                <span className="text-muted-foreground">GST (18%)</span>
                <span className="font-mono" data-testid="text-enablement-fee-gst">
                  ₹{Math.round(enablementFeeGst).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between items-center font-medium gap-2">
                <span>Enablement Fee Total</span>
                <span className="font-mono" data-testid="text-enablement-fee-total">
                  ₹{Math.round(enablementFeeTotal).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </>
        )}

        {(hasWoodworks || hasServices || hasAccessories) && <Separator />}

        {/* Final Summary */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm gap-2">
            <span className="text-muted-foreground">Line Items Subtotal</span>
            <span className="font-mono" data-testid="text-line-items-subtotal">
              ₹{Math.round(woodworksAfterDiscount + servicesSubtotal + accessoriesTotal).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex justify-between items-center text-sm gap-2">
            <span className="text-muted-foreground">Total GST</span>
            <span className="font-mono" data-testid="text-total-gst">
              ₹{Math.round(totalGst).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex justify-between items-center pt-2 gap-2">
            <span className="font-semibold">Grand Total</span>
            <span className="font-mono text-2xl font-bold text-primary" data-testid="text-grand-total">
              ₹{Math.round(grandTotal).toLocaleString('en-IN')}
            </span>
          </div>
        </div>

        {/* Empty state */}
        {!hasWoodworks && !hasServices && !hasAccessories && (
          <div className="text-center text-muted-foreground py-4">
            No items added yet
          </div>
        )}
      </CardContent>
    </Card>
  );
}
