import { PAYMENT_TIERS, RETENTION_AMOUNT } from "./schema";

interface LineItemForCalc {
  amount: number;
  itemType?: string | null;
}

export interface CategoryTotals {
  woodworks: number;
  services: number;
  accessories: number;
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
  lineItemsSubtotal: number;
  totalProjectValue: number;
  totalGst: number;
  grandTotal: number;
  hasWoodworks: boolean;
  hasServices: boolean;
  hasAccessories: boolean;
  hasAnyItems: boolean;
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

export function computeCategoryTotals(lineItems: LineItemForCalc[]): CategoryTotals {
  return lineItems.reduce<CategoryTotals>(
    (acc, item) => {
      const rawItemType = item.itemType || "woodworks";
      let gstCategory: keyof CategoryTotals;
      if (rawItemType === "woodworks") {
        gstCategory = "woodworks";
      } else if (rawItemType === "services") {
        gstCategory = "services";
      } else {
        gstCategory = "accessories";
      }
      acc[gstCategory] += item.amount;
      return acc;
    },
    { woodworks: 0, services: 0, accessories: 0 }
  );
}

export function computeQuotationTotals(
  lineItems: LineItemForCalc[],
  markup: number,
  discount: number
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

  const lineItemsSubtotal = woodworksSubtotal + servicesSubtotal + accessoriesTotal;
  const totalProjectValue = woodworksAfterDiscount + servicesSubtotal + accessoriesTotal + enablementFeeValue;
  const totalGst = woodworksGst + servicesGst + enablementFeeGst;
  const grandTotal = woodworksTotal + servicesTotal + accessoriesTotal + enablementFeeTotal;

  const hasWoodworks = woodworksSubtotal > 0;
  const hasServices = servicesSubtotal > 0;
  const hasAccessories = accessoriesTotal > 0;
  const hasAnyItems = hasWoodworks || hasServices || hasAccessories;

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
    lineItemsSubtotal,
    totalProjectValue,
    totalGst,
    grandTotal,
    hasWoodworks,
    hasServices,
    hasAccessories,
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

  let tokenAdvance = 0;
  let tier = "";
  for (const t of PAYMENT_TIERS) {
    if (grandTotal <= t.maxValue) {
      tokenAdvance = t.tokenAdvance;
      tier = t.maxValue === 1500000 ? "\u226415L" : t.maxValue === 3000000 ? "15-30L" : ">30L";
      break;
    }
  }

  const preSignoff = Math.round(grandTotal * 0.3) - tokenAdvance;
  const designSignoff = Math.round(grandTotal * 0.3);
  const retention = RETENTION_AMOUNT;
  const materialDelivery = Math.round(grandTotal * 0.4) - retention;
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
