import { PAYMENT_TIERS, RETENTION_AMOUNT } from "./schema";

interface LineItemForCalc {
  amount: number;
  itemType?: string | null;
  // Complimentary Offer items: shown to the customer at their normal MRP (`amount`)
  // but billed at ₹0. They must be excluded from every subtotal/total below.
  isComplimentary?: boolean | null;
}

export interface CategoryTotals {
  woodworks: number;
  services: number;
  accessories: number;
  furniture: number;
}

export interface QuotationTotals {
  categoryTotals: CategoryTotals;
  woodworksSubtotal: number;
  woodworksDiscountValue: number;
  woodworksAfterDiscount: number;
  woodworksGst: number;
  woodworksTotal: number;
  enablementFeeValue: number;
  enablementFeeGst: number;
  enablementFeeTotal: number;
  servicesSubtotal: number;
  servicesGst: number;
  servicesTotal: number;
  accessoriesTotal: number;
  furnitureTotal: number;
  lineItemsSubtotal: number;
  totalProjectValue: number;
  totalGst: number;
  grandTotal: number;
  offerPercentageDiscount: number;
  cashDiscount: number;
  finalPayable: number;
  hasWoodworks: boolean;
  hasServices: boolean;
  hasAccessories: boolean;
  hasFurniture: boolean;
  hasAnyItems: boolean;
}

export interface AppliedOfferForCalculation {
  offerType: "percentage" | "cash" | string;
  percentageValue?: number | null;
  cashValue?: number | null;
}

export interface OfferTotals {
  offerPercentageDiscount: number;
  cashDiscount: number;
  finalPayable: number;
}

// Offers are quotation-level reductions: they are applied only after all existing
// category discounts and GST calculations have produced the GST-inclusive total.
export function computeOfferTotals(
  gstInclusiveTotal: number,
  appliedOffers: AppliedOfferForCalculation[] = [],
): OfferTotals {
  const percentageValue = appliedOffers
    .filter((offer) => offer.offerType === "percentage")
    .reduce((total, offer) => total + Math.max(0, offer.percentageValue || 0), 0);
  const offerPercentageDiscount = gstInclusiveTotal * (percentageValue / 100);
  const cashDiscount = appliedOffers
    .filter((offer) => offer.offerType === "cash")
    .reduce((total, offer) => total + Math.max(0, offer.cashValue || 0), 0);

  return {
    offerPercentageDiscount,
    cashDiscount,
    finalPayable: Math.max(0, gstInclusiveTotal - offerPercentageDiscount - cashDiscount),
  };
}

export interface PaymentSchedule {
  grandTotal: number;
  tokenAdvance: number;
  preSignoff: number;
  designSignoff: number;
  materialDelivery: number;
  retention: number;
  total: number;
  tier: string;
}

export interface RoomSubtotalDisplay {
  preDiscount: number;
  afterDiscount: number;
}

export function computeRoomSubtotalDisplay(
  lineItems: LineItemForCalc[],
  discount: number
): RoomSubtotalDisplay {
  return lineItems.reduce<RoomSubtotalDisplay>(
    (totals, item) => {
      if (item.isComplimentary) return totals;

      totals.preDiscount += item.amount;
      const isWoodwork = (item.itemType || "woodworks") === "woodworks";
      totals.afterDiscount += isWoodwork
        ? item.amount * (1 - discount / 100)
        : item.amount;
      return totals;
    },
    { preDiscount: 0, afterDiscount: 0 }
  );
}

export function computeCategoryTotals(lineItems: LineItemForCalc[]): CategoryTotals {
  return lineItems.reduce<CategoryTotals>(
    (acc, item) => {
      // Complimentary items keep their MRP (`item.amount`) for display, but must
      // never contribute to any subtotal, discount, GST, markup fee, or grand
      // total. Skipping them here — before they're bucketed by category — is the
      // single choke point that guarantees the exclusion for every consumer of
      // computeCategoryTotals/computeQuotationTotals, without touching how any
      // normal (non-complimentary) item is priced or totaled.
      if (item.isComplimentary) {
        return acc;
      }
      const rawItemType = item.itemType || "woodworks";
      let gstCategory: keyof CategoryTotals;
      if (rawItemType === "woodworks") {
        gstCategory = "woodworks";
      } else if (rawItemType === "services") {
        gstCategory = "services";
      } else if (rawItemType === "furniture") {
        gstCategory = "furniture";
      } else {
        gstCategory = "accessories";
      }
      acc[gstCategory] += item.amount;
      return acc;
    },
    { woodworks: 0, services: 0, accessories: 0, furniture: 0 }
  );
}

