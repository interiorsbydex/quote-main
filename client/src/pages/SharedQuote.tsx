import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { FileText, Clock, AlertCircle } from "lucide-react";
import { sortLineItemsByCategory } from "@/lib/types";

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
}

interface SharedRoom {
  roomName: string;
  roomType: string;
  lineItems: SharedLineItem[];
}

interface SharedQuoteData {
  clientName: string;
  projectType: string;
  category: string;
  pid?: string | null;
  markup: number;
  discount: number;
  createdAt: string;
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

  // Map all 6 categories to 3 GST categories:
  // - woodworks → woodworks (GST + markup/discount)
  // - services → services (GST only)
  // - accessories, handles, lights, stone → accessories (GST inclusive)
  const categoryTotals = quote.rooms.reduce(
    (acc, room) => {
      room.lineItems.forEach((item) => {
        const rawItemType = item.itemType || "woodworks";
        let gstCategory: "woodworks" | "services" | "accessories";
        if (rawItemType === "woodworks") {
          gstCategory = "woodworks";
        } else if (rawItemType === "services") {
          gstCategory = "services";
        } else {
          gstCategory = "accessories";
        }
        acc[gstCategory] = (acc[gstCategory] || 0) + item.amount;
      });
      return acc;
    },
    { woodworks: 0, services: 0, accessories: 0 }
  );

  const woodworksSubtotal = categoryTotals.woodworks;
  const woodworksDiscountValue = woodworksSubtotal * ((quote.discount || 0) / 100);
  const woodworksAfterDiscount = woodworksSubtotal - woodworksDiscountValue;
  const woodworksGst = woodworksAfterDiscount * 0.18;
  const woodworksTotal = woodworksAfterDiscount + woodworksGst;

  const enablementFeeValue = woodworksSubtotal * (quote.markup / 100);
  const enablementFeeGst = enablementFeeValue * 0.18;
  const enablementFeeTotal = enablementFeeValue + enablementFeeGst;

  const servicesSubtotal = categoryTotals.services;
  const servicesGst = servicesSubtotal * 0.18;
  const servicesTotal = servicesSubtotal + servicesGst;

  const accessoriesTotal = categoryTotals.accessories;

  const grandTotal = woodworksTotal + servicesTotal + accessoriesTotal + enablementFeeTotal;

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

        {quote.rooms.map((room, roomIndex) => (
          <Card key={roomIndex} className="mb-4" data-testid={`card-room-${roomIndex}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{room.roomName}</CardTitle>
              <span className="text-sm text-muted-foreground">{room.roomType}</span>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-border bg-muted/50">
                      <th className="text-left py-3 px-4">Description</th>
                      <th className="text-center py-3 px-2 whitespace-nowrap">
                        Dimensions ({companySettings?.dimensionDisplayUnit === "mm" ? "mm" : "ft"})
                      </th>
                      <th className="text-center py-3 px-2">Qty</th>
                      <th className="text-right py-3 px-4">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortLineItemsByCategory(room.lineItems).map((item, itemIndex) => {
                      const hasDimensions = item.lengthFt > 0 && item.heightFt > 0;
                      const useMm = companySettings?.dimensionDisplayUnit === "mm";
                      const dimensionDisplay = hasDimensions
                        ? useMm
                          ? `${item.lengthMm || Math.round(item.lengthFt * 304.8)} × ${item.heightMm || Math.round(item.heightFt * 304.8)} mm`
                          : `${item.lengthFt} × ${item.heightFt} ft`
                        : "N/A";

                      return (
                        <tr 
                          key={itemIndex} 
                          className={`border-b border-border/50 ${itemIndex % 2 === 0 ? '' : 'bg-muted/20'}`}
                        >
                          <td className="py-3 px-4">{item.description}</td>
                          <td className="text-center py-3 px-2 font-mono whitespace-nowrap">{dimensionDisplay}</td>
                          <td className="text-center py-3 px-2 font-mono">{item.quantity}</td>
                          <td className="text-right py-3 px-4 font-mono font-medium">{formatCurrency(item.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/50">
                      <td colSpan={3} className="text-right py-3 px-4 font-semibold">Room Subtotal:</td>
                      <td className="text-right py-3 px-4 font-mono font-bold">
                        {formatCurrency(room.lineItems.reduce((sum, item) => sum + item.amount, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}

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
              <span className="font-bold text-lg">Grand Total</span>
              <span className="font-mono text-2xl font-bold text-primary" data-testid="text-grand-total">
                {formatCurrency(grandTotal)}
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
