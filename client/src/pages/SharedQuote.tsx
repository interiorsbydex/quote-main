import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { FileText, Clock, AlertCircle } from "lucide-react";
import { sortLineItemsByCategory } from "@/lib/types";
import { computeQuotationTotals, computeRoomSubtotalDisplay, type AppliedOfferForCalculation } from "@shared/calculations";

interface SharedLineItem {
  description: string;
  dimensions: string;
  lengthFt: number;
  heightFt: number;
  lengthMm: number;
  heightMm: number;
  sqft: number;
  quantity: number;
  rate: number;
  amount: number;
  itemType: string;
  imageUrl?: string | null;
  isComplimentary?: boolean;
  complimentaryOfferName?: string | null;
}

interface SharedSubcategory {
  name: string;
  lineItems: SharedLineItem[];
}

interface SharedRoom {
  roomName: string;
  roomType: string;
  // Full flat list, kept for backward compatibility; grand totals below are computed
  // from this so sub-categories never affect pricing.
  lineItems: SharedLineItem[];
  // Optional grouping layer. Empty when the room has no sub-categories.
  subcategories?: SharedSubcategory[];
  ungroupedLineItems?: SharedLineItem[];
}

interface SharedQuoteData {
  clientName: string;
  projectType: string;
  category: string;
  pid?: string | null;
  markup: number;
  discount: number;
  createdAt: string;
  offers?: AppliedOfferForCalculation[];
  rooms: SharedRoom[];
}

interface CompanySettings {
  appName?: string;
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
  dimensionDisplayUnit?: "feet" | "mm";
}