export function computeQuotationTotals(
  lineItems: LineItemForCalc[],
  markup: number,
  discount: number,
  appliedOffers: AppliedOfferForCalculation[] = [],
): QuotationTotals {
  const categoryTotals = computeCategoryTotals(lineItems);

  const woodworksSubtotal = categoryTotals.woodworks;
  const woodworksDiscountValue = woodworksSubtotal * (discount / 100);
  const woodworksAfterDiscount = woodworksSubtotal - woodworksDiscountValue;
  const woodworksGst = woodworksAfterDiscount * 0.18;
  const woodworksTotal = woodworksAfterDiscount + woodworksGst;

  const enablementFeeValue = woodworksSubtotal * (markup / 100);
  const enablementFeeGst = enablementFeeValue * 0.18;
  const enablementFeeTotal = enablementFeeValue + enablementFeeGst;

  const servicesSubtotal = categoryTotals.services;
  const servicesGst = servicesSubtotal * 0.18;
  const servicesTotal = servicesSubtotal + servicesGst;

  const accessoriesTotal = categoryTotals.accessories;
  const furnitureTotal = categoryTotals.furniture;

  const lineItemsSubtotal = woodworksSubtotal + servicesSubtotal + accessoriesTotal + furnitureTotal;
  const totalProjectValue = woodworksAfterDiscount + servicesSubtotal + accessoriesTotal + furnitureTotal + enablementFeeValue;
  const totalGst = woodworksGst + servicesGst + enablementFeeGst;
  const grandTotal = woodworksTotal + servicesTotal + accessoriesTotal + furnitureTotal + enablementFeeTotal;
  const { offerPercentageDiscount, cashDiscount, finalPayable } = computeOfferTotals(grandTotal, appliedOffers);

  const hasWoodworks = woodworksSubtotal > 0;
  const hasServices = servicesSubtotal > 0;
  const hasAccessories = accessoriesTotal > 0;
  const hasFurniture = furnitureTotal > 0;
  const hasAnyItems = hasWoodworks || hasServices || hasAccessories || hasFurniture;

  return {
    categoryTotals,
    woodworksSubtotal,
    woodworksDiscountValue,
    woodworksAfterDiscount,
    woodworksGst,
    woodworksTotal,
    enablementFeeValue,
    enablementFeeGst,
    enablementFeeTotal,
    servicesSubtotal,
    servicesGst,
    servicesTotal,
    accessoriesTotal,
    furnitureTotal,
    lineItemsSubtotal,
    totalProjectValue,
    totalGst,
    grandTotal,
    offerPercentageDiscount,
    cashDiscount,
    finalPayable,
    hasWoodworks,
    hasServices,
    hasAccessories,
    hasFurniture,
    hasAnyItems,
  };
}

export function computePaymentSchedule(grandTotal: number): PaymentSchedule {
  if (grandTotal <= 0) {
    return {
      grandTotal: 0,
      tokenAdvance: 0,
      preSignoff: 0,
      designSignoff: 0,
      materialDelivery: 0,
      retention: 0,
      total: 0,
      tier: "N/A",
    };
  }

  let configuredTokenAdvance = 0;
  let tier = "";
  for (const t of PAYMENT_TIERS) {
    if (grandTotal <= t.maxValue) {
      configuredTokenAdvance = t.tokenAdvance;
      tier = t.maxValue === 1500000 ? "\u226415L" : t.maxValue === 3000000 ? "15-30L" : ">30L";
      break;
    }
  }

  const roundedGrandTotal = Math.round(grandTotal);
  const preSignoffTranche = Math.round(grandTotal * 0.3);
  const designSignoff = Math.round(grandTotal * 0.3);
  const materialDeliveryTranche = roundedGrandTotal - preSignoffTranche - designSignoff;
  const tokenAdvance = Math.min(configuredTokenAdvance, preSignoffTranche);
  const preSignoff = preSignoffTranche - tokenAdvance;
  const retention = Math.min(RETENTION_AMOUNT, materialDeliveryTranche);
  const materialDelivery = materialDeliveryTranche - retention;
  const total = tokenAdvance + preSignoff + designSignoff + materialDelivery + retention;

  return {
    grandTotal,
    tokenAdvance,
    preSignoff,
    designSignoff,
    materialDelivery,
    retention,
    total,
    tier,
  };
}
