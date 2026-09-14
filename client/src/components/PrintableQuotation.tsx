import { forwardRef } from "react";
import type { Project, Room, LineItem, RoomSubcategory, ProjectOffer } from "@/lib/types";
import { sortLineItemsByCategory } from "@/lib/types";
import { format } from "date-fns";
import { computeQuotationTotals, computePaymentSchedule, computeRoomSubtotalDisplay } from "@shared/calculations";

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

interface PrintableQuotationProps {
  project: Project;
  rooms: Room[];
  lineItems: LineItem[];
  subcategories?: RoomSubcategory[];
  markup: number;
  discount: number;
  companySettings?: CompanySettings;
  showDetailedPricing?: boolean;
  offers?: ProjectOffer[];
}

const PrintableQuotation = forwardRef<HTMLDivElement, PrintableQuotationProps>(
  ({ project, rooms, lineItems, subcategories = [], markup, discount, companySettings, showDetailedPricing = false, offers = [] }, ref) => {
    const {
      categoryTotals,
      woodworksSubtotal, woodworksDiscountValue, woodworksAfterDiscount,
      woodworksGst, woodworksTotal,
      enablementFeeTotal,
      servicesSubtotal, servicesGst, servicesTotal,
      accessoriesTotal, furnitureTotal,
      totalGst, grandTotal, offerPercentageDiscount, cashDiscount, finalPayable,
    } = computeQuotationTotals(lineItems, markup, discount, offers.filter((offer) => offer.isApplied));

    const formatCurrency = (amount: number) => `\u20B9${Math.round(amount).toLocaleString("en-IN")}`;

    const paymentSchedule = finalPayable > 0 ? computePaymentSchedule(finalPayable) : null;

    return (
      <>
        <style>
          {`
            @media print {
              .print-quotation tr { 
                page-break-inside: avoid; 
                break-inside: avoid; 
              }
              .print-quotation .room-section { 
                page-break-inside: auto; 
                break-inside: auto; 
              }
              .print-quotation table { 
                page-break-inside: auto; 
              }
              .print-quotation thead { 
                display: table-header-group; 
              }
              .print-quotation tfoot { 
                display: table-footer-group; 
              }
            }
          `}
        </style>
        <div ref={ref} className="print-quotation bg-white text-black p-8 max-w-4xl mx-auto" style={{ fontFamily: "Arial, sans-serif" }}>
        <header className="border-b-2 border-gray-800 pb-4 mb-6">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-4">
              {companySettings?.logoUrl && (
                <img 
                  src={companySettings.logoUrl} 
                  alt="Company Logo" 
                  className="h-16 w-auto object-contain"
                />
              )}
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {companySettings?.companyName || "QUOTATION"}
                </h1>
                {companySettings?.address && (
                  <p className="text-sm text-gray-600">{companySettings.address}</p>
                )}
                {(companySettings?.city || companySettings?.state) && (
                  <p className="text-sm text-gray-600">
                    {[companySettings.city, companySettings.state, companySettings.pincode].filter(Boolean).join(", ")}
                  </p>
                )}
                {companySettings?.phone && (
                  <p className="text-sm text-gray-600">Tel: {companySettings.phone}</p>
                )}
                {companySettings?.email && (
                  <p className="text-sm text-gray-600">{companySettings.email}</p>
                )}
                {companySettings?.gstNumber && (
                  <p className="text-sm text-gray-600 font-medium">GSTIN: {companySettings.gstNumber}</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <h2 className="text-xl font-bold text-gray-900 mb-2">QUOTATION</h2>
              <p className="text-sm text-gray-600">Date: {format(new Date(), "dd MMM yyyy")}</p>
              <p className="text-sm text-gray-600">Quote #: {project.pid || `QB-${project.id.slice(0, 8).toUpperCase()}`}</p>
            </div>
          </div>
        </header>

        <section className="mb-6">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Client Details</h3>
              <p className="font-semibold text-lg">{project.clientName}</p>
              <p className="text-gray-600">{project.projectType} Project</p>
            </div>
            <div className="text-right">
              <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Category</h3>
              <p className="font-semibold">
                {project.multiStyleEnabled ? 'MSP (Multi Style Purpose)' : project.defaultCategory}
              </p>
            </div>
          </div>
        </section>

        {rooms.map((room) => {
          const roomLineItems = lineItems.filter((li) => li.roomId === room.id);
          if (roomLineItems.length === 0) return null;

          const roomSubtotal = computeRoomSubtotalDisplay(roomLineItems, discount);
          // Room's own style override, falling back to the project default when unset
          // (mirrors the resolution used on RoomDetail). Stripped of the "DeX - " prefix
          // for a friendly label, matching the project-level category display above.
          const roomVariantLabel = (room.category || project.defaultCategory || "").replace(/^DeX - /, "");

          const roomSubcategories = subcategories.filter((sc) => sc.roomId === room.id);
          const ungroupedItems = roomLineItems.filter((li) => !li.subcategoryId);

          const renderTable = (items: LineItem[], key: string, subtotalLabel: string) => {
            const items2 = sortLineItemsByCategory(items);
            const subtotal = computeRoomSubtotalDisplay(items2, discount);
            // A complimentary item's ₹0/offer label needs this column even when no
            // project-level discount is set, so it isn't hidden.
            const hasComplimentary = items2.some((li) => li.isComplimentary);
            const showDiscountCol = discount > 0 || hasComplimentary;
            return (
              <table key={key} className="w-full text-sm border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-200 border-b-2 border-gray-400">
                    <th className="text-left py-3 px-4 border-r border-gray-300">Description</th>
                    {showDetailedPricing && (
                      <>
                        <th className="text-center py-3 px-2 border-r border-gray-300 whitespace-nowrap">
                          Dimensions ({companySettings?.dimensionDisplayUnit === "mm" ? "mm" : "ft"})
                        </th>
                        <th className="text-center py-3 px-2 border-r border-gray-300">Qty</th>
                      </>
                    )}
                    <th className="text-right py-3 px-4 border-r border-gray-300">Amount</th>
                    {showDiscountCol && (
                      <th className="text-right py-3 px-4">Amount After Discount</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items2.map((li, index) => {
                    const hasDimensions = li.lengthFt > 0 && li.heightFt > 0;
                    const useMm = companySettings?.dimensionDisplayUnit === "mm";
                    const dimensionDisplay = hasDimensions 
                      ? useMm 
                        ? `${li.lengthMm || Math.round(li.lengthFt * 304.8)} × ${li.heightMm || Math.round(li.heightFt * 304.8)} mm`
                        : `${li.lengthFt} × ${li.heightFt} ft`
                      : "N/A";
                    const isWoodwork = (li.itemType || "woodworks") === "woodworks";
                    
                    return (
                      <tr key={li.id} className={`border-b border-gray-300 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        <td className="py-3 px-4 border-r border-gray-200">
                          <div className="flex items-center gap-2">
                            {li.imageUrl && (
                              <img
                                src={li.imageUrl}
                                alt=""
                                className="h-14 w-14 shrink-0 rounded border object-contain"
                                onError={(event) => { event.currentTarget.style.display = "none"; }}
                              />
                            )}
                            <span>{li.description}</span>
                          </div>
                        </td>
                        {showDetailedPricing && (
                          <>
                            <td className="text-center py-3 px-2 border-r border-gray-200 whitespace-nowrap">{dimensionDisplay}</td>
                            <td className="text-center py-3 px-2 border-r border-gray-200">{li.quantity}</td>
                          </>
                        )}
                        <td className="text-right py-3 px-4 font-mono font-medium border-r border-gray-200">{formatCurrency(li.amount)}</td>
                        {showDiscountCol && (
                          <td className="text-right py-3 px-4 font-mono">
                            {li.isComplimentary ? (
                              <>
                                <div className="text-xs text-gray-500 font-sans">
                                  Complimentary{li.complimentaryOfferName ? ` (${li.complimentaryOfferName})` : ''}
                                </div>
                                <div className="font-semibold">{formatCurrency(0)}</div>
                              </>
                            ) : discount > 0 ? (
                              isWoodwork
                                ? formatCurrency(li.amount * (1 - discount / 100))
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
                  <tr className="bg-gray-100 border-t-2 border-gray-400">
                    <td colSpan={(showDetailedPricing ? 4 : 2) + (showDiscountCol ? 1 : 0)} className="py-3 px-4">
                      <div className="flex justify-end gap-4 font-semibold">
                        <span>{subtotalLabel} (After Discount):</span>
                        <span className="font-mono font-bold">{formatCurrency(subtotal.afterDiscount)}</span>
                      </div>
                      <div className="flex justify-end gap-4 text-xs text-gray-600 mt-1">
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
            <section key={room.id} className="mb-6 room-section">
              <div className="bg-gray-100 px-4 py-2 mb-2">
                <h3 className="font-semibold">
                  {room.roomName}
                  {roomVariantLabel && <span className="text-sm font-normal text-gray-600 ml-2">({roomVariantLabel})</span>}
                </h3>
                <span className="text-sm text-gray-600">{room.roomType}</span>
              </div>

              {roomSubcategories.length === 0 ? (
                renderTable(roomLineItems, room.id, "Room Subtotal")
              ) : (
                <div className="space-y-4">
                  {roomSubcategories.map((sc) => {
                    const items = roomLineItems.filter((li) => li.subcategoryId === sc.id);
                    if (items.length === 0) return null;
                    return (
                      <div key={sc.id}>
                        <h4 className="font-medium text-sm mb-1">{sc.name}</h4>
                        {renderTable(items, sc.id, "Subtotal")}
                      </div>
                    );
                  })}
                  {ungroupedItems.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-1 text-gray-600">Other Items</h4>
                      {renderTable(ungroupedItems, `${room.id}-ungrouped`, "Subtotal")}
                    </div>
                  )}
                  <div className="text-right">
                    <div>
                      <span className="font-semibold text-sm mr-4">Room Sub Total (After Discount):</span>
                      <span className="font-mono font-bold text-sm">{formatCurrency(roomSubtotal.afterDiscount)}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      <span className="mr-4">Pre-Discount:</span>
                      <span className="font-mono">{formatCurrency(roomSubtotal.preDiscount)}</span>
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })}

        <section className="border-t-2 border-gray-800 pt-4 mt-8">
          <h3 className="font-semibold text-lg mb-4">Summary</h3>
          <table className="w-full text-sm">
            <tbody>
              {categoryTotals.woodworks > 0 && (
                <>
                  <tr>
                    <td className="py-1 text-gray-600">Woodworks Subtotal</td>
                    <td className="text-right py-1 font-mono">{formatCurrency(woodworksSubtotal)}</td>
                  </tr>
                  {discount > 0 && (
                    <tr>
                      <td className="py-1 text-gray-600">Discount ({discount}%)</td>
                      <td className="text-right py-1 font-mono text-green-600">-{formatCurrency(woodworksDiscountValue)}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="py-1 text-gray-600">GST on Woodworks (18%)</td>
                    <td className="text-right py-1 font-mono">{formatCurrency(woodworksGst)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-1 font-semibold">Woodworks Total</td>
                    <td className="text-right py-1 font-mono font-semibold">{formatCurrency(woodworksTotal)}</td>
                  </tr>
                </>
              )}
              {categoryTotals.services > 0 && (
                <>
                  <tr>
                    <td className="py-1 pt-2 text-gray-600">Services Subtotal</td>
                    <td className="text-right py-1 pt-2 font-mono">{formatCurrency(servicesSubtotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-gray-600">GST on Services (18%)</td>
                    <td className="text-right py-1 font-mono">{formatCurrency(servicesGst)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-1 font-semibold">Services Total</td>
                    <td className="text-right py-1 font-mono font-semibold">{formatCurrency(servicesTotal)}</td>
                  </tr>
                </>
              )}
              {categoryTotals.accessories > 0 && (
                <tr className="border-b">
                  <td className="py-1 pt-2 font-semibold">Accessories Total (GST Inclusive)</td>
                  <td className="text-right py-1 pt-2 font-mono font-semibold">{formatCurrency(accessoriesTotal)}</td>
                </tr>
              )}
              {categoryTotals.furniture > 0 && (
                <tr className="border-b">
                  <td className="py-1 pt-2 font-semibold">Furniture Total (GST Inclusive)</td>
                  <td className="text-right py-1 pt-2 font-mono font-semibold">{formatCurrency(furnitureTotal)}</td>
                </tr>
              )}
              {markup > 0 && (
                <tr className="border-b">
                  <td className="py-1 pt-2 font-semibold">Enablement Fee ({markup}%) + GST (18%)</td>
                  <td className="text-right py-1 pt-2 font-mono font-semibold">{formatCurrency(enablementFeeTotal)}</td>
                </tr>
              )}
              <tr>
                <td className="py-1 pt-2 font-semibold">GST-inclusive Total</td>
                <td className="text-right py-1 pt-2 font-mono font-semibold">{formatCurrency(grandTotal)}</td>
              </tr>
              {offerPercentageDiscount > 0 && (
                <tr>
                  <td className="py-1 text-gray-600">Offer Discount (%)</td>
                  <td className="text-right py-1 font-mono text-green-600">-{formatCurrency(offerPercentageDiscount)}</td>
                </tr>
              )}
              {cashDiscount > 0 && (
                <tr>
                  <td className="py-1 text-gray-600">Cash Discount (after GST)</td>
                  <td className="text-right py-1 font-mono text-green-600">-{formatCurrency(cashDiscount)}</td>
                </tr>
              )}
              <tr className="text-lg border-t">
                <td className="py-3 font-bold">FINAL PAYABLE AMOUNT</td>
                <td className="text-right py-3 font-mono font-bold text-xl">{formatCurrency(finalPayable)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {paymentSchedule && (
          <section className="mt-6 pt-4 border-t border-gray-400">
            <h3 className="font-semibold text-lg mb-3">Payment Schedule</h3>
            <table className="w-full text-sm border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-200 border-b-2 border-gray-400">
                  <th className="text-left py-2 px-4 border-r border-gray-300">Payment Stage</th>
                  <th className="text-right py-2 px-4">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-300">
                  <td className="py-2 px-4 border-r border-gray-200">Onboarding Amount</td>
                  <td className="text-right py-2 px-4 font-mono">{formatCurrency(paymentSchedule.tokenAdvance)}</td>
                </tr>
                <tr className="border-b border-gray-300 bg-gray-50">
                  <td className="py-2 px-4 border-r border-gray-200">Pre Sign-off - 30%</td>
                  <td className="text-right py-2 px-4 font-mono">{formatCurrency(paymentSchedule.preSignoff)}</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="py-2 px-4 border-r border-gray-200">Design Sign Off - 30%</td>
                  <td className="text-right py-2 px-4 font-mono">{formatCurrency(paymentSchedule.designSignoff)}</td>
                </tr>
                <tr className="border-b border-gray-300 bg-gray-50">
                  <td className="py-2 px-4 border-r border-gray-200">Upon Modular Material Delivery - 40%</td>
                  <td className="text-right py-2 px-4 font-mono">{formatCurrency(paymentSchedule.materialDelivery)}</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="py-2 px-4 border-r border-gray-200">Retention Amount</td>
                  <td className="text-right py-2 px-4 font-mono">{formatCurrency(paymentSchedule.retention)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 border-t-2 border-gray-400">
                  <td className="py-2 px-4 font-semibold border-r border-gray-300">Total</td>
                  <td className="text-right py-2 px-4 font-mono font-bold">{formatCurrency(paymentSchedule.total)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        <footer className="mt-8 pt-4 border-t text-sm text-gray-600">
          {/* Payment summary row */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h4 className="font-semibold mb-1">Payment Details</h4>
              <p className="text-xs">Total GST: {formatCurrency(totalGst)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs">Generated by {companySettings?.companyName || companySettings?.appName || "Quote Builder"}</p>
              <p className="text-xs">{format(new Date(), "dd/MM/yyyy HH:mm")}</p>
            </div>
          </div>
          
          {/* Terms & Conditions - full width for better readability */}
          <div className="border-t pt-4">
            <h4 className="font-semibold mb-3">Terms & Conditions</h4>
            <div className="text-xs leading-relaxed">
              {companySettings?.termsAndConditions ? (
                <div className="whitespace-pre-line">{companySettings.termsAndConditions}</div>
              ) : (
                <>
                  <p className="font-semibold mb-1">1. Quotation, Scope &amp; Pricing</p>
                  <ul className="list-disc list-inside space-y-0.5 mb-2">
                    <li>This quotation is valid for 28 days from the date of issue unless stated otherwise in writing.</li>
                    <li>Pricing is based on the approved scope, measurements, and selections at the time of quotation and shall remain valid during the quotation validity period unless there is a change in scope, measurements, selections, site conditions, or the quotation validity expires.</li>
                    <li>The Final Approved Quotation issued at Design Sign-off shall be commercially binding.</li>
                    <li>DeX shall execute only the items listed in the approved BOQ. Any item not specifically listed shall be deemed excluded.</li>
                    <li>GST shall be charged as applicable and reflected in the approved quotation.</li>
                  </ul>
                  <p className="font-semibold mb-1">2. Approvals, Variations &amp; Project Progression</p>
                  <ul className="list-disc list-inside space-y-0.5 mb-2">
                    <li>All project stages, including design approvals, BOQ approvals, material selections, production release, procurement, variations, and execution milestones, shall proceed only upon receipt of written email approval and applicable stage payment.</li>
                    <li>Verbal discussions, phone conversations, WhatsApp messages, or informal confirmations shall not constitute approval.</li>
                    <li>A variation means any change to the approved scope, quantity, design, material, finish, specification, or execution after BOQ approval and shall be priced separately.</li>
                    <li>Delays in approvals, payments, site readiness, material selections, information sharing, permissions, or Client decisions shall automatically extend project timelines, and DeX shall not be responsible for such delays.</li>
                  </ul>
                  <p className="font-semibold mb-1">3. Design Services</p>
                  <ul className="list-disc list-inside space-y-0.5 mb-2">
                    <li>DeX provides services as part of an integrated design-to-execution model and not as standalone design consultancy or file-licensing services.</li>
                    <li>Design revisions shall be subject to the agreed scope and available design credits.</li>
                    <li>Design Freeze shall be deemed complete only upon final email approval of design, layout, materials, and finishes, together with receipt of 30% of the project value.</li>
                    <li>Any change requested after Design Freeze shall be treated as a variation.</li>
                    <li>Design files shall not be shared before Design Freeze. Files shared thereafter are for reference only and remain the intellectual property of DeX.</li>
                    <li>DeX may provide certain supplementary drawings, layouts, recommendations, or coordination documents beyond its contracted scope as a support service. Such documents shall be shared only after Design Freeze and are intended solely for coordination purposes. DeX shall not assume ownership, responsibility, certification, or liability for such documents or their implementation.</li>
                  </ul>
                  <p className="font-semibold mb-1">4. Execution, Timelines &amp; Site Conditions</p>
                  <ul className="list-disc list-inside space-y-0.5 mb-2">
                    <li>Timelines are indicative: Design Phase 15–45 Days; Design Validation &amp; Sign-off 7–14 Days; Production / Execution 35–90 Days or More.</li>
                    <li>The Client shall ensure the site is accessible, safe, and ready for execution and shall obtain all necessary permissions, approvals, gate passes, and work permits.</li>
                    <li>Delays arising from pending civil, electrical, plumbing, third-party work, restricted access, incomplete site conditions, or missing approvals may result in revised timelines and additional costs.</li>
                    <li>Any difference identified during final site measurements or execution affecting quantities, materials, design, or scope shall be treated as a variation.</li>
                    <li>If materials are ready for dispatch but the site is not ready for installation, DeX reserves the right to charge reasonable storage and handling costs.</li>
                  </ul>
                  <p className="font-semibold mb-1">5. Materials, Payments &amp; Warranty</p>
                  <ul className="list-disc list-inside space-y-0.5 mb-2">
                    <li>Approved materials, finishes, hardware, and accessories are subject to market availability. DeX may propose equivalent alternatives if approved selections become unavailable or discontinued.</li>
                    <li>Actual colours, grains, textures, patterns, and finishes may vary from samples, renders, photographs, catalogues, or digital representations. Natural materials may exhibit inherent variations and shall not be considered defects.</li>
                    <li>Only items expressly stated in the approved quotation or BOQ are included. Any verbal commitments, assumptions, or claims shall be considered invalid.</li>
                    <li>DeX shall not be responsible for the quality, compatibility, performance, warranty, defects, delays, or damages relating to Client-supplied or third-party supplied items.</li>
                    <li>Payments shall be made only to DeX's authorized accounts. DeX reserves the right to suspend procurement, production, delivery, installation, warranty support, or ongoing services until overdue payments are received.</li>
                    <li>Payment milestones shall be governed by the approved quotation and payment schedule. Delays in payment may result in suspension of project activities and corresponding timeline extensions.</li>
                    <li>Warranty coverage shall be governed by the DeX Warranty Card and shall become effective only upon project completion, formal handover, signing of the handover document by the Client, and receipt of all outstanding payments.</li>
                  </ul>
                  <p className="font-semibold mb-1">6. General</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>All designs, drawings, BOQs, renders, specifications, and project documentation created by DeX remain the exclusive intellectual property of DeX.</li>
                    <li>Offers and discounts are governed solely by terms communicated through official DeX communication channels and apply only to the original approved BOQ scope unless otherwise stated in writing.</li>
                    <li>The token amount reserves project resources and initiates design, planning, and site documentation activities. A refund may be requested within 48 hours of payment provided work has not commenced. Once work has commenced, the token shall become non-refundable.</li>
                    <li>DeX shall not be liable for delays or non-performance arising from events beyond its reasonable control, including natural disasters, government restrictions, transportation disruptions, labour shortages, material shortages, pandemics, utility failures, strikes, lockouts, or similar unforeseen events.</li>
                    <li>By approving this quotation, paying the token amount, or proceeding with DeX services, the Client shall be deemed to have accepted these Terms &amp; Conditions and DeX General Policies (Residential).</li>
                    <li>In the event of any inconsistency, the following order of precedence shall apply: (1) Final Approved Quotation / Design Sign-off, (2) Email-Approved Variations, (3) Onboarding Quotation, and (4) DeX General Policies (Residential).</li>
                  </ul>
                </>
              )}
            </div>
          </div>
        </footer>
      </div>
      </>
    );
  }
);

PrintableQuotation.displayName = "PrintableQuotation";

export default PrintableQuotation;