export default function SharedQuote() {
  const [, params] = useRoute("/quote/:shareToken");
  const shareToken = params?.shareToken || "";

  const { data: quote, isLoading, error } = useQuery<SharedQuoteData>({
    queryKey: ['/api/shared', shareToken],
    enabled: !!shareToken,
    retry: false,
  });

  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ['/api/company-settings'],
  });

  const formatCurrency = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading quotation...</p>
        </div>
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Quote Not Available</h2>
            <p className="text-muted-foreground">
              This quote link may have expired or been disabled. Please contact the person who shared this link with you.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Use the same shared total-calculation function as the internal quotation views
  // (RoomDetail/PrintableQuotation) instead of a second hand-rolled copy, so this
  // public page can never drift from the internal totals -- including which items
  // (e.g. Complimentary Offer items) are excluded.
  // `room.lineItems` is the full flat per-room list (kept for backward compatibility),
  // so flattening it across rooms gives every line item exactly once.
  const allLineItems = quote.rooms.flatMap((room) => room.lineItems);
  const {
    categoryTotals,
    woodworksSubtotal, woodworksDiscountValue, woodworksAfterDiscount,
    woodworksGst, woodworksTotal,
    enablementFeeTotal,
    servicesSubtotal, servicesGst, servicesTotal,
    accessoriesTotal, furnitureTotal,
    grandTotal, offerPercentageDiscount, cashDiscount, finalPayable,
  } = computeQuotationTotals(allLineItems, quote.markup || 0, quote.discount || 0, quote.offers);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {companySettings?.companyName && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex flex-col sm:flex-row items-start gap-4">
                {companySettings.logoUrl && (
                  <img 
                    src={companySettings.logoUrl} 
                    alt="Company Logo" 
                    className="h-12 sm:h-16 w-auto object-contain"
                    data-testid="img-company-logo"
                  />
                )}
                <div>
                  <CardTitle className="text-lg sm:text-xl" data-testid="text-company-name">
                    {companySettings.companyName}
                  </CardTitle>
                  {companySettings.address && (
                    <p className="text-sm text-muted-foreground">{companySettings.address}</p>
                  )}
                  {(companySettings.city || companySettings.state) && (
                    <p className="text-sm text-muted-foreground">
                      {[companySettings.city, companySettings.state, companySettings.pincode].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {companySettings.gstNumber && (
                    <p className="text-sm font-medium text-muted-foreground">GSTIN: {companySettings.gstNumber}</p>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>
        )}

        <Card className="mb-6">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <CardTitle className="text-xl sm:text-2xl flex items-center gap-2">
                  <FileText className="h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0" />
                  <span>Quotation for {quote.clientName}</span>
                </CardTitle>
                <p className="text-muted-foreground mt-1">{quote.projectType} Project</p>
              </div>
              <div className="text-left sm:text-right text-sm text-muted-foreground">
                {quote.pid && (
                  <div className="font-medium text-foreground mb-1" data-testid="text-quote-pid">
                    Quote #: {quote.pid}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {format(new Date(quote.createdAt), "dd MMM yyyy")}
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        {quote.rooms.map((room, roomIndex) => {
          const useMm = companySettings?.dimensionDisplayUnit === "mm";
          const roomSubcategories = room.subcategories?.filter((sc) => sc.lineItems.length > 0) || [];
          const ungroupedItems = room.subcategories && room.subcategories.length > 0
            ? (room.ungroupedLineItems || [])
            : room.lineItems; // Older cached responses / rooms with no sub-categories: everything is "ungrouped"
          const roomSubtotal = computeRoomSubtotalDisplay(room.lineItems, quote.discount || 0);

          const renderTable = (items: SharedLineItem[], subtotalLabel: string) => {
            const sortedItems = sortLineItemsByCategory(items);
            const subtotal = computeRoomSubtotalDisplay(items, quote.discount || 0);
            // A complimentary item's ₹0/offer label needs its own column even when no
            // project-level discount is set, so it isn't hidden.
            const hasComplimentary = sortedItems.some((item) => item.isComplimentary);
            const showDiscountCol = (quote.discount || 0) > 0 || hasComplimentary;
            return (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-border bg-muted/50">
                    <th className="text-left py-3 px-4">Description</th>
                    <th className="text-center py-3 px-2 whitespace-nowrap">
                      Dimensions ({useMm ? "mm" : "ft"})
                    </th>
                    <th className="text-center py-3 px-2">Qty</th>
                    <th className="text-right py-3 px-4">Amount</th>
                    {showDiscountCol && <th className="text-right py-3 px-4">Amount After Discount</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item, itemIndex) => {
                    const hasDimensions = item.lengthFt > 0 && item.heightFt > 0;
                    const dimensionDisplay = hasDimensions
                      ? useMm
                        ? `${item.lengthMm || Math.round(item.lengthFt * 304.8)} × ${item.heightMm || Math.round(item.heightFt * 304.8)} mm`
                        : `${item.lengthFt} × ${item.heightFt} ft`
                      : "N/A";
                    const isWoodwork = (item.itemType || "woodworks") === "woodworks";

                    return (
                      <tr 
                        key={itemIndex} 
                        className={`border-b border-border/50 ${itemIndex % 2 === 0 ? '' : 'bg-muted/20'}`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            {item.imageUrl && (
                              <img
                                src={item.imageUrl}
                                alt=""
                                className="h-14 w-14 shrink-0 rounded border object-contain"
                                loading="lazy"
                                onError={(event) => { event.currentTarget.style.display = "none"; }}
                              />
                            )}
                            <span>{item.description}</span>
                          </div>
                        </td>
                        <td className="text-center py-3 px-2 font-mono whitespace-nowrap">{dimensionDisplay}</td>
                        <td className="text-center py-3 px-2 font-mono">{item.quantity}</td>
                        <td className="text-right py-3 px-4 font-mono font-medium">{formatCurrency(item.amount)}</td>
                        {showDiscountCol && (
                          <td className="text-right py-3 px-4 font-mono">
                            {item.isComplimentary ? (
                              <>
                                <div className="text-xs text-muted-foreground font-sans">
                                  Complimentary{item.complimentaryOfferName ? ` (${item.complimentaryOfferName})` : ''}
                                </div>
                                <div className="font-semibold">{formatCurrency(0)}</div>
                              </>
                            ) : (quote.discount || 0) > 0 ? (
                              isWoodwork
                                ? formatCurrency(item.amount * (1 - (quote.discount || 0) / 100))
                                : 'Not Applicable'
                            ) : (
                              'Not Applicable'
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/50">
                    <td colSpan={4 + (showDiscountCol ? 1 : 0)} className="py-3 px-4">
                      <div className="flex justify-end gap-4 font-semibold">
                        <span>{subtotalLabel} (After Discount):</span>
                        <span className="font-mono font-bold">{formatCurrency(subtotal.afterDiscount)}</span>
                      </div>
                      <div className="flex justify-end gap-4 text-xs text-muted-foreground mt-1">
                        <span>Pre-Discount:</span>
                        <span className="font-mono">{formatCurrency(subtotal.preDiscount)}</span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            );
          };

          return (
            <Card key={roomIndex} className="mb-4" data-testid={`card-room-${roomIndex}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{room.roomName}</CardTitle>
                <span className="text-sm text-muted-foreground">{room.roomType}</span>
              </CardHeader>
              <CardContent>
                {roomSubcategories.length === 0 ? (
                  <div className="overflow-x-auto">
                    {renderTable(room.lineItems, "Room Subtotal")}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {roomSubcategories.map((sc, scIndex) => (
                      <div key={scIndex}>
                        <h4 className="font-medium text-sm mb-2">{sc.name}</h4>
                        <div className="overflow-x-auto">
                          {renderTable(sc.lineItems, "Subtotal")}
                        </div>
                      </div>
                    ))}
                    {ungroupedItems.length > 0 && (
                      <div>
                        <h4 className="font-medium text-sm mb-2 text-muted-foreground">Other Items</h4>
                        <div className="overflow-x-auto">
                          {renderTable(ungroupedItems, "Subtotal")}
                        </div>
                      </div>
                    )}
                    <div className="space-y-1 pt-2 border-t">
                      <div className="flex justify-end items-center gap-4">
                        <span className="font-semibold">Room Sub Total (After Discount)</span>
                        <span className="font-mono font-bold">{formatCurrency(roomSubtotal.afterDiscount)}</span>
                      </div>
                      <div className="flex justify-end items-center gap-4 text-xs text-muted-foreground">
                        <span>Pre-Discount</span>
                        <span className="font-mono">{formatCurrency(roomSubtotal.preDiscount)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Card className="mt-6" data-testid="card-summary">
          <CardHeader>
            <CardTitle>Quotation Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {categoryTotals.woodworks > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm text-muted-foreground">Woodworks</h4>
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span className="font-mono">{formatCurrency(woodworksSubtotal)}</span>
                </div>
                {(quote.discount || 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Discount ({quote.discount}%)</span>
                    <span className="font-mono text-green-600">-{formatCurrency(woodworksDiscountValue)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>GST (18%)</span>
                  <span className="font-mono">{formatCurrency(woodworksGst)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Woodworks Total</span>
                  <span className="font-mono">{formatCurrency(woodworksTotal)}</span>
                </div>
              </div>
            )}

            {categoryTotals.services > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">Services</h4>
                  <div className="flex justify-between text-sm">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatCurrency(servicesSubtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>GST (18%)</span>
                    <span className="font-mono">{formatCurrency(servicesGst)}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Services Total</span>
                    <span className="font-mono">{formatCurrency(servicesTotal)}</span>
                  </div>
                </div>
              </>
            )}

            {categoryTotals.accessories > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">Accessories</h4>
                  <div className="flex justify-between font-medium">
                    <span>Total (GST Inclusive)</span>
                    <span className="font-mono">{formatCurrency(accessoriesTotal)}</span>
                  </div>
                </div>
              </>
            )}
            {categoryTotals.furniture > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">Furniture</h4>
                  <div className="flex justify-between font-medium">
                    <span>Total (GST Inclusive)</span>
                    <span className="font-mono">{formatCurrency(furnitureTotal)}</span>
                  </div>
                </div>
              </>
            )}

            {quote.markup > 0 && categoryTotals.woodworks > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">Enablement Fee</h4>
                  <div className="flex justify-between font-medium">
                    <span>Fee ({quote.markup}%) + GST (18%)</span>
                    <span className="font-mono">{formatCurrency(enablementFeeTotal)}</span>
                  </div>
                </div>
              </>
            )}

            <Separator />

            <div className="flex justify-between items-center pt-2">
              <span className="font-bold text-lg">GST-inclusive Total</span>
              <span className="font-mono text-2xl font-bold text-primary" data-testid="text-grand-total">
                {formatCurrency(grandTotal)}
              </span>
            </div>
            {offerPercentageDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span>Offer Discount (%)</span>
                <span className="font-mono text-green-600">-{formatCurrency(offerPercentageDiscount)}</span>
              </div>
            )}
            {cashDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span>Cash Discount (after GST)</span>
                <span className="font-mono text-green-600">-{formatCurrency(cashDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t">
              <span className="font-bold text-lg">Final Payable Amount</span>
              <span className="font-mono text-2xl font-bold text-primary" data-testid="text-final-payable">
                {formatCurrency(finalPayable)}
              </span>
            </div>

            </CardContent>
        </Card>

        {companySettings?.termsAndConditions && (
          <Card className="mt-6" data-testid="card-terms-conditions">
            <CardHeader>
              <CardTitle className="text-lg">Terms & Conditions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                {companySettings.termsAndConditions}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-center text-sm text-muted-foreground mt-8">
          <p>Powered by {companySettings?.appName || "Quote Builder"}</p>
        </div>
      </div>
    </div>
  );
}
