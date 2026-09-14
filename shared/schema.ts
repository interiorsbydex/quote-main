import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, real, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table with username/password authentication
// Administrative roles are super_admin/admin; operational assignment roles are
// tl (Team Lead), bl (Business Lead), and dm (Design Manager).
// Status: 'pending' (created by admin, awaiting first login) or 'active' (has logged in)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  oidcId: varchar("oidc_id").unique(), // OIDC subject identifier for linking to identity provider
  username: varchar("username").unique().notNull(),
  password: varchar("password").notNull(), // Hashed with bcrypt
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: text("role").notNull().default("user"), // 'super_admin', 'admin', 'user', 'tl', 'bl', or 'dm'
  cohort: text("cohort"), // TL cohort: 'PD' or 'DTL'; null for users outside a TL cohort
  status: text("status").notNull().default("active"), // 'pending' or 'active'
  managerId: varchar("manager_id").references((): any => users.id, { onDelete: "set null" }), // Team manager reference
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Clients table - reusable client details across projects
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// Projects table
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tlId: varchar("tl_id").references(() => users.id, { onDelete: "set null" }),
  blId: varchar("bl_id").references(() => users.id, { onDelete: "set null" }),
  dmId: varchar("dm_id").references(() => users.id, { onDelete: "set null" }),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  pid: text("pid"), // Project ID for easy reference/search
  // CRM deep-link metadata: captured from Tele-CRM Tool query params when a project
  // is created via a CRM link. Not shown in the create form; kept for later use.
  scope: text("scope"),
  location: text("location"),
  estimatedValue: text("estimated_value"),
  leadId: text("lead_id"),
  projectType: text("project_type").notNull(), // 'Residential', 'Commercial', 'Others'
  defaultCategory: text("default_category").notNull(), // 'Economy', 'Lite Premium', 'Premium', 'Luxury'
  multiStyleEnabled: boolean("multi_style_enabled").notNull().default(false),
  status: text("status").notNull().default("Draft"), // 'Draft', 'Generated'
  markup: real("markup").default(0), // Global markup percentage
  discount: real("discount").default(0), // Global discount percentage (applied after markup)
  shareToken: varchar("share_token").unique(), // For shareable client portal links
  shareEnabled: boolean("share_enabled").notNull().default(false), // Toggle to enable/disable sharing
  shareExpiresAt: timestamp("share_expires_at"), // Share link expiration (30 days default)
  shareLastAccessedAt: timestamp("share_last_accessed_at"), // Track last access for analytics
  // Pricing version this project is permanently locked to. Assigned server-side at
  // creation from the currently Active version; never chosen or changed by a user.
  // Nullable so pre-existing rows remain valid until backfilled.
  pricingVersionId: varchar("pricing_version_id").references((): any => pricingVersions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// pricingVersionId is deliberately omitted: it is server-assigned from the Active
// version and must never be settable from a client request payload.
export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  pricingVersionId: true,
  tlId: true,
  blId: true,
  dmId: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// Configurable quote-level offers. They are intentionally separate from catalog
// line items and the existing woodwork discount so GST/taxable values stay intact.
export const offers = pgTable("offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  productCategory: text("product_category").notNull().default("Offer Product"),
  offerType: text("offer_type").notNull(), // 'percentage' | 'cash'
  percentageValue: real("percentage_value"),
  cashValue: real("cash_value"),
  minWoodworkValue: real("min_woodwork_value").notNull().default(0),
  maxWoodworkValue: real("max_woodwork_value"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type Offer = typeof offers.$inferSelect;

// A draft project's selected offers. The commercial terms are copied here when
// selected so the exact offer accepted on a generated quote remains auditable.
export const projectOffers = pgTable("project_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  offerId: varchar("offer_id").notNull().references(() => offers.id, { onDelete: "restrict" }),
  offerName: text("offer_name").notNull(),
  productCategory: text("product_category").notNull().default("Offer Product"),
  offerType: text("offer_type").notNull(),
  percentageValue: real("percentage_value"),
  cashValue: real("cash_value"),
  minWoodworkValue: real("min_woodwork_value").notNull().default(0),
  maxWoodworkValue: real("max_woodwork_value"),
  isLocked: boolean("is_locked").notNull().default(false),
  lockedAt: timestamp("locked_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("project_offers_project_offer_unique").on(table.projectId, table.offerId),
  index("project_offers_project_idx").on(table.projectId),
]);

export type ProjectOffer = typeof projectOffers.$inferSelect;

// Rooms table
export const rooms = pgTable("rooms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  roomName: text("room_name").notNull(),
  roomType: text("room_type").notNull(), // 'Wet / Exposed', 'Dry / Inexposed'
  unitGroupName: text("unit_group_name"),
  category: text("category"), // Override category if multiStyleEnabled
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertRoomSchema = createInsertSchema(rooms).omit({
  id: true,
  createdAt: true,
});

export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof rooms.$inferSelect;

// ---- Room sub-categories ----
// Optional grouping layer between a Room and its line items, e.g. a "Family Living
// Room" containing "TV Unit" / "Crockery Unit" / "Pooja Unit" sub-categories. A line
// item with no subcategoryId is "directly under the room" -- this is what every line
// item created before this feature already is, so nothing needs backfilling.
export const roomSubcategories = pgTable("room_subcategories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomId: varchar("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertRoomSubcategorySchema = createInsertSchema(roomSubcategories).omit({
  id: true,
  createdAt: true,
}).extend({
  name: z.string().min(1, "Name is required"),
});

export type InsertRoomSubcategory = z.infer<typeof insertRoomSubcategorySchema>;
export type RoomSubcategory = typeof roomSubcategories.$inferSelect;

// Item type for GST calculation purposes
// - woodworks: Modular items (Xpress/Xpand) - 18% GST added
// - services: Service items - 18% GST added
// - accessories: Accessories/Lights/Handles/Stone Master - GST inclusive (no additional GST)
export type ItemType = 'woodworks' | 'services' | 'accessories' | 'furniture';

// Line Items table
export const lineItems = pgTable("line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomId: varchar("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Optional grouping under a room sub-category. Null means "directly under the room",
  // which is what every pre-existing line item already is. Deleting a sub-category sets
  // this back to null (ungroups the item) rather than deleting the item.
  subcategoryId: varchar("subcategory_id").references(() => roomSubcategories.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  unitType: text("unit_type").notNull(),
  lengthFt: real("length_ft").notNull(),
  heightFt: real("height_ft").notNull(),
  depthFt: real("depth_ft").notNull().default(0),
  sqft: real("sqft").notNull(),
  lengthMm: real("length_mm").notNull(),
  heightMm: real("height_mm").notNull(),
  depthMm: real("depth_mm").notNull().default(0),
  rate: real("rate").notNull(),
  quantity: real("quantity").notNull().default(1),
  amount: real("amount").notNull(),
  itemType: text("item_type").notNull().default("woodworks"), // 'woodworks', 'services', 'accessories', 'furniture'
  // Stable catalog identity plus a fallback image snapshot. Reads prefer the current
  // image on the project's pinned catalog version, so an Admin can update an image in
  // the Sheet without recreating the quote line item.
  catalogItemCode: text("catalog_item_code"),
  imageUrl: text("image_url"),
  // Complimentary Offer: shown to the customer with its MRP (`amount`, untouched) but
  // displayed as a named ₹0 line and excluded from every total. See
  // shared/calculations.ts computeCategoryTotals for the single point that enforces the
  // exclusion. complimentaryOfferName is required whenever isComplimentary is true.
  isComplimentary: boolean("is_complimentary").notNull().default(false),
  complimentaryOfferName: text("complimentary_offer_name"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertLineItemSchema = createInsertSchema(lineItems).omit({
  id: true,
  createdAt: true,
}).extend({
  description: z.string().min(1, "Description is required"),
  quantity: z.number().min(0.5, "Quantity must be at least 0.5"),
  rate: z.number().min(0, "Rate cannot be negative"),
  lengthFt: z.number().min(0, "Length cannot be negative"),
  heightFt: z.number().min(0, "Height cannot be negative"),
  depthFt: z.number().min(0, "Depth cannot be negative"),
  isComplimentary: z.boolean().optional().default(false),
  complimentaryOfferName: z.string().nullable().optional(),
}).refine(
  (data) => !data.isComplimentary || !!data.complimentaryOfferName?.trim(),
  { message: "Offer name is required for a complimentary item", path: ["complimentaryOfferName"] }
);

export type InsertLineItem = z.infer<typeof insertLineItemSchema>;
export type LineItem = typeof lineItems.$inferSelect;

// Catalog Items table - persisted Google Sheets data
export const catalogItems = pgTable("catalog_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetRowId: integer("sheet_row_id"), // Original row number from Google Sheets
  
  // All 13 columns from Google Sheets (A-M)
  projectType: text("project_type"), // Column A - Can be empty
  section: text("section"), // Column B - Can be empty (previously filtered for "Modular" only)
  roomType: text("room_type"), // Column C - Parsed/normalized value
  roomTypeRaw: text("room_type_raw"), // Column C - EXACT cell value from Google Sheets
  unitType: text("unit_type"), // Column D - Parsed/normalized value
  unitTypeRaw: text("unit_type_raw"), // Column D - EXACT cell value from Google Sheets
  panelType: text("panel_type"), // Column E - Can be empty  
  panelTypeRaw: text("panel_type_raw"), // Column E - EXACT cell value from Google Sheets
  categoryName: text("category_name").notNull(), // Column F - Cell value or worksheet name fallback
  categoryNameRaw: text("category_name_raw"), // Column F - EXACT cell value from Google Sheets
  materialType: text("material_type"), // Column G - First parsed value
  materialTypeRaw: text("material_type_raw"), // Column G - EXACT cell value from Google Sheets
  brand: text("brand"), // Column H - First parsed value
  brandRaw: text("brand_raw"), // Column H - EXACT cell value from Google Sheets
  description: text("description"), // Column I - Can be empty
  rate: real("rate").default(0), // Column J - Parsed numeric value (0 if invalid/empty)
  rateRaw: text("rate_raw"), // Column J - EXACT cell value from Google Sheets
  markup: real("markup").default(0), // Column K - Parsed numeric value (0 if invalid/empty)
  markupRaw: text("markup_raw"), // Column K - EXACT cell value from Google Sheets
  margin: real("margin").default(0), // Column L - Parsed numeric value (0 if invalid/empty)
  marginRaw: text("margin_raw"), // Column L - EXACT cell value from Google Sheets
  sellingPrice: real("selling_price").default(0), // Column M - Parsed numeric value (0 if invalid/empty)
  sellingPriceRaw: text("selling_price_raw"), // Column M - EXACT cell value from Google Sheets
  
  // Image URL for product display
  imageUrl: text("image_url"), // URL to product image (hosted externally)
  // Header-driven master data for Furniture and future catalog categories.
  applicableArea: text("applicable_area"),
  productCategory: text("product_category"),
  subCategory: text("sub_category"),
  finishType: text("finish_type"),
  dimension: text("dimension"),
  requiresLength: boolean("requires_length").notNull().default(false),
  requiresHeight: boolean("requires_height").notNull().default(false),
  requiresDepth: boolean("requires_depth").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  
  // Multi-select columns stored as jsonb arrays
  materials: jsonb("materials").$type<string[]>().default([]), // e.g., ["Oak", "Walnut", "Teak"]
  finishes: jsonb("finishes").$type<string[]>().default([]), // e.g., ["Matte", "Glossy"]
  specifications: jsonb("specifications").$type<string[]>().default([]), // Any other multi-select fields
  
  // Item type for GST calculation (derived from category)
  itemType: text("item_type").default("woodworks"), // 'woodworks', 'services', 'accessories', 'furniture'
  
  // Data quality flags
  hasErrors: boolean("has_errors").default(false), // Row had parsing errors
  errorDetails: text("error_details"), // JSON string of errors encountered
  isValid: boolean("is_valid").default(true), // Overall validation status
  
  // ---- Pricing version ownership ----
  // Every catalog row belongs to exactly one pricing version (the mutable Draft or an
  // immutable published version). Nullable until the V1 backfill runs.
  pricingVersionId: varchar("pricing_version_id").references((): any => pricingVersions.id, { onDelete: "cascade" }),

  // Stable cross-version identity, e.g. "XPR-0042". Assigned from the sheet's Item Code
  // column. Two rows in different versions with the same itemCode are the same product.
  itemCode: text("item_code"),

  // Stable numeric Google Sheets tab id this row came from. Unlike the tab title, this
  // survives renames and whitespace differences and is unique even when two tabs share
  // a normalised title.
  sheetTabId: integer("sheet_tab_id"),

  // Historical only. Copying a newer product into an older published version is no
  // longer possible — published versions are frozen, and a product needed by one
  // quotation is recorded in `project_catalog_exceptions` instead. These columns are
  // kept so rows created before that rule still explain themselves.
  isBackported: boolean("is_backported").notNull().default(false),
  backportedFromVersionId: varchar("backported_from_version_id"),
  backportedBy: varchar("backported_by").references((): any => users.id, { onDelete: "set null" }),
  backportedAt: timestamp("backported_at"),

  // Sync metadata
  syncLogId: varchar("sync_log_id").references(() => catalogSyncLogs.id, { onDelete: "set null" }),
  // Present for products created through the Admin "Add New Product" flow. Sheet-synced
  // legacy rows remain null; createdAt records when the row was inserted.
  createdBy: varchar("created_by").references((): any => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("IDX_catalog_items_version").on(table.pricingVersionId),
  index("IDX_catalog_items_version_code").on(table.pricingVersionId, table.itemCode),
]);

// Catalog Sync Logs table - audit trail of sync operations
export const catalogSyncLogs = pgTable("catalog_sync_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Admin who triggered sync
  status: text("status").notNull(), // 'success', 'partial', 'failed'
  
  // Row counts per category (new DeX structure)
  xpressCount: integer("xpress_count").default(0),
  xpandCount: integer("xpand_count").default(0),
  xclusiveCount: integer("xclusive_count").notNull().default(0),
  accessoriesCount: integer("accessories_count").default(0),
  servicesCount: integer("services_count").default(0),
  lightsCount: integer("lights_count").default(0),
  stoneMasterCount: integer("stone_master_count").default(0),
  handlesCount: integer("handles_count").default(0),
  // Legacy counts (kept for backward compatibility during transition)
  economyCount: integer("economy_count").default(0),
  litePremiumCount: integer("lite_premium_count").default(0),
  premiumCount: integer("premium_count").default(0),
  luxuryCount: integer("luxury_count").default(0),
  totalItems: integer("total_items").default(0),
  
  // Error tracking
  errorCount: integer("error_count").default(0),
  warningCount: integer("warning_count").default(0),
  errorSummary: text("error_summary"), // JSON string of errors
  
  // Timing
  durationMs: integer("duration_ms"), // How long sync took
  startedAt: timestamp("started_at").notNull().default(sql`now()`),
  completedAt: timestamp("completed_at"),
});

export const insertCatalogItemSchema = createInsertSchema(catalogItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCatalogSyncLogSchema = createInsertSchema(catalogSyncLogs).omit({
  id: true,
  startedAt: true,
});

export type InsertCatalogItem = z.infer<typeof insertCatalogItemSchema>;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type InsertCatalogSyncLog = z.infer<typeof insertCatalogSyncLogSchema>;
export type CatalogSyncLog = typeof catalogSyncLogs.$inferSelect;

// Legacy catalog cache table (can be removed after migration)
export const catalogCache = pgTable("catalog_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  data: text("data").notNull(), // JSON stringified catalog
  lastFetched: timestamp("last_fetched").notNull().default(sql`now()`),
});

/**
 * Small key/value store for switches an admin can flip from inside the app.
 *
 * Kept deliberately generic and tiny: these are operational choices ("should a sheet sync
 * go live immediately?"), not business data, and they must be changeable without a
 * release.
 */
export const appSettings = pgTable("app_settings", {
  key: varchar("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  updatedBy: varchar("updated_by").references((): any => users.id, { onDelete: "set null" }),
});

export type AppSetting = typeof appSettings.$inferSelect;

// Company Settings table - stores brand information for invoices
export const companySettings = pgTable("company_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appName: text("app_name").notNull().default("Quote Builder"), // Configurable app name shown in header/branding
  companyName: text("company_name").notNull().default("Your Company Name"),
  logoUrl: text("logo_url"), // Path to uploaded logo
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  gstNumber: text("gst_number"), // GST registration number
  panNumber: text("pan_number"), // PAN for business
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  bankIfscCode: text("bank_ifsc_code"),
  termsAndConditions: text("terms_and_conditions"), // Default terms for quotes
  dimensionDisplayUnit: text("dimension_display_unit").notNull().default("feet"), // 'feet' or 'mm' - display unit for customer-facing quotes
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;

// ==================== DESIGN CREDITS SYSTEM ====================

// ---- Business Rule Constants (single source of truth) ----

export const CREDIT_REQUEST_TYPES = {
  project_initiation: { label: "Project Initiation", amount: 1000, maxPerProject: 1 },
  project_topup: { label: "Project Top-up", amount: 500, maxPerProject: 2 },
} as const;

export type CreditRequestType = keyof typeof CREDIT_REQUEST_TYPES;

export const CREDIT_CAPS = {
  designerMaxRequest: 1500,
  adminMaxTotal: 2000,
} as const;

export const MILESTONE_TYPES = {
  site_documentation: { label: "Site Documentation", amount: 150, category: "mandatory" },
  layout_finalisation: { label: "Layout Finalisation", amount: 200, category: "mandatory" },
  design_finalisation: { label: "Design Finalisation", amount: 150, category: "mandatory" },
  validation_gfc: { label: "Validation (GFC Drawings)", amount: 150, category: "mandatory" },
  final_design_signoff: { label: "Final Design Sign-off", amount: 200, category: "mandatory" },
  layout_change: { label: "Layout Change (per room)", amount: 75, category: "additional" },
  design_revision: { label: "Design Revision (per room)", amount: 50, category: "additional" },
} as const;

export type MilestoneType = keyof typeof MILESTONE_TYPES;

export const PAYMENT_TIERS = [
  { maxValue: 1500000, tokenAdvance: 50000 },
  { maxValue: 3000000, tokenAdvance: 100000 },
  { maxValue: Infinity, tokenAdvance: 150000 },
] as const;

export const RETENTION_AMOUNT = 20000;

// ---- Project Credits ----

export const projectCredits = pgTable("project_credits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }).unique(),
  totalCredits: real("total_credits").notNull().default(0),
  usedCredits: real("used_credits").notNull().default(0),
  availableCredits: real("available_credits").notNull().default(0),
  // Wallet fields
  projectWallet: real("project_wallet").notNull().default(0),
  walletFunded: real("wallet_funded").notNull().default(0),
  walletBalance: real("wallet_balance").notNull().default(0),
  creditsShareToken: varchar("credits_share_token").unique(),
  creditsShareExpiresAt: timestamp("credits_share_expires_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertProjectCreditsSchema = createInsertSchema(projectCredits).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProjectCredits = z.infer<typeof insertProjectCreditsSchema>;
export type ProjectCredits = typeof projectCredits.$inferSelect;

// ---- Credit Requests (approval workflow for credit additions) ----
// Flow: pending → approved/rejected

export const creditRequests = pgTable("credit_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  requestType: text("request_type").notNull(), // 'project_initiation' or 'project_topup'
  amount: real("amount").notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'rejected'
  paymentReference: text("payment_reference"),
  rejectionReason: text("rejection_reason"),
  requestedBy: varchar("requested_by").notNull().references(() => users.id, { onDelete: "set null" }),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertCreditRequestSchema = createInsertSchema(creditRequests).omit({
  id: true,
  createdAt: true,
});

export type InsertCreditRequest = z.infer<typeof insertCreditRequestSchema>;
export type CreditRequest = typeof creditRequests.$inferSelect;

// ---- Milestones ----
// Status flow: pending → submitted → approved/rejected

// Admin-managed setup for milestones created after a configuration change.
// Project milestone records retain their own name and credit amount as a historical snapshot.
export const milestoneStages = pgTable("milestone_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  creditAmount: real("credit_amount").notNull(),
  category: text("category").notNull().default("additional"), // 'mandatory' | 'additional'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type MilestoneStage = typeof milestoneStages.$inferSelect;

export const milestones = pgTable("milestones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  roomId: varchar("room_id").references(() => rooms.id, { onDelete: "set null" }),
  milestoneType: text("milestone_type"), // key from milestone_stages (null for legacy free-text milestones)
  name: text("name").notNull(),
  description: text("description"),
  creditAmount: real("credit_amount").notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'submitted', 'approved', 'rejected'
  revisionCount: integer("revision_count").notNull().default(0),
  revisionNotes: text("revision_notes"),
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at"),
  submittedBy: varchar("submitted_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  rejectionReason: text("rejection_reason"),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertMilestoneSchema = createInsertSchema(milestones).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Milestone name is required"),
  creditAmount: z.number().min(0, "Credit amount cannot be negative"),
});

export type InsertMilestone = z.infer<typeof insertMilestoneSchema>;
export type Milestone = typeof milestones.$inferSelect;

// ---- Credit Transactions (audit trail) ----

export const creditTransactions = pgTable("credit_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  milestoneId: varchar("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
  creditRequestId: varchar("credit_request_id").references(() => creditRequests.id, { onDelete: "set null" }),
  type: text("type").notNull(), // 'credit' (addition) or 'debit' (consumption)
  amount: real("amount").notNull(),
  balanceAfter: real("balance_after").notNull(),
  description: text("description").notNull(),
  paymentReference: text("payment_reference"),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({
  id: true,
  createdAt: true,
});

export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;

// ---- Wallet Funding Entries (manual payment tracking) ----

export const walletFundingEntries = pgTable("wallet_funding_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
  description: text("description").notNull(),
  paymentReference: text("payment_reference"),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertWalletFundingEntrySchema = createInsertSchema(walletFundingEntries).omit({
  id: true,
  createdAt: true,
});

export type InsertWalletFundingEntry = z.infer<typeof insertWalletFundingEntrySchema>;
export type WalletFundingEntry = typeof walletFundingEntries.$inferSelect;

// ==================== CATALOG PRICING VERSION ENGINE ====================
//
// Three layers:
//   1. Google Sheet  - the editing surface (unchanged, edited freely by the team)
//   2. Draft         - exactly one always-mutable working copy of the full catalog
//   3. Published     - immutable numbered snapshots, exactly one of which is Active
//
// Core rule: syncing the sheet NEVER creates a version. Only an explicit admin
// "Publish" creates one. Version count therefore equals publish clicks, not edits.

export const PRICING_VERSION_STATUS = {
  draft: "draft",
  active: "active",
  archived: "archived",
} as const;

export type PricingVersionStatus = keyof typeof PRICING_VERSION_STATUS;

export const pricingVersions = pgTable("pricing_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Sequential number. The Draft carries the number it *would* take if published.
  versionNumber: integer("version_number").notNull(),
  name: text("name").notNull(), // e.g. "V2 - FY 2026-27"
  // Recorded label only. Activation is always a manual admin action, never scheduled.
  effectiveDate: timestamp("effective_date"),
  status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'archived'
  itemCount: integer("item_count").notNull().default(0),
  notes: text("notes"),
  // Where this version's contents originally came from, for provenance.
  seededFromVersionId: varchar("seeded_from_version_id"),
  publishedAt: timestamp("published_at"),
  publishedBy: varchar("published_by").references((): any => users.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  // Database-enforced invariants: at most one Draft and at most one Active ever exist.
  // These are the guarantees the whole engine rests on, so they are enforced by the
  // database rather than by application code alone.
  uniqueIndex("UQ_pricing_versions_single_draft")
    .on(table.status)
    .where(sql`status = 'draft'`),
  uniqueIndex("UQ_pricing_versions_single_active")
    .on(table.status)
    .where(sql`status = 'active'`),
  uniqueIndex("UQ_pricing_versions_number").on(table.versionNumber),
]);

export const insertPricingVersionSchema = createInsertSchema(pricingVersions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPricingVersion = z.infer<typeof insertPricingVersionSchema>;
export type PricingVersion = typeof pricingVersions.$inferSelect;

// ---- Catalog sheet tab configuration ----
//
// Tabs are pinned by their stable numeric Google Sheets id, never by title. The live
// spreadsheet contains titles that differ only by whitespace ("DeX - Services " vs
// "DeX - Services") and titles with double spaces, so title matching is ambiguous and
// order-dependent. Storing this as data also means a new product line can be added by
// an admin without a code change.

export const catalogSheetTabs = pgTable("catalog_sheet_tabs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetTabId: integer("sheet_tab_id").notNull().unique(), // stable Google Sheets gid
  tabTitle: text("tab_title").notNull(), // last seen title, refreshed on every sync
  categoryName: text("category_name").notNull(), // normalised category stored on items
  itemCodePrefix: text("item_code_prefix").notNull(), // e.g. "XPR"
  // Which positional column mapping to use when parsing rows from this tab.
  layout: text("layout").notNull(), // 'xpress_xpand' | 'xclusive' | 'services_stone' | 'lights' | 'accessories'
  itemType: text("item_type").notNull().default("woodworks"), // GST treatment
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertCatalogSheetTabSchema = createInsertSchema(catalogSheetTabs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCatalogSheetTab = z.infer<typeof insertCatalogSheetTabSchema>;
export type CatalogSheetTab = typeof catalogSheetTabs.$inferSelect;

// ---- Item code sequences ----
// Monotonic counter per prefix. Never decreases, so a retired code is never reused and
// a new product can never inherit a deleted product's history.

export const itemCodeSequences = pgTable("item_code_sequences", {
  prefix: text("prefix").primaryKey(),
  nextValue: integer("next_value").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type ItemCodeSequence = typeof itemCodeSequences.$inferSelect;

// ---- Pricing version audit trail ----
// Records every consequential admin action so a price quoted months ago is still
// explainable: who changed what, when, and why.

export const pricingVersionAudit = pgTable("pricing_version_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  versionId: varchar("version_id").references((): any => pricingVersions.id, { onDelete: "cascade" }),
  // 'publish' | 'activate' | 'archive' | 'revert' | 'sync_draft'
  // | 'generate_item_codes' | 'sheet_write'
  // | 'project_exception' | 'project_exception_removed'
  // 'amend' and 'backport' appear only on rows written before published versions were
  // frozen; neither action can be performed any more.
  action: text("action").notNull(),
  catalogItemId: varchar("catalog_item_id"),
  itemCode: text("item_code"),
  summary: text("summary").notNull(),
  details: jsonb("details").$type<Record<string, any>>().default({}),
  performedBy: varchar("performed_by").references((): any => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("IDX_pricing_version_audit_version").on(table.versionId),
  index("IDX_pricing_version_audit_created").on(table.createdAt),
]);

export const insertPricingVersionAuditSchema = createInsertSchema(pricingVersionAudit).omit({
  id: true,
  createdAt: true,
});

export type InsertPricingVersionAudit = z.infer<typeof insertPricingVersionAuditSchema>;
export type PricingVersionAudit = typeof pricingVersionAudit.$inferSelect;

// ---- Project catalog exceptions ----
//
// A quotation is pinned to the price list that was live when it was created, so a
// product introduced later is not in its catalog. Occasionally a client on an older
// quotation genuinely wants one of those newer products.
//
// The answer is NOT to edit the older published version: that version is shared by
// every quotation pinned to it, and published versions are immutable by design. Instead
// the extra product is recorded against the ONE project that needs it, priced from the
// version it is copied from. Every other price on that quotation is untouched, and no
// other quotation is affected.

export const projectCatalogExceptions = pgTable("project_catalog_exceptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Stable cross-version product identity, e.g. "ACC-0042".
  itemCode: text("item_code").notNull(),
  // Which version the product is taken from — used for its description and attributes.
  sourceVersionId: varchar("source_version_id").notNull().references((): any => pricingVersions.id, { onDelete: "cascade" }),

  // The price at the moment the product was granted, copied here rather than looked up.
  // The live version's rows can be rewritten in place, so resolving the price from them
  // later would silently move it on this quotation. Nullable only for rows written before
  // this rule existed; those were backfilled with the price they resolved to at the time.
  grantedRate: real("granted_rate"),
  grantedSellingPrice: real("granted_selling_price"),
  reason: text("reason"),
  addedBy: varchar("added_by").references((): any => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("IDX_project_catalog_exceptions_project").on(table.projectId),
  // One product can be granted to a project only once.
  uniqueIndex("UQ_project_catalog_exception").on(table.projectId, table.itemCode),
]);

export const insertProjectCatalogExceptionSchema = createInsertSchema(projectCatalogExceptions).omit({
  id: true,
  createdAt: true,
});

export type InsertProjectCatalogException = z.infer<typeof insertProjectCatalogExceptionSchema>;
export type ProjectCatalogException = typeof projectCatalogExceptions.$inferSelect;
