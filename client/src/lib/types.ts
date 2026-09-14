// Style options - main material specification (project/room level)
export const DEX_STYLES = [
  "DeX - Xpress",
  "DeX - Xpand"
] as const;

export type DexStyle = typeof DEX_STYLES[number];

// All catalog categories - for line item selection
export const DEX_CATEGORIES = [
  "DeX - Xpress",
  "DeX - Xpand", 
  "DeX - Accessories",
  "DeX - Services",
  "DeX - Lights",
  "DeX - Stone Master",
  "DeX - Handles"
] as const;

export type DexCategory = typeof DEX_CATEGORIES[number];

// Item type for GST calculation purposes
export type ItemType = 'woodworks' | 'services' | 'accessories';

// All item category types (6 categories)
export type ItemCategoryType = 'woodworks' | 'accessories' | 'handles' | 'services' | 'lights' | 'stone';

// Category order for sorting line items
export const CATEGORY_SORT_ORDER: Record<string, number> = {
  'woodworks': 1,
  'accessories': 2,
  'handles': 3,
  'services': 4,
  'lights': 5,
  'stone': 6,
};

// Helper to sort line items by category order
export function sortLineItemsByCategory<T extends { itemType?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderA = CATEGORY_SORT_ORDER[a.itemType || 'woodworks'] || 99;
    const orderB = CATEGORY_SORT_ORDER[b.itemType || 'woodworks'] || 99;
    return orderA - orderB;
  });
}

export interface CatalogItem {
  id: string;
  categoryName: DexCategory | string; // string for backward compatibility with legacy data
  roomType: "Wet / Exposed" | "Dry / Inexposed" | string;
  section?: string; // Work type for Services (e.g., "Civil Services")
  unitType: string;
  materialType?: string;
  brand?: string;
  description: string;
  rate: number;
  markup: number;
  sellingPrice: number;
  imageUrl?: string; // URL to product image (hosted externally)
  itemType?: ItemType; // Derived from category for GST calculation
}

export interface MaterialSpec {
  coreMaterial?: string;
  finishMaterial?: string;
  hinges?: string;
  brand?: string;
  laminateType?: string;
}

export interface Client {
  id: string;
  userId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  userId: string;
  clientId?: string | null;
  clientName: string;
  pid?: string | null; // Project ID for easy reference/search
  scope?: string | null; // Captured from CRM deep link, no dedicated UI field yet
  location?: string | null; // Captured from CRM deep link, no dedicated UI field yet
  estimatedValue?: string | null; // Captured from CRM deep link, no dedicated UI field yet
  leadId?: string | null; // Captured from CRM deep link, no dedicated UI field yet
  projectType: "Residential" | "Commercial" | "Others";
  defaultCategory: DexCategory | string; // string for backward compatibility
  multiStyleEnabled: boolean;
  status: "Draft" | "Generated";
  markup: number | null;
  discount: number | null;
  shareToken?: string | null; // For shareable client portal links
  shareEnabled?: boolean; // Toggle to enable/disable sharing
  createdAt: Date;
  updatedAt: Date;
}

export interface Room {
  id: string;
  projectId: string;
  roomName: string;
  roomType: "Wet / Exposed" | "Dry / Inexposed";
  unitGroupName?: string | null;
  category?: string | null;
  createdAt: Date;
}

export interface LineItem {
  id: string;
  roomId: string;
  projectId: string;
  description: string;
  unitType: string;
  lengthFt: number;
  heightFt: number;
  sqft: number;
  lengthMm: number;
  heightMm: number;
  rate: number;
  quantity: number;
  amount: number;
  itemType: ItemType; // For GST calculation - woodworks/services/accessories
  createdAt: Date;
}

export interface QuotationSummary {
  subtotal: number;
  markupPercentage: number;
  markupValue: number;
  totalWithMarkup: number;
  gstPercentage: number;
  gstAmount: number;
  grandTotal: number;
}

// User role hierarchy: super_admin > admin (team manager) > user (team member)
export type UserRole = "super_admin" | "admin" | "user";

export interface User {
  id: string;
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role: UserRole;
  managerId?: string | null;
}

// ==================== DESIGN CREDITS SYSTEM ====================

export interface ProjectCredits {
  id: string;
  projectId: string;
  totalCredits: number;
  usedCredits: number;
  availableCredits: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreditTransaction {
  id: string;
  projectId: string;
  milestoneId?: string | null;
  type: 'credit' | 'debit';
  amount: number;
  balanceAfter: number;
  description: string;
  paymentReference?: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface Milestone {
  id: string;
  projectId: string;
  roomId?: string | null;
  milestoneType?: string | null;
  name: string;
  description?: string | null;
  creditAmount: number;
  status: 'pending' | 'submitted' | 'approved' | 'rejected';
  revisionCount: number;
  revisionNotes?: string | null;
  assignedTo?: string | null;
  submittedAt?: Date | null;
  submittedBy?: string | null;
  reviewedAt?: Date | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
