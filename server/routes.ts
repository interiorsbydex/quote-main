import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { fetchCatalogFromSheets, getCachedCatalog, getMaterialSpecs, clearCache, fetchGQSheet, warmCacheFromDatabase, getCatalogForVersion, getCatalogForProject, clearVersionCatalogCache, clearProjectExceptionCache } from "./google-sheets";
import { syncCatalogToDraft, getSyncLogs, normalizeProductImageUrl } from "./catalog-sync";
import {
  getActiveVersion,
  getDraftVersion,
  getVersion,
  listVersions,
  getAllTabs,
  createProjectWithActiveVersion,
  previewPublish,
  diffVersions,
  publishDraft,
  updateLiveVersion,
  revertToVersion,
  countVersionItems,
  addProjectCatalogException,
  removeProjectCatalogException,
  listProjectCatalogExceptions,
} from "./pricing-versions";
import { isInstantSyncEnabled, setInstantSyncEnabled } from "./app-settings";
import { previewItemCodes, generateItemCodes } from "./item-codes";
import { addNewProduct, getNewProductOptions } from "./new-products";
import { testGQSheet } from "./quotation-comparison";
import { createGQ1Project } from "./create-gq1-project";
import { db, pool } from "./db";
import { catalogItems, catalogSyncLogs, projectCredits, milestones, milestoneStages, creditTransactions, creditRequests, walletFundingEntries, projects, users, offers, projectOffers, crmQuoteCallbacks } from "@shared/schema";
import { insertProjectSchema, insertRoomSchema, insertRoomSubcategorySchema, insertLineItemSchema, insertMilestoneSchema } from "@shared/schema";
import { CREDIT_REQUEST_TYPES, CREDIT_CAPS, MILESTONE_TYPES, PAYMENT_TIERS, RETENTION_AMOUNT } from "@shared/schema";
import { computeQuotationTotals, computePaymentSchedule, computeRoomSubtotalDisplay } from "@shared/calculations";
import type { CreditRequestType } from "@shared/schema";
import { z } from "zod";
import { setupAuth, requireAuth, requireAdmin } from "./auth";
import { eq, desc, like, and, or, sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import multer from "multer";
import puppeteer from "puppeteer";
import { execSync } from "child_process";

// Cache Chromium path at module load to avoid repeated shell calls
let cachedChromiumPath: string | null = null;
function getChromiumPath(): string {
  if (cachedChromiumPath) return cachedChromiumPath;
  
  try {
    cachedChromiumPath = execSync('which chromium').toString().trim();
  } catch {
    // Fallback paths for different environments
    const fallbackPaths = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      process.env.PUPPETEER_EXECUTABLE_PATH
    ].filter(Boolean) as string[];
    
    for (const p of fallbackPaths) {
      if (fs.existsSync(p)) {
        cachedChromiumPath = p;
        break;
      }
    }
  }
  
  if (!cachedChromiumPath) {
    throw new Error('Chromium not found. Please install chromium system package.');
  }
  
  console.log("Chromium path cached:", cachedChromiumPath);
  return cachedChromiumPath;
}


// Configure multer for logo uploads with security restrictions
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `logo-${Date.now()}${ext}`;
    cb(null, filename);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB max file size
  },
  fileFilter: (_req, file, cb) => {
    // Only allow raster image formats (no SVG to prevent script injection)
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'));
    }
  }
});

const ASSIGNMENT_ROLES = new Set(["tl", "bl", "dm"]);
const USER_ROLES = new Set(["super_admin", "admin", "user", "tl", "bl", "dm"]);
const TL_COHORTS = new Set(["PD", "DTL"]);
const offerInputSchema = z.object({
  name: z.string().trim().min(1, "Offer name is required").max(160),
  offerType: z.enum(["percentage", "cash"]),
  percentageValue: z.number().min(0).max(100).nullable().optional(),
  cashValue: z.number().min(0).nullable().optional(),
  minWoodworkValue: z.number().min(0).default(0),
  maxWoodworkValue: z.number().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
}).superRefine((offer, ctx) => {
  if (offer.offerType === "percentage" && !(offer.percentageValue && offer.percentageValue > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["percentageValue"], message: "Enter a percentage greater than zero" });
  }
  if (offer.offerType === "cash" && !(offer.cashValue && offer.cashValue > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cashValue"], message: "Enter a cash amount greater than zero" });
  }
  if (offer.maxWoodworkValue !== null && offer.maxWoodworkValue !== undefined && offer.maxWoodworkValue < offer.minWoodworkValue) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxWoodworkValue"], message: "Maximum woodwork value must be at least the minimum" });
  }
});

async function getProjectsVisibleToUser(userId: string, role: string) {
  if (role === "super_admin" || role === "admin") return storage.getAllProjects();
  if (ASSIGNMENT_ROLES.has(role)) {
    return storage.getProjectsAssignedToRole(userId, role as "tl" | "bl" | "dm");
  }
  return storage.getProjectsByUser(userId);
}

async function getOfferContext(projectId: string) {
  const project = await storage.getProject(projectId);
  if (!project) return null;

  const lineItems = await storage.getLineItemsByProject(projectId);
  // Eligibility deliberately uses the full Woodwork value before GST or any
  // existing project discount, as requested for offer thresholds.
  const woodworkValue = computeQuotationTotals(lineItems, project.markup || 0, project.discount || 0).woodworksSubtotal;
  const [activeOffers, selectedOffers] = await Promise.all([
    db.select().from(offers).where(eq(offers.isActive, true)).orderBy(desc(offers.createdAt)),
    db.select().from(projectOffers).where(eq(projectOffers.projectId, projectId)),
  ]);

  const isEligible = (offer: {
    minWoodworkValue: number;
    maxWoodworkValue: number | null;
  }) => woodworkValue >= offer.minWoodworkValue &&
    (offer.maxWoodworkValue === null || woodworkValue <= offer.maxWoodworkValue);

  const selectedByOfferId = new Map(selectedOffers.map((offer) => [offer.offerId, offer]));
  const visibleOffers = activeOffers.map((offer) => {
    const selected = selectedByOfferId.get(offer.id);
    return {
      id: selected?.id || offer.id,
      offerId: offer.id,
      offerName: selected?.offerName || offer.name,
      productCategory: selected?.productCategory || offer.productCategory,
      offerType: selected?.offerType || offer.offerType,
      percentageValue: selected?.percentageValue ?? offer.percentageValue,
      cashValue: selected?.cashValue ?? offer.cashValue,
      minWoodworkValue: selected?.minWoodworkValue ?? offer.minWoodworkValue,
      maxWoodworkValue: selected?.maxWoodworkValue ?? offer.maxWoodworkValue,
      isActive: offer.isActive,
      isApplied: !!selected,
      isLocked: selected?.isLocked || false,
      isStillEligible: isEligible(selected || offer),
    };
  });

  // A previously selected inactive offer must remain visible in a draft so the
  // designer can remove it; it is not offered to newly eligible projects.
  for (const selected of selectedOffers) {
    if (activeOffers.some((offer) => offer.id === selected.offerId)) continue;
    visibleOffers.push({
      id: selected.id,
      offerId: selected.offerId,
      offerName: selected.offerName,
      productCategory: selected.productCategory,
      offerType: selected.offerType,
      percentageValue: selected.percentageValue,
      cashValue: selected.cashValue,
      minWoodworkValue: selected.minWoodworkValue,
      maxWoodworkValue: selected.maxWoodworkValue,
      isActive: false,
      isApplied: true,
      isLocked: selected.isLocked,
      isStillEligible: isEligible(selected),
    });
  }

  return { project, woodworkValue, offers: visibleOffers, selectedOffers, isEligible };
}

const CRM_CALLBACK_PATH = "/api/quotes/callback";
const CRM_CALLBACK_TIMEOUT_MS = 10_000;

function callbackErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown CRM callback error";
  return message.slice(0, 1000);
}

/**
 * Sends the CRM notification for a generated, CRM-linked quotation. Delivery state is
 * persisted before and after the request so a failed notification can be retried and a
 * delivered one is never sent again.
 */
async function deliverCrmQuoteCallback(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project?.leadId) return null;

  let [delivery] = await db
    .select()
    .from(crmQuoteCallbacks)
    .where(eq(crmQuoteCallbacks.projectId, projectId))
    .limit(1);

  if (!delivery) {
    await db.insert(crmQuoteCallbacks).values({ projectId }).onConflictDoNothing();
    [delivery] = await db
      .select()
      .from(crmQuoteCallbacks)
      .where(eq(crmQuoteCallbacks.projectId, projectId))
      .limit(1);
  }
  if (!delivery || delivery.status === "delivered") return delivery ?? null;

  const [attempt] = await db
    .update(crmQuoteCallbacks)
    .set({
      status: "pending",
      attempts: sql`${crmQuoteCallbacks.attempts} + 1`,
      lastAttemptAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(crmQuoteCallbacks.projectId, projectId))
    .returning();

  const crmBaseUrl = process.env.CRM_PRODUCTION_BASE_URL?.replace(/\/+$/, "");
  const callbackSecret = process.env.CRM_CALLBACK_SECRET;
  if (!crmBaseUrl || !callbackSecret) {
    const [failed] = await db
      .update(crmQuoteCallbacks)
      .set({
        status: "failed",
        lastError: "CRM callback configuration is incomplete.",
        updatedAt: new Date(),
      })
      .where(eq(crmQuoteCallbacks.projectId, projectId))
      .returning();
    return failed;
  }

  try {
    const [lineItems, appliedOffers] = await Promise.all([
      storage.getLineItemsByProject(projectId),
      db.select().from(projectOffers).where(eq(projectOffers.projectId, projectId)),
    ]);
    const totals = computeQuotationTotals(lineItems, project.markup || 0, project.discount || 0, appliedOffers);
    const discountPct = totals.grandTotal > 0
      ? ((totals.grandTotal - totals.finalPayable) / totals.grandTotal) * 100
      : 0;
    const response = await fetch(`${crmBaseUrl}${CRM_CALLBACK_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-quote-builder-secret": callbackSecret,
      },
      body: JSON.stringify({
        leadId: project.leadId,
        amount: totals.finalPayable,
        discountPct,
        quoteRef: project.id,
      }),
      signal: AbortSignal.timeout(CRM_CALLBACK_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`CRM callback returned HTTP ${response.status}`);

    const [delivered] = await db
      .update(crmQuoteCallbacks)
      .set({
        status: "delivered",
        deliveredAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(crmQuoteCallbacks.projectId, projectId))
      .returning();
    return delivered;
  } catch (error) {
    const [failed] = await db
      .update(crmQuoteCallbacks)
      .set({
        status: "failed",
        lastError: callbackErrorMessage(error),
        updatedAt: new Date(),
      })
      .where(eq(crmQuoteCallbacks.projectId, projectId))
      .returning();
    console.error(`CRM callback failed for project ${projectId}:`, callbackErrorMessage(error));
    return failed;
  }
}

async function ensureMilestoneStages() {
  await db.insert(milestoneStages).values(
    Object.entries(MILESTONE_TYPES).map(([key, stage]) => ({
      key,
      name: stage.label,
      creditAmount: stage.amount,
      category: stage.category,
    })),
  ).onConflictDoNothing({ target: milestoneStages.key });
}

// Authorization helper: Check if a project belongs to the current user based on role hierarchy.
// Regular representatives are assigned through projects.userId and must never be able
// to open another representative's quotation by guessing its project ID.
async function canAccessProject(
  userId: string,
  role: string,
  projectId: string
): Promise<boolean> {
  const project = await storage.getProject(projectId);
  if (!project) return false;
  
  // Super admin and admin can access all projects
  if (role === "super_admin" || role === "admin") return true;
  
  if (role === "tl") return project.tlId === userId;
  if (role === "bl") return project.blId === userId;
  if (role === "dm") return project.dmId === userId;

  // Regular representatives/users can only access their own projects.
  return project.userId === userId;
}

// Authorization helper: Check if user can access a room (via its parent project)
async function canAccessRoom(
  userId: string,
  role: string,
  roomId: string
): Promise<boolean> {
  const room = await storage.getRoom(roomId);
  if (!room) return false;
  return canAccessProject(userId, role, room.projectId);
}

// Authorization helper: Check if user can access a line item (via its parent room/project)
async function canAccessLineItem(
  userId: string,
  role: string,
  lineItemId: string
): Promise<boolean> {
  const lineItem = await storage.getLineItem(lineItemId);
  if (!lineItem) return false;
  return canAccessProject(userId, role, lineItem.projectId);
}

// Helper: Check if a project is finalized (prevents modifications)
async function isProjectFinalized(projectId: string): Promise<boolean> {
  const project = await storage.getProject(projectId);
  return project?.status === "Generated";
}

// Helper: Check if a room's project is finalized
async function isRoomProjectFinalized(roomId: string): Promise<boolean> {
  const room = await storage.getRoom(roomId);
  if (!room) return false;
  return isProjectFinalized(room.projectId);
}

// Helper: Check if a line item's project is finalized
async function isLineItemProjectFinalized(lineItemId: string): Promise<boolean> {
  const lineItem = await storage.getLineItem(lineItemId);
  if (!lineItem) return false;
  return isProjectFinalized(lineItem.projectId);
}

// Authorization helper: Check if user can access a room sub-category (via its parent room/project)
async function canAccessRoomSubcategory(
  userId: string,
  role: string,
  subcategoryId: string
): Promise<boolean> {
  const subcategory = await storage.getRoomSubcategory(subcategoryId);
  if (!subcategory) return false;
  return canAccessRoom(userId, role, subcategory.roomId);
}

// Helper: Check if a room sub-category's project is finalized
async function isRoomSubcategoryProjectFinalized(subcategoryId: string): Promise<boolean> {
  const subcategory = await storage.getRoomSubcategory(subcategoryId);
  if (!subcategory) return false;
  return isRoomProjectFinalized(subcategory.roomId);
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication
  setupAuth(app);
  
  // Get Google Sheets spreadsheet ID from environment
  const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || "";

  /**
   * Decides which pricing version a catalog request should be answered from.
   *
   * With the review workflow ON, a project prices against the version stamped on it when
   * it was created, so reopening an old quotation offers exactly the catalog it was built
   * from.
   *
   * With the review workflow OFF — the switch the team runs on today — there is
   * effectively one catalog, the live one, and every project reads it. That is how the
   * app behaved before pricing versions existed, and it is what stops a newly added
   * product from being invisible to the projects that happen to be stamped with an
   * older version. It changes only what can be *added* from now on: a line item stores
   * its own rate and amount when it is saved, so nothing already quoted moves.
   */
  const resolveCatalogVersionId = async (projectId?: string): Promise<string | null> => {
    // Read the switch fresh rather than from its short cache. The app runs in more than
    // one process, and each caches the switch separately: a stale value here would have
    // one worker serving a project its own old price list while another serves the live
    // one, for the same quotation, seconds apart.
    const honourProjectStamp = !(await isInstantSyncEnabled({ fresh: true }));

    if (projectId && honourProjectStamp) {
      const [project] = await db
        .select({ pricingVersionId: projects.pricingVersionId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (project?.pricingVersionId) return project.pricingVersionId;
    }
    const active = await getActiveVersion();
    return active?.id ?? null;
  };

  // ==================== AUTH ROUTES ====================
  
  // Get current user - handled by auth.ts
  // The /api/auth/user endpoint is now defined in auth.ts

  // ==================== CATALOG ROUTES ====================
  
  // Get catalog data (filtered or full)
  app.get("/api/catalog", requireAuth, async (req: Request, res: Response) => {
    try {
      const { category, roomType, unitType, projectId } = req.query;

      // A quotation's catalog is not public data. It carries this client's prices, and
      // it may carry products granted to this quotation alone, so asking for it by
      // project id has to prove the caller is entitled to that project — otherwise
      // guessing an id would reveal another client's extras.
      if (projectId) {
        const hasAccess = await canAccessProject(
          req.session.userId!,
          req.session.role || "user",
          projectId as string
        );
        if (!hasAccess) {
          return res.status(403).json({ error: "You do not have access to this quotation." });
        }
      }

      // Which prices this request sees is decided entirely on the server. A project
      // always prices against the version it was created with, so an open quotation
      // keeps its prices even after the catalog is republished.
      const versionId = await resolveCatalogVersionId(projectId as string | undefined);
      if (!versionId) {
        return res.status(503).json({
          error: "The price catalog is not available yet. Please contact an administrator.",
        });
      }

      let catalog = await getCatalogForProject(versionId, projectId as string | undefined);

      // Apply filters
      let filtered = catalog || [];
      if (category) {
        filtered = filtered.filter(item => item.categoryName === category);
      }
      if (roomType) {
        // Include items matching the room type OR items with empty/undefined room type (works for any room)
        filtered = filtered.filter(item => {
          const itemRoomType = item.roomType?.trim() || '';
          return itemRoomType === roomType || itemRoomType === '';
        });
      }
      if (unitType) {
        // Support comma-separated unit types - check if the selected unitType is in the list
        filtered = filtered.filter(item => {
          if (!item.unitType) return false;
          const itemUnitTypes = item.unitType.split(',').map(t => t.trim().toLowerCase());
          return itemUnitTypes.includes(String(unitType).toLowerCase());
        });
      }

      res.json(filtered);
    } catch (error: any) {
      console.error("Error fetching catalog:", error);
      res.status(500).json({ error: error.message || "Failed to fetch catalog" });
    }
  });

  // Get material specs for a category
  app.get("/api/catalog/material-specs/:category", async (req: Request, res: Response) => {
    try {
      const { category } = req.params;
      
      let catalog = getCachedCatalog();
      if (!catalog || catalog.length === 0) {
        await warmCacheFromDatabase();
        catalog = getCachedCatalog();
      }
      if (!catalog || catalog.length === 0) {
        await fetchCatalogFromSheets(SPREADSHEET_ID);
      }

      const specs = getMaterialSpecs(category);
      res.json(specs);
    } catch (error: any) {
      console.error("Error fetching material specs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch material specs" });
    }
  });

  /**
   * Sync the Google Sheet into the Draft.
   *
   * What happens next depends on the instant-sync switch.
   *
   * ON (how the app worked before pricing versions existed): the freshly synced Draft is
   * applied straight onto the live price list, so an admin hits refresh and everyone sees
   * the new prices — no second step. The team is on this setting while they are not yet
   * using the review workflow.
   *
   * OFF: the sync only fills the Draft. An admin then reviews it and chooses to update the
   * live list in place or release it as a new version.
   *
   * Either way, prices already saved on a quotation never move.
   */
  app.post("/api/catalog/refresh", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const tabGids: number[] | undefined = Array.isArray(req.body?.tabGids)
        ? req.body.tabGids.map(Number).filter((n: number) => Number.isFinite(n))
        : undefined;

      const result = await syncCatalogToDraft(SPREADSHEET_ID, { userId, tabGids });

      // Read past the cache: an admin who has just turned the review step back on must
      // not have this sync push prices live because another process cached "on".
      const instantSync = await isInstantSyncEnabled({ fresh: true });
      let appliedLive = false;
      let liveMessage = "";
      let liveError: string | null = null;

      // A sync that hit errors read the sheet incompletely. Those rows are in the Draft
      // where an admin can inspect them, but they must not go straight to everyone.
      const safeToApply = instantSync && result.success;

      if (safeToApply) {
        try {
          // Same path an admin would take by hand, so the same safety checks, the same
          // shrink protection and the same audit trail apply. expectDraft makes it refuse
          // if a competing sync or publish rewrote the Draft since this one committed.
          const applied = await updateLiveVersion({
            performedBy: userId,
            notes: "Applied automatically after a sheet sync",
            expectDraft: { id: result.draftVersionId, updatedAt: result.draftUpdatedAt },
          });
          appliedLive = true;
          liveMessage =
            `${applied.added} item(s) added, ${applied.changed} catalog item(s) changed` +
            (applied.removed > 0 ? `, ${applied.removed} removed` : "") + ".";
          clearCache();
          await warmCacheFromDatabase();
        } catch (error: any) {
          // The sheet did land in the Draft; only the going-live step failed. Say so
          // plainly rather than reporting the whole sync as a success.
          liveError = error.message || "The prices could not be made live.";
          console.error("Instant sync could not apply the draft to the live version:", error);
        }
      }

      const baseMessage = result.success
        ? `Sheet read successfully (${result.totalItems} items).`
        : `Sheet read with ${result.errorCount} error(s).`;

      const message = liveError
        ? `${baseMessage} The prices were NOT made live: ${liveError}`
        : appliedLive
          ? `${baseMessage} Prices are live now — ${liveMessage} Existing quotations keep their saved prices.`
          : instantSync && !result.success
            ? `${baseMessage} Because of those errors the prices were NOT made live — the rows are in the Draft. Check them, then apply the Draft or sync again.`
            : `${baseMessage} Live prices are unchanged until you apply the Draft.`;

      res.json({
        success: result.success && !liveError,
        draftVersionId: result.draftVersionId,
        totalItems: result.totalItems,
        draftTotalItems: result.draftTotalItems,
        syncedTabs: result.syncedTabs,
        errorCount: result.errorCount,
        warningCount: result.warningCount,
        durationMs: result.durationMs,
        instantSync,
        appliedLive,
        liveError,
        message,
        errors: result.errors.slice(0, 10),
      });
    } catch (error: any) {
      console.error("Error syncing catalog to draft:", error);
      res.status(500).json({ error: error.message || "Failed to sync catalog" });
    }
  });

  /**
   * The instant-sync switch.
   *
   * Readable by any signed-in user so the pricing screen can explain which mode the team
   * is in; only an admin can change it.
   */
  app.get("/api/admin/settings/instant-sync", requireAuth, async (_req: Request, res: Response) => {
    try {
      res.json({ enabled: await isInstantSyncEnabled() });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to read the setting" });
    }
  });

  app.put("/api/admin/settings/instant-sync", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { enabled } = req.body || {};
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "Say whether instant sync should be on or off." });
      }

      await setInstantSyncEnabled(enabled, req.session.userId!);

      res.json({
        enabled,
        message: enabled
          ? "Syncing the sheet will now put prices live immediately, with no review step."
          : "Syncing the sheet will now fill the Draft for review. You decide when prices go live.",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to change the setting" });
    }
  });

  // ==========================================================================
  // Pricing versions
  // ==========================================================================

  /** Which version the current viewer is pricing against — drives the UI badge. */
  app.get("/api/pricing-version", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      if (projectId) {
        const hasAccess = await canAccessProject(req.session.userId!, req.session.role || "user", projectId);
        if (!hasAccess) return res.status(403).json({ error: "Access denied to this project" });
      }
      const versionId = await resolveCatalogVersionId(projectId);
      if (!versionId) return res.json({ version: null });

      const version = await getVersion(versionId);
      const active = await getActiveVersion();
      if (!version) return res.json({ version: null });

      res.json({
        version: {
          id: version.id,
          name: version.name,
          versionNumber: version.versionNumber,
          status: version.status,
        },
        isLatest: !!active && active.id === version.id,
        latestName: active?.name ?? null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load pricing version" });
    }
  });

  app.get("/api/admin/pricing-versions", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const versions = await listVersions();
      const withUsage = await Promise.all(
        versions.map(async (v) => {
          const [{ n }] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(projects)
            .where(eq(projects.pricingVersionId, v.id));
          return { ...v, projectCount: n ?? 0, actualItemCount: await countVersionItems(v.id) };
        })
      );
      res.json(withUsage);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to list pricing versions" });
    }
  });

  /** The change preview an admin reviews before publishing. */
  app.get("/api/admin/pricing-versions/preview", requireAuth, requireAdmin, async (_req, res: Response) => {
    try {
      res.json(await previewPublish());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to build preview" });
    }
  });

  app.get("/api/admin/pricing-versions/diff", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: "Both 'from' and 'to' versions are required." });
      res.json(await diffVersions(String(from), String(to)));
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to compare versions" });
    }
  });

  app.post("/api/admin/pricing-versions/publish", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      // No effective date is accepted. A version goes live the moment it is published;
      // offering a date field would imply scheduling that does not exist.
      const { name, notes } = req.body || {};
      const published = await publishDraft({
        name,
        notes: notes ?? null,
        performedBy: req.session.userId!,
      });
      // Every cached catalog is now suspect: the live version changed and a fresh
      // Draft was seeded.
      clearCache();
      await warmCacheFromDatabase();
      res.json({
        success: true,
        version: published,
        message: `${published.name} is now live. New projects will use it; existing quotations are unchanged.`,
      });
    } catch (error: any) {
      console.error("Error publishing pricing version:", error);
      res.status(400).json({ error: error.message || "Failed to publish" });
    }
  });

  /**
   * Applies the Draft onto the live version without creating a new one, so projects
   * already running on it can use newly added items straight away.
   */
  app.post("/api/admin/pricing-versions/update-live", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { notes } = req.body || {};
      const result = await updateLiveVersion({
        notes: notes ?? null,
        performedBy: req.session.userId!,
      });
      // The live version's rows were rewritten under the same id, so anything cached
      // against that id is now wrong — including per-project extras resolved from it.
      clearCache();
      await warmCacheFromDatabase();
      res.json({
        success: true,
        version: result.version,
        message:
          `${result.version.name} updated: ${result.added} item(s) added, ${result.changed} price(s) changed` +
          `${result.removed ? `, ${result.removed} removed` : ""}. ` +
          `Every project on ${result.version.name} can use these now. Existing quotations keep their saved prices.`,
      });
    } catch (error: any) {
      console.error("Error updating live pricing version:", error);
      res.status(400).json({ error: error.message || "Failed to update the live price list" });
    }
  });

  app.post("/api/admin/pricing-versions/:id/revert", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const version = await revertToVersion(req.params.id, req.session.userId!);
      clearCache();
      await warmCacheFromDatabase();
      res.json({
        success: true,
        version,
        message: `${version.name} is live again. Existing projects keep the version they were created with.`,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to revert" });
    }
  });

  /**
   * Read-only view of the prices inside one version.
   *
   * The point of a published version is that its prices can be looked up later exactly
   * as they were quoted, so this endpoint never writes.
   */
  app.get("/api/admin/pricing-versions/:id/items", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const version = await getVersion(req.params.id);
      if (!version) return res.status(404).json({ error: "That price list does not exist." });

      const search = String(req.query.search ?? "").trim();
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const like = `%${search.toLowerCase()}%`;

      const where = search
        ? sql`pricing_version_id = ${req.params.id} AND (
              lower(coalesce(item_code, '')) LIKE ${like}
              OR lower(coalesce(description, '')) LIKE ${like}
              OR lower(coalesce(category_name, '')) LIKE ${like}
              OR lower(coalesce(brand, '')) LIKE ${like}
            )`
        : sql`pricing_version_id = ${req.params.id}`;

      const rows: any = await db.execute(sql`
        SELECT item_code, category_name, room_type, unit_type, material_type, brand,
               description, rate, markup, selling_price
        FROM catalog_items
        WHERE ${where}
        ORDER BY category_name NULLS LAST, item_code NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `);
      const totalRes: any = await db.execute(sql`SELECT count(*)::int AS n FROM catalog_items WHERE ${where}`);
      const total = ((totalRes.rows ?? totalRes)[0]?.n as number) ?? 0;

      res.json({
        version: { id: version.id, name: version.name, status: version.status },
        total,
        limit,
        offset,
        items: (rows.rows ?? rows).map((r: any) => ({
          itemCode: r.item_code,
          categoryName: r.category_name,
          roomType: r.room_type,
          unitType: r.unit_type,
          materialType: r.material_type,
          brand: r.brand,
          description: r.description,
          rate: r.rate,
          markup: r.markup,
          sellingPrice: r.selling_price,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load the price list" });
    }
  });

  /**
   * What is sitting in the Draft right now, and how it got there.
   *
   * The Draft accumulates between publishes, so whoever presses Publish may not be the
   * person who synced. This shows which tabs were last pulled in, by whom and when, so
   * a publish is never a surprise.
   */
  app.get("/api/admin/pricing-versions/draft-status", requireAuth, requireAdmin, async (_req, res: Response) => {
    try {
      const draft = await getDraftVersion();
      if (!draft) return res.json({ draft: null, tabs: [], lastSync: null });

      const tabRows: any = await db.execute(sql`
        SELECT t.sheet_tab_id,
               t.tab_title,
               t.category_name,
               t.enabled,
               count(ci.id)::int AS item_count,
               max(sl.completed_at) AS last_synced_at,
               max(u.username) AS last_synced_by
        FROM catalog_sheet_tabs t
        LEFT JOIN catalog_items ci
          ON ci.pricing_version_id = ${draft.id} AND ci.sheet_tab_id = t.sheet_tab_id
        LEFT JOIN catalog_sync_logs sl ON sl.id = ci.sync_log_id
        LEFT JOIN users u ON u.id = sl.user_id
        WHERE t.enabled = true
        GROUP BY t.sheet_tab_id, t.tab_title, t.category_name, t.enabled
        ORDER BY t.category_name
      `);

      const lastSyncRows: any = await db.execute(sql`
        SELECT sl.id, sl.started_at, sl.completed_at, sl.status, sl.total_items,
               sl.error_count, sl.warning_count, u.username AS synced_by
        FROM catalog_sync_logs sl
        LEFT JOIN users u ON u.id = sl.user_id
        ORDER BY sl.started_at DESC
        LIMIT 1
      `);
      const lastSync = (lastSyncRows.rows ?? lastSyncRows)[0] ?? null;

      res.json({
        draft: { id: draft.id, name: draft.name, itemCount: await countVersionItems(draft.id), updatedAt: draft.updatedAt },
        tabs: (tabRows.rows ?? tabRows).map((r: any) => ({
          sheetTabId: r.sheet_tab_id,
          tabTitle: r.tab_title,
          categoryName: r.category_name,
          itemCount: r.item_count ?? 0,
          lastSyncedAt: r.last_synced_at,
          lastSyncedBy: r.last_synced_by,
        })),
        lastSync: lastSync && {
          startedAt: lastSync.started_at,
          completedAt: lastSync.completed_at,
          status: lastSync.status,
          totalItems: lastSync.total_items,
          errorCount: lastSync.error_count,
          warningCount: lastSync.warning_count,
          syncedBy: lastSync.synced_by,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load draft status" });
    }
  });

  // ------------------------------------------------- per-project catalog extras

  app.get("/api/projects/:projectId/catalog-exceptions", requireAuth, async (req: Request, res: Response) => {
    try {
      const hasAccess = await canAccessProject(req.session.userId!, req.session.role || "user", req.params.projectId);
      if (!hasAccess) return res.status(403).json({ error: "Access denied to this project" });
      res.json(await listProjectCatalogExceptions(req.params.projectId));
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load the added products" });
    }
  });

  app.post("/api/projects/:projectId/catalog-exceptions", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { itemCode, sourceVersionId, reason } = req.body || {};
      if (!itemCode) return res.status(400).json({ error: "An item code is required." });

      const result = await addProjectCatalogException({
        projectId: req.params.projectId,
        itemCode: String(itemCode),
        sourceVersionId: sourceVersionId ? String(sourceVersionId) : undefined,
        reason: reason ?? null,
        performedBy: req.session.userId!,
      });
      clearProjectExceptionCache(req.params.projectId);

      res.json({
        success: true,
        ...result,
        message: `${result.itemCode} can now be added to this quotation. No price list was changed and no other quotation was affected.`,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to add the product to this quotation" });
    }
  });

  app.delete("/api/projects/:projectId/catalog-exceptions/:itemCode", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      await removeProjectCatalogException(req.params.projectId, req.params.itemCode, req.session.userId!);
      clearProjectExceptionCache(req.params.projectId);
      res.json({
        success: true,
        message: `${req.params.itemCode} is no longer offered on this quotation. Lines already saved keep the price they were quoted at.`,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to remove the product" });
    }
  });

  app.get("/api/admin/pricing-versions/audit", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const rows = await db.execute(sql`
        SELECT a.*, u.username AS performed_by_name
        FROM pricing_version_audit a
        LEFT JOIN users u ON u.id = a.performed_by
        ORDER BY a.created_at DESC
        LIMIT ${limit}
      `);
      res.json((rows as any).rows ?? rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load audit trail" });
    }
  });

  app.get("/api/admin/new-products/options", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await getNewProductOptions(SPREADSHEET_ID));
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load product options" });
    }
  });

  app.post("/api/admin/new-products", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await addNewProduct(SPREADSHEET_ID, {
        sheetTabId: Number(req.body?.sheetTabId),
        itemCode: req.body?.itemCode,
        cells: req.body?.cells || {},
        destinations: req.body?.destinations || [],
        performedBy: req.session.userId!,
      });
      clearCache();
      clearVersionCatalogCache();
      await warmCacheFromDatabase();
      res.status(201).json({
        success: true,
        ...result,
        message: `${result.itemCode} was added only to the ${result.destinations.length} selected version(s).`,
      });
    } catch (error: any) {
      console.error("Error adding catalog product:", error);
      res.status(400).json({ error: error.message || "Failed to add the product" });
    }
  });

  // ---------------------------------------------------------------- sheet tabs

  app.get("/api/admin/sheet-tabs", requireAuth, requireAdmin, async (_req, res: Response) => {
    try {
      res.json(await getAllTabs());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load sheet tabs" });
    }
  });

  // ---------------------------------------------------------------- item codes

  app.get("/api/admin/item-codes/preview", requireAuth, requireAdmin, async (_req, res: Response) => {
    try {
      const preview = await previewItemCodes(SPREADSHEET_ID);
      // The full assignment list can run to thousands of rows; the UI only needs the
      // per-tab summary plus a sample.
      res.json({
        totalToAssign: preview.totalToAssign,
        totalAlreadyCoded: preview.totalAlreadyCoded,
        totalDataRows: preview.totalDataRows,
        tabs: preview.tabs.map((t) => ({
          sheetTabId: t.sheetTabId,
          tabTitle: t.tabTitle,
          prefix: t.prefix,
          headerPresent: t.headerPresent,
          dataRows: t.dataRows,
          alreadyCoded: t.alreadyCoded,
          toAssign: t.toAssign,
          duplicateCodes: t.duplicateCodes,
          malformedCodes: t.malformedCodes.slice(0, 20),
          sample: t.assignments.slice(0, 5),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to preview item codes" });
    }
  });

  app.post("/api/admin/item-codes/generate", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await generateItemCodes(SPREADSHEET_ID, req.session.userId!);
      res.json({
        success: true,
        ...result,
        message: `Wrote ${result.codesWritten} item codes into the sheet. Only the Item Code column was touched.`,
      });
    } catch (error: any) {
      console.error("Error generating item codes:", error);
      res.status(500).json({ error: error.message || "Failed to write item codes" });
    }
  });

  // Get catalog items from database (admin only)
  app.get("/api/admin/catalog", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { category, roomType, search, limit = '100', offset = '0' } = req.query;
      
      // Build filters array
      const filters = [];
      if (category) {
        filters.push(eq(catalogItems.categoryName, category as string));
      }
      if (roomType) {
        filters.push(eq(catalogItems.roomType, roomType as string));
      }
      if (search && typeof search === 'string') {
        filters.push(
          or(
            like(catalogItems.description, `%${search}%`),
            like(catalogItems.materialType, `%${search}%`),
            like(catalogItems.brand, `%${search}%`)
          )
        );
      }
      
      // Build query with or without filters
      const baseQuery = db.select().from(catalogItems);
      const items = filters.length > 0
        ? await baseQuery
            .where(and(...filters))
            .limit(parseInt(limit as string))
            .offset(parseInt(offset as string))
            .orderBy(catalogItems.categoryName, catalogItems.sheetRowId)
        : await baseQuery
            .limit(parseInt(limit as string))
            .offset(parseInt(offset as string))
            .orderBy(catalogItems.categoryName, catalogItems.sheetRowId);
      
      // Get total count
      const countQuery = filters.length > 0
        ? await db.select({ count: sql<number>`count(*)` }).from(catalogItems).where(and(...filters))
        : await db.select({ count: sql<number>`count(*)` }).from(catalogItems);
      
      const total = countQuery[0]?.count || 0;
      
      res.json({
        items,
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      });
    } catch (error: any) {
      console.error("Error fetching catalog items:", error);
      res.status(500).json({ error: error.message || "Failed to fetch catalog items" });
    }
  });

  // Get sync logs (admin only)
  app.get("/api/admin/catalog/sync-logs", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { limit = '10' } = req.query;
      const logs = await db.select()
        .from(catalogSyncLogs)
        .orderBy(desc(catalogSyncLogs.startedAt))
        .limit(parseInt(limit as string));
      
      res.json(logs);
    } catch (error: any) {
      console.error("Error fetching sync logs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sync logs" });
    }
  });

  // ==================== CLIENT ROUTES ====================

  // Get all clients for current user
  app.get("/api/clients", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const clients = await storage.getClientsByUser(userId);
      res.json(clients);
    } catch (error: any) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ error: error.message || "Failed to fetch clients" });
    }
  });

  // Get single client
  app.get("/api/clients/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const client = await storage.getClient(req.params.id);
      
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      
      if (client.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      res.json(client);
    } catch (error: any) {
      console.error("Error fetching client:", error);
      res.status(500).json({ error: error.message || "Failed to fetch client" });
    }
  });

  // Create client
  app.post("/api/clients", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { name, email, phone, address, city, state, pincode, notes } = req.body;
      
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Client name is required" });
      }
      
      const client = await storage.createClient({
        userId,
        name: name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        pincode: pincode?.trim() || null,
        notes: notes?.trim() || null,
      });
      
      res.status(201).json(client);
    } catch (error: any) {
      console.error("Error creating client:", error);
      res.status(500).json({ error: error.message || "Failed to create client" });
    }
  });

  // Update client
  app.patch("/api/clients/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const existingClient = await storage.getClient(req.params.id);
      
      if (!existingClient) {
        return res.status(404).json({ error: "Client not found" });
      }
      
      if (existingClient.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const client = await storage.updateClient(req.params.id, req.body);
      res.json(client);
    } catch (error: any) {
      console.error("Error updating client:", error);
      res.status(500).json({ error: error.message || "Failed to update client" });
    }
  });

  // Delete client
  app.delete("/api/clients/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const existingClient = await storage.getClient(req.params.id);
      
      if (!existingClient) {
        return res.status(404).json({ error: "Client not found" });
      }
      
      if (existingClient.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      await storage.deleteClient(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting client:", error);
      res.status(500).json({ error: error.message || "Failed to delete client" });
    }
  });

  // ==================== PROJECT ROUTES ====================
  
  // Get all projects for current user based on role hierarchy
  // super_admin: sees all projects
  // admin: sees all projects; TL/BL/DM: only projects assigned to that role; user: own projects
  app.get("/api/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const projectsList = await getProjectsVisibleToUser(userId, role);
      
      res.json(projectsList);
    } catch (error: any) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ error: error.message || "Failed to fetch projects" });
    }
  });

  // People who created or are assigned to the projects visible to this user.
  // This powers the dashboard's "Created by" filter without exposing the admin user directory.
  app.get("/api/projects/people", requireAuth, async (req: Request, res: Response) => {
    try {
      const visibleProjects = await getProjectsVisibleToUser(req.session.userId!, req.session.role || "user");
      const relatedUserIds = new Set(
        visibleProjects.flatMap((project) => [project.userId, project.tlId, project.blId, project.dmId].filter(Boolean))
      );
      const allUsers = await storage.getAllUsers();
      res.json(
        allUsers
          .filter((user) => relatedUserIds.has(user.id))
          .map(({ id, username, firstName, lastName, role, cohort }) => ({ id, username, firstName, lastName, role, cohort }))
      );
    } catch (error: any) {
      console.error("Error fetching project people:", error);
      res.status(500).json({ error: error.message || "Failed to fetch project people" });
    }
  });

  // Get single project (with authorization check)
  app.get("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(project);
    } catch (error: any) {
      console.error("Error fetching project:", error);
      res.status(500).json({ error: error.message || "Failed to fetch project" });
    }
  });

  // Create project
  app.post("/api/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { clientId, tlId: _tlId, blId: _blId, dmId: _dmId, ...restBody } = req.body;
      const normalizedPid = typeof restBody.pid === "string" ? restBody.pid.trim() : "";

      if (!normalizedPid) {
        return res.status(400).json({ error: "Project ID (PID) is required" });
      }

      let clientName = typeof restBody.clientName === "string" ? restBody.clientName.trim() : "";
      
      // If clientId is provided, verify ownership
      if (clientId) {
        const client = await storage.getClient(clientId);
        if (!client) {
          return res.status(400).json({ error: "Client not found" });
        }
        if (client.userId !== userId) {
          return res.status(403).json({ error: "Access denied to this client" });
        }
        clientName = client.name;
      }
      
      const validated = insertProjectSchema.parse({
        ...restBody,
        pid: normalizedPid,
        clientName,
        userId: userId,
        clientId: clientId || null,
        // CRM links may omit projectType. Residential is the initial default, while the
        // creation dialog still lets the representative change it before saving.
        projectType: restBody.projectType || "Residential",
      });

      // The pricing version is stamped by the server, never accepted from the client:
      // it is deliberately absent from insertProjectSchema so it cannot be spoofed.
      // Every project is pinned to the version that was live when it was created.
      let project;
      try {
        project = await createProjectWithActiveVersion(validated);
      } catch (e: any) {
        if (e.message === "NO_ACTIVE_PRICING_VERSION") {
          return res.status(503).json({
            error: "No pricing version is live, so new projects cannot be created yet. Please contact an administrator.",
          });
        }
        throw e;
      }
      
      // Auto-create credits record for every new project (mandatory credits)
      await db.insert(projectCredits).values({
        projectId: project.id,
        totalCredits: 0,
        usedCredits: 0,
        availableCredits: 0,
      }).onConflictDoNothing();
      
      res.status(201).json(project);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Error creating project:", error);
      res.status(500).json({ error: error.message || "Failed to create project" });
    }
  });

  // Update project (with authorization check)
  app.patch("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }

      // A project's pricing version is fixed for life: it is what guarantees an already
      // quoted client keeps their prices. Silently drop any attempt to move a project
      // onto a different price list, whether malicious or accidental.
      const { pricingVersionId, id, userId: _ignoredUserId, createdAt, tlId, blId, dmId, ...safeUpdates } = req.body || {};
      const requestedAssignments = { tlId, blId, dmId };
      const isChangingAssignments = Object.values(requestedAssignments).some((value) => value !== undefined);
      if (isChangingAssignments) {
        if (role !== "admin" && role !== "super_admin") {
          return res.status(403).json({ error: "Only administrators can change TL, BL, or DM assignments" });
        }
        const allUsers = await storage.getAllUsers();
        for (const [field, expectedRole] of [["tlId", "tl"], ["blId", "bl"], ["dmId", "dm"]] as const) {
          const assignment = requestedAssignments[field];
          if (assignment === undefined) continue;
          if (assignment !== null && typeof assignment !== "string") {
            return res.status(400).json({ error: `${field} must be a user ID or N/A` });
          }
          if (assignment) {
            const assignee = allUsers.find((user) => user.id === assignment);
            if (!assignee || assignee.role !== expectedRole) {
              return res.status(400).json({ error: `Select a valid ${expectedRole.toUpperCase()} user` });
            }
          }
          safeUpdates[field] = assignment || null;
        }
      }
      if ("pid" in safeUpdates) {
        const normalizedPid = typeof safeUpdates.pid === "string" ? safeUpdates.pid.trim() : "";
        if (!normalizedPid) {
          return res.status(400).json({ error: "Project ID (PID) is required" });
        }
        safeUpdates.pid = normalizedPid;
      }

      const project = await storage.updateProject(req.params.id, safeUpdates);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(project);
    } catch (error: any) {
      console.error("Error updating project:", error);
      res.status(500).json({ error: error.message || "Failed to update project" });
    }
  });

  // Delete project (with authorization check)
  app.delete("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      await storage.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: error.message || "Failed to delete project" });
    }
  });

  // Finalize project (change status from Draft to Generated)
  app.patch("/api/projects/:id/finalize", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      if (project.status === "Generated") {
        return res.status(400).json({ error: "Project is already finalized" });
      }
      
      // Validate project has at least one line item
      const lineItems = await storage.getLineItemsByProject(req.params.id);
      if (lineItems.length === 0) {
        return res.status(400).json({ error: "Cannot finalize a quote with no line items" });
      }
      
        const offerContext = await getOfferContext(req.params.id);
        const noLongerEligible = offerContext?.selectedOffers.filter((offer) => !offerContext.isEligible(offer)) || [];
        if (noLongerEligible.length > 0) {
          return res.status(400).json({
            error: `Remove offers that are no longer eligible before finalizing: ${noLongerEligible.map((offer) => offer.offerName).join(", ")}`,
          });
        }

        // Applied offers stay editable through the entire draft lifecycle. Lock
        // their snapshots only in the same transition that generates the quote.
        const updatedProject = await db.transaction(async (tx) => {
          if (offerContext?.selectedOffers.length) {
            await tx.update(projectOffers)
              .set({ isLocked: true, lockedAt: new Date() })
              .where(eq(projectOffers.projectId, req.params.id));
          }
          const [finalized] = await tx.update(projects)
            .set({ status: "Generated", updatedAt: new Date() })
            .where(eq(projects.id, req.params.id))
            .returning();
          if (finalized.leadId) {
            await tx.insert(crmQuoteCallbacks)
              .values({ projectId: finalized.id })
              .onConflictDoNothing();
          }
          return finalized;
        });
      // A CRM outage must not undo a successfully finalized quotation. The delivery
      // record retains any error and can be retried through the protected endpoint.
      if (updatedProject.leadId) await deliverCrmQuoteCallback(updatedProject.id);
      res.json(updatedProject);
    } catch (error: any) {
      console.error("Error finalizing project:", error);
      res.status(500).json({ error: error.message || "Failed to finalize project" });
    }
  });

  app.get("/api/projects/:id/crm-callback", requireAuth, async (req: Request, res: Response) => {
    try {
      const hasAccess = await canAccessProject(req.session.userId!, req.session.role || "user", req.params.id);
      if (!hasAccess) return res.status(403).json({ error: "Access denied to this project" });

      const [delivery] = await db
        .select()
        .from(crmQuoteCallbacks)
        .where(eq(crmQuoteCallbacks.projectId, req.params.id))
        .limit(1);
      res.json(delivery ?? null);
    } catch (error: any) {
      console.error("Error fetching CRM callback status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch CRM callback status" });
    }
  });

  app.post("/api/projects/:id/crm-callback/retry", requireAuth, async (req: Request, res: Response) => {
    try {
      const hasAccess = await canAccessProject(req.session.userId!, req.session.role || "user", req.params.id);
      if (!hasAccess) return res.status(403).json({ error: "Access denied to this project" });

      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (project.status !== "Generated") {
        return res.status(400).json({ error: "Generate the quotation before retrying its CRM callback" });
      }
      if (!project.leadId) return res.status(400).json({ error: "This quotation is not linked to a CRM lead" });

      const delivery = await deliverCrmQuoteCallback(project.id);
      res.json(delivery);
    } catch (error: any) {
      console.error("Error retrying CRM callback:", error);
      res.status(500).json({ error: error.message || "Failed to retry CRM callback" });
    }
  });

  // ==================== OFFER ENGINE ====================

  app.get("/api/admin/offers", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await db.select().from(offers).orderBy(desc(offers.createdAt)));
    } catch (error: any) {
      console.error("Error fetching offers:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offers" });
    }
  });

  app.post("/api/admin/offers", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const data = offerInputSchema.parse(req.body);
      const [offer] = await db.insert(offers).values({
        ...data,
        productCategory: "Offer Product",
        percentageValue: data.offerType === "percentage" ? data.percentageValue : null,
        cashValue: data.offerType === "cash" ? data.cashValue : null,
      }).returning();
      res.status(201).json(offer);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Validation error", details: error.errors });
      console.error("Error creating offer:", error);
      res.status(500).json({ error: error.message || "Failed to create offer" });
    }
  });

  app.patch("/api/admin/offers/:offerId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const data = offerInputSchema.parse(req.body);
      const [offer] = await db.update(offers)
        .set({
          ...data,
          percentageValue: data.offerType === "percentage" ? data.percentageValue : null,
          cashValue: data.offerType === "cash" ? data.cashValue : null,
          updatedAt: new Date(),
        })
        .where(eq(offers.id, req.params.offerId))
        .returning();
      if (!offer) return res.status(404).json({ error: "Offer not found" });
      res.json(offer);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Validation error", details: error.errors });
      console.error("Error updating offer:", error);
      res.status(500).json({ error: error.message || "Failed to update offer" });
    }
  });

  app.get("/api/projects/:projectId/offers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      if (!await canAccessProject(userId, role, req.params.projectId)) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      const context = await getOfferContext(req.params.projectId);
      if (!context) return res.status(404).json({ error: "Project not found" });
      res.json({ woodworkValue: context.woodworkValue, offers: context.offers });
    } catch (error: any) {
      console.error("Error fetching project offers:", error);
      res.status(500).json({ error: error.message || "Failed to fetch project offers" });
    }
  });

  app.patch("/api/projects/:projectId/offers/:offerId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      const { applied } = z.object({ applied: z.boolean() }).parse(req.body);
      if (!await canAccessProject(userId, role, req.params.projectId)) {
        return res.status(403).json({ error: "Access denied to this project" });
      }

      const context = await getOfferContext(req.params.projectId);
      if (!context) return res.status(404).json({ error: "Project not found" });
      if (context.project.status === "Generated") {
        return res.status(403).json({ error: "Offers on a generated quotation are locked" });
      }

      const existing = context.selectedOffers.find((offer) => offer.offerId === req.params.offerId);
      if (!applied) {
        if (existing?.isLocked) return res.status(403).json({ error: "This offer is locked" });
        await db.delete(projectOffers).where(and(
          eq(projectOffers.projectId, req.params.projectId),
          eq(projectOffers.offerId, req.params.offerId),
        ));
        return res.json({ applied: false });
      }

      const eligibleOffer = context.offers.find((offer) => offer.offerId === req.params.offerId && offer.isActive && offer.isStillEligible);
      if (!eligibleOffer) {
        return res.status(400).json({ error: "This offer is not currently eligible for the project's Woodwork value" });
      }
      const [saved] = await db.insert(projectOffers).values({
        projectId: req.params.projectId,
        offerId: eligibleOffer.offerId,
        offerName: eligibleOffer.offerName,
        productCategory: eligibleOffer.productCategory,
        offerType: eligibleOffer.offerType,
        percentageValue: eligibleOffer.percentageValue,
        cashValue: eligibleOffer.cashValue,
        minWoodworkValue: eligibleOffer.minWoodworkValue,
        maxWoodworkValue: eligibleOffer.maxWoodworkValue,
      }).onConflictDoUpdate({
        target: [projectOffers.projectId, projectOffers.offerId],
        set: {
          offerName: eligibleOffer.offerName,
          productCategory: eligibleOffer.productCategory,
          offerType: eligibleOffer.offerType,
          percentageValue: eligibleOffer.percentageValue,
          cashValue: eligibleOffer.cashValue,
          minWoodworkValue: eligibleOffer.minWoodworkValue,
          maxWoodworkValue: eligibleOffer.maxWoodworkValue,
          isLocked: false,
          lockedAt: null,
        },
      }).returning();
      res.json(saved);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Validation error", details: error.errors });
      console.error("Error applying project offer:", error);
      res.status(500).json({ error: error.message || "Failed to apply offer" });
    }
  });

  // ==================== CREDITS ROUTES ====================
  
  // Get credit balance for a project
  app.get("/api/projects/:projectId/credits", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      const [credits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, req.params.projectId));
      
      // Return default values if no credits record exists
      if (!credits) {
        return res.json({
          projectId: req.params.projectId,
          totalCredits: 0,
          usedCredits: 0,
          availableCredits: 0,
        });
      }
      
      res.json(credits);
    } catch (error: any) {
      console.error("Error fetching project credits:", error);
      res.status(500).json({ error: error.message || "Failed to fetch project credits" });
    }
  });
  
  // ==================== CREDIT REQUEST ROUTES ====================

  // Create a credit request (any authenticated user with project access)
  const createCreditRequestSchema = z.object({
    requestType: z.enum(["project_initiation", "project_topup"]),
    paymentReference: z.string().optional(),
  });

  app.post("/api/projects/:projectId/credit-requests", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      const { projectId } = req.params;

      const hasAccess = await canAccessProject(userId, role, projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const validation = createCreditRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const { requestType, paymentReference } = validation.data;
      const requestConfig = CREDIT_REQUEST_TYPES[requestType];
      const amount = requestConfig.amount;

      // Get current credits and existing requests for cap enforcement
      const [credits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));
      const currentTotal = credits?.totalCredits || 0;

      // Count approved + pending requests of this type
      const existingRequests = await db.select().from(creditRequests)
        .where(and(
          eq(creditRequests.projectId, projectId),
          eq(creditRequests.requestType, requestType),
          or(eq(creditRequests.status, 'approved'), eq(creditRequests.status, 'pending'))
        ));

      // Check maxPerProject limit for this request type
      if (existingRequests.length >= requestConfig.maxPerProject) {
        return res.status(400).json({
          error: `Maximum ${requestConfig.maxPerProject} ${requestConfig.label} request(s) allowed per project. Already have ${existingRequests.length}.`
        });
      }

      // Enforce role-based caps: count ALL approved+pending credits for this project
      const allPendingAndApproved = await db.select().from(creditRequests)
        .where(and(
          eq(creditRequests.projectId, projectId),
          or(eq(creditRequests.status, 'approved'), eq(creditRequests.status, 'pending'))
        ));
      const totalRequestedAmount = allPendingAndApproved.reduce((sum, r) => sum + r.amount, 0);

      if (role === 'user') {
        if (totalRequestedAmount + amount > CREDIT_CAPS.designerMaxRequest) {
          return res.status(400).json({
            error: `Designer credit cap exceeded. Maximum ${CREDIT_CAPS.designerMaxRequest} credits per project. Currently: ${totalRequestedAmount} requested/approved, trying to add ${amount}.`
          });
        }
      }

      // Admin cap check (applies to all roles)
      if (totalRequestedAmount + amount > CREDIT_CAPS.adminMaxTotal) {
        return res.status(400).json({
          error: `Project credit cap exceeded. Maximum ${CREDIT_CAPS.adminMaxTotal} credits per project. Currently: ${totalRequestedAmount} requested/approved, trying to add ${amount}.`
        });
      }

      const [newRequest] = await db.insert(creditRequests).values({
        projectId,
        requestType,
        amount,
        status: 'pending',
        paymentReference: paymentReference || null,
        requestedBy: userId,
      }).returning();

      res.status(201).json(newRequest);
    } catch (error: any) {
      console.error("Error creating credit request:", error);
      res.status(500).json({ error: error.message || "Failed to create credit request" });
    }
  });

  // Get credit requests for a project
  app.get("/api/projects/:projectId/credit-requests", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";

      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }

      const requests = await db.select().from(creditRequests)
        .where(eq(creditRequests.projectId, req.params.projectId))
        .orderBy(desc(creditRequests.createdAt));

      res.json(requests);
    } catch (error: any) {
      console.error("Error fetching credit requests:", error);
      res.status(500).json({ error: error.message || "Failed to fetch credit requests" });
    }
  });

  // Get all pending credit requests (admin only)
  app.get("/api/credit-requests/pending", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const pendingRequests = await db.select().from(creditRequests)
        .where(eq(creditRequests.status, 'pending'))
        .orderBy(desc(creditRequests.createdAt));

      res.json(pendingRequests);
    } catch (error: any) {
      console.error("Error fetching pending credit requests:", error);
      res.status(500).json({ error: error.message || "Failed to fetch pending credit requests" });
    }
  });

  // Approve a credit request (admin only) - uses DB transaction
  app.post("/api/credit-requests/:id/approve", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      const userId = req.session.userId!;

      await client.query('BEGIN');

      // Lock the credit request
      const requestResult = await client.query(
        'SELECT * FROM credit_requests WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      const creditRequest = requestResult.rows[0];
      if (!creditRequest) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: "Credit request not found" });
      }

      if (creditRequest.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "Only pending credit requests can be approved" });
      }

      const amount = creditRequest.amount;
      const projectId = creditRequest.project_id;

      // Re-check admin cap with lock
      const creditsResult = await client.query(
        'SELECT * FROM project_credits WHERE project_id = $1 FOR UPDATE',
        [projectId]
      );

      let currentTotal = 0;
      if (creditsResult.rows.length > 0) {
        currentTotal = creditsResult.rows[0].total_credits;
      }

      if (currentTotal + amount > CREDIT_CAPS.adminMaxTotal) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Approving would exceed project credit cap of ${CREDIT_CAPS.adminMaxTotal}. Current total: ${currentTotal}, request: ${amount}.`
        });
      }

      // Update or create project credits
      if (creditsResult.rows.length > 0) {
        const newTotal = currentTotal + amount;
        const newAvailable = creditsResult.rows[0].available_credits + amount;
        await client.query(
          'UPDATE project_credits SET total_credits = $1, available_credits = $2, updated_at = NOW() WHERE project_id = $3',
          [newTotal, newAvailable, projectId]
        );

        // Record credit transaction
        await client.query(
          'INSERT INTO credit_transactions (id, project_id, credit_request_id, type, amount, balance_after, description, created_by, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())',
          [projectId, creditRequest.id, 'credit', amount, newAvailable,
           `${CREDIT_REQUEST_TYPES[creditRequest.request_type as CreditRequestType]?.label || creditRequest.request_type} approved`, userId]
        );
      } else {
        await client.query(
          'INSERT INTO project_credits (id, project_id, total_credits, used_credits, available_credits, project_wallet, wallet_funded, wallet_balance, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 0, $2, 0, 0, 0, NOW(), NOW())',
          [projectId, amount]
        );

        await client.query(
          'INSERT INTO credit_transactions (id, project_id, credit_request_id, type, amount, balance_after, description, created_by, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())',
          [projectId, creditRequest.id, 'credit', amount, amount,
           `${CREDIT_REQUEST_TYPES[creditRequest.request_type as CreditRequestType]?.label || creditRequest.request_type} approved`, userId]
        );
      }

      // Update request status
      await client.query(
        'UPDATE credit_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3',
        ['approved', userId, req.params.id]
      );

      await client.query('COMMIT');

      // Fetch updated data
      const [updatedCredits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));
      res.json(updatedCredits);
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error("Error approving credit request:", error);
      res.status(500).json({ error: error.message || "Failed to approve credit request" });
    } finally {
      client.release();
    }
  });

  // Reject a credit request (admin only)
  app.post("/api/credit-requests/:id/reject", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { reason } = req.body;

      if (!reason || typeof reason !== 'string') {
        return res.status(400).json({ error: "Rejection reason is required" });
      }

      const [creditRequest] = await db.select().from(creditRequests).where(eq(creditRequests.id, req.params.id));
      if (!creditRequest) {
        return res.status(404).json({ error: "Credit request not found" });
      }

      if (creditRequest.status !== 'pending') {
        return res.status(400).json({ error: "Only pending credit requests can be rejected" });
      }

      const [updated] = await db.update(creditRequests)
        .set({
          status: 'rejected',
          rejectionReason: reason,
          reviewedBy: userId,
          reviewedAt: new Date(),
        })
        .where(eq(creditRequests.id, req.params.id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error rejecting credit request:", error);
      res.status(500).json({ error: error.message || "Failed to reject credit request" });
    }
  });

  // Legacy: Add credits directly (admin only) - kept for backward compat but now goes through request flow
  const addCreditsSchema = z.object({
    amount: z.number().positive("Amount must be positive"),
    description: z.string().min(1, "Description is required"),
    paymentReference: z.string().optional(),
  });

  app.post("/api/projects/:projectId/credits", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { projectId } = req.params;

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const validation = addCreditsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const { amount, description, paymentReference } = validation.data;

      // Enforce admin cap
      const [credits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));
      const currentTotal = credits?.totalCredits || 0;

      if (currentTotal + amount > CREDIT_CAPS.adminMaxTotal) {
        return res.status(400).json({
          error: `Cannot exceed project credit cap of ${CREDIT_CAPS.adminMaxTotal} credits. Current: ${currentTotal}, adding: ${amount}.`
        });
      }

      if (!credits) {
        const [newCredits] = await db.insert(projectCredits).values({
          projectId,
          totalCredits: amount,
          usedCredits: 0,
          availableCredits: amount,
        }).returning();

        await db.insert(creditTransactions).values({
          projectId,
          type: 'credit',
          amount,
          balanceAfter: amount,
          description,
          paymentReference,
          createdBy: userId,
        });

        return res.json(newCredits);
      }

      const newTotal = credits.totalCredits + amount;
      const newAvailable = credits.availableCredits + amount;
      const [updatedCredits] = await db.update(projectCredits)
        .set({
          totalCredits: newTotal,
          availableCredits: newAvailable,
          updatedAt: new Date(),
        })
        .where(eq(projectCredits.projectId, projectId))
        .returning();

      await db.insert(creditTransactions).values({
        projectId,
        type: 'credit',
        amount,
        balanceAfter: newAvailable,
        description,
        paymentReference,
        createdBy: userId,
      });

      res.json(updatedCredits);
    } catch (error: any) {
      console.error("Error adding credits:", error);
      res.status(500).json({ error: error.message || "Failed to add credits" });
    }
  });
  
  // Get credit transaction history for a project
  app.get("/api/projects/:projectId/credits/transactions", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      const transactions = await db.select()
        .from(creditTransactions)
        .where(eq(creditTransactions.projectId, req.params.projectId))
        .orderBy(desc(creditTransactions.createdAt));
      
      res.json(transactions);
    } catch (error: any) {
      console.error("Error fetching credit transactions:", error);
      res.status(500).json({ error: error.message || "Failed to fetch credit transactions" });
    }
  });

  // ==================== CREDITS SHARE ROUTES ====================

  // Generate or regenerate credits share token for a project (admin only)
  app.post("/api/projects/:projectId/credits/share", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const creditsShareToken = crypto.randomBytes(32).toString('hex');
      const creditsShareExpiresAt = new Date();
      creditsShareExpiresAt.setDate(creditsShareExpiresAt.getDate() + 30);

      let [credits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));

      if (!credits) {
        const [newCredits] = await db.insert(projectCredits).values({
          projectId,
          totalCredits: 0,
          usedCredits: 0,
          availableCredits: 0,
          creditsShareToken,
          creditsShareExpiresAt,
        }).returning();
        credits = newCredits;
      } else {
        const [updatedCredits] = await db.update(projectCredits)
          .set({
            creditsShareToken,
            creditsShareExpiresAt,
            updatedAt: new Date(),
          })
          .where(eq(projectCredits.projectId, projectId))
          .returning();
        credits = updatedCredits;
      }

      res.json({
        creditsShareToken: credits.creditsShareToken,
        creditsShareExpiresAt: credits.creditsShareExpiresAt,
        shareUrl: `/client/credits/${credits.creditsShareToken}`,
      });
    } catch (error: any) {
      console.error("Error generating credits share token:", error);
      res.status(500).json({ error: error.message || "Failed to generate credits share token" });
    }
  });

  // Revoke credits share token (admin only)
  app.delete("/api/projects/:projectId/credits/share", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const [credits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));
      if (!credits) {
        return res.status(404).json({ error: "Credits record not found" });
      }

      await db.update(projectCredits)
        .set({
          creditsShareToken: null,
          creditsShareExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(projectCredits.projectId, projectId));

      res.json({ message: "Credits share link revoked" });
    } catch (error: any) {
      console.error("Error revoking credits share token:", error);
      res.status(500).json({ error: error.message || "Failed to revoke credits share token" });
    }
  });

  // Get credits share status for a project (admin only)
  app.get("/api/projects/:projectId/credits/share", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;

      const [credits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));

      res.json({
        creditsShareToken: credits?.creditsShareToken || null,
        creditsShareExpiresAt: credits?.creditsShareExpiresAt || null,
        shareUrl: credits?.creditsShareToken ? `/client/credits/${credits.creditsShareToken}` : null,
      });
    } catch (error: any) {
      console.error("Error fetching credits share status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch credits share status" });
    }
  });

  // Public endpoint: Get credits data by share token (no auth required)
  app.get("/api/shared/credits/:shareToken", async (req: Request, res: Response) => {
    try {
      const { shareToken } = req.params;

      const [credits] = await db.select().from(projectCredits).where(eq(projectCredits.creditsShareToken, shareToken));

      if (!credits) {
        return res.status(404).json({ error: "Credits portal not found" });
      }

      if (credits.creditsShareExpiresAt && new Date() > new Date(credits.creditsShareExpiresAt)) {
        return res.status(410).json({ error: "This credits link has expired" });
      }

      const project = await storage.getProject(credits.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const projectMilestones = await db.select().from(milestones)
        .where(eq(milestones.projectId, credits.projectId))
        .orderBy(desc(milestones.createdAt));

      const transactions = await db.select().from(creditTransactions)
        .where(eq(creditTransactions.projectId, credits.projectId))
        .orderBy(desc(creditTransactions.createdAt));

      const companySettingsData = await storage.getCompanySettings();

      const [portalLineItems, appliedOffers] = await Promise.all([
        storage.getLineItemsByProject(credits.projectId),
        db.select().from(projectOffers).where(eq(projectOffers.projectId, credits.projectId)),
      ]);
      const portalTotals = computeQuotationTotals(
        portalLineItems,
        project.markup || 0,
        project.discount || 0,
        appliedOffers,
      );
      const paymentSchedule = computePaymentSchedule(portalTotals.finalPayable);

      res.json({
        clientName: project.clientName,
        projectType: project.projectType,
        pid: project.pid,
        credits: {
          totalCredits: credits.totalCredits,
          usedCredits: credits.usedCredits,
          availableCredits: credits.availableCredits,
        },
        wallet: {
          projectWallet: credits.projectWallet,
          walletFunded: credits.walletFunded,
          walletBalance: credits.walletBalance,
        },
        paymentSchedule,
        milestones: projectMilestones.map(m => ({
          name: m.name,
          milestoneType: m.milestoneType,
          creditAmount: m.creditAmount,
          status: m.status,
          description: m.description,
          createdAt: m.createdAt,
          submittedAt: m.submittedAt,
          reviewedAt: m.reviewedAt,
        })),
        transactions: transactions.map(t => ({
          type: t.type,
          amount: t.amount,
          balanceAfter: t.balanceAfter,
          description: t.description,
          createdAt: t.createdAt,
        })),
        company: companySettingsData ? {
          appName: companySettingsData.appName,
          companyName: companySettingsData.companyName,
          logoUrl: companySettingsData.logoUrl,
          phone: companySettingsData.phone,
          email: companySettingsData.email,
          website: companySettingsData.website,
        } : null,
      });
    } catch (error: any) {
      console.error("Error fetching shared credits:", error);
      res.status(500).json({ error: error.message || "Failed to fetch credits data" });
    }
  });

  // ==================== MILESTONE ROUTES ====================

  const milestoneStageInputSchema = z.object({
    name: z.string().trim().min(1, "Stage name is required").max(160),
    creditAmount: z.number().min(0, "Credit amount cannot be negative"),
  });

  // Readable by authenticated designers so the Create Milestone menu always uses
  // Admin-managed current configuration.
  app.get("/api/milestone-stages", requireAuth, async (_req: Request, res: Response) => {
    try {
      await ensureMilestoneStages();
      res.json(await db.select().from(milestoneStages).orderBy(milestoneStages.createdAt));
    } catch (error: any) {
      console.error("Error fetching milestone stages:", error);
      res.status(500).json({ error: error.message || "Failed to fetch milestone stages" });
    }
  });

  app.get("/api/admin/milestone-stages", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      await ensureMilestoneStages();
      res.json(await db.select().from(milestoneStages).orderBy(milestoneStages.createdAt));
    } catch (error: any) {
      console.error("Error fetching milestone stage configuration:", error);
      res.status(500).json({ error: error.message || "Failed to fetch milestone stage configuration" });
    }
  });

  app.post("/api/admin/milestone-stages", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const data = milestoneStageInputSchema.parse(req.body);
      const [stage] = await db.insert(milestoneStages).values({
        key: `custom_${crypto.randomUUID().replace(/-/g, "")}`,
        name: data.name,
        creditAmount: data.creditAmount,
        category: "additional",
      }).returning();
      res.status(201).json(stage);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
      console.error("Error creating milestone stage:", error);
      res.status(500).json({ error: error.message || "Failed to create milestone stage" });
    }
  });

  app.patch("/api/admin/milestone-stages/:stageId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const data = milestoneStageInputSchema.parse(req.body);
      const [stage] = await db.update(milestoneStages)
        .set({ name: data.name, creditAmount: data.creditAmount, updatedAt: new Date() })
        .where(eq(milestoneStages.id, req.params.stageId))
        .returning();
      if (!stage) return res.status(404).json({ error: "Milestone stage not found" });
      res.json(stage);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
      console.error("Error updating milestone stage:", error);
      res.status(500).json({ error: error.message || "Failed to update milestone stage" });
    }
  });
  
  // Get milestones for a project
  app.get("/api/projects/:projectId/milestones", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      const projectMilestones = await db.select()
        .from(milestones)
        .where(eq(milestones.projectId, req.params.projectId))
        .orderBy(desc(milestones.createdAt));
      
      res.json(projectMilestones);
    } catch (error: any) {
      console.error("Error fetching milestones:", error);
      res.status(500).json({ error: error.message || "Failed to fetch milestones" });
    }
  });
  
  // Create a new milestone (type-based with auto-amounts)
  const createMilestoneSchema = z.object({
    milestoneType: z.string().min(1, "Milestone type is required"),
    roomId: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
  });

  app.post("/api/projects/:projectId/milestones", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      const { projectId } = req.params;

      const hasAccess = await canAccessProject(userId, role, projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }

      const validation = createMilestoneSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const { milestoneType, roomId, description } = validation.data;

      await ensureMilestoneStages();
      const [milestoneConfig] = await db.select().from(milestoneStages)
        .where(eq(milestoneStages.key, milestoneType));
      if (!milestoneConfig) {
        return res.status(400).json({ error: `Invalid milestone type: ${milestoneType}` });
      }

      const creditAmount = milestoneConfig.creditAmount;
      const name = milestoneConfig.name;

      // For mandatory milestones, block duplicates (approved or pending/submitted)
      if (milestoneConfig.category === 'mandatory') {
        const existingMandatory = await db.select().from(milestones)
          .where(and(
            eq(milestones.projectId, projectId),
            eq(milestones.milestoneType, milestoneType),
            or(
              eq(milestones.status, 'approved'),
              eq(milestones.status, 'pending'),
              eq(milestones.status, 'submitted')
            )
          ));

        if (existingMandatory.length > 0) {
          return res.status(400).json({
            error: `Mandatory milestone "${name}" already exists for this project (status: ${existingMandatory[0].status}). Each mandatory milestone can only be created once.`
          });
        }
      }

      // Check available credits
      const [projectCredit] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));
      const availableCredits = projectCredit?.availableCredits || 0;
      if (creditAmount > availableCredits) {
        return res.status(400).json({
          error: `Milestone requires ${creditAmount} credits but only ${availableCredits} credits available.`
        });
      }

      const [newMilestone] = await db.insert(milestones).values({
        projectId,
        milestoneType,
        name,
        creditAmount,
        roomId: roomId || null,
        description: description || null,
        createdBy: userId,
      }).returning();

      res.status(201).json(newMilestone);
    } catch (error: any) {
      console.error("Error creating milestone:", error);
      res.status(500).json({ error: error.message || "Failed to create milestone" });
    }
  });
  
  // Submit milestone for approval (designer marks as complete)
  app.post("/api/milestones/:id/submit", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const [milestone] = await db.select().from(milestones).where(eq(milestones.id, req.params.id));
      if (!milestone) {
        return res.status(404).json({ error: "Milestone not found" });
      }
      
      const hasAccess = await canAccessProject(userId, role, milestone.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this milestone" });
      }
      
      if (milestone.status !== 'pending' && milestone.status !== 'rejected') {
        return res.status(400).json({ error: "Only pending or rejected milestones can be submitted" });
      }
      
      const [updated] = await db.update(milestones)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          submittedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(milestones.id, req.params.id))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error submitting milestone:", error);
      res.status(500).json({ error: error.message || "Failed to submit milestone" });
    }
  });
  
  // Approve milestone (admin/manager only) - deducts credits
  // Wrapped in a database transaction to prevent double-spending race conditions
  app.post("/api/milestones/:id/approve", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      const userId = req.session.userId!;
      
      await client.query('BEGIN');
      
      // Lock the milestone row with SELECT FOR UPDATE to prevent concurrent approvals
      const milestoneResult = await client.query(
        'SELECT * FROM milestones WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      const milestone = milestoneResult.rows[0];
      if (!milestone) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: "Milestone not found" });
      }
      
      if (milestone.status !== 'submitted') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "Only submitted milestones can be approved" });
      }
      
      // Lock and check project credits
      const creditsResult = await client.query(
        'SELECT * FROM project_credits WHERE project_id = $1 FOR UPDATE',
        [milestone.project_id]
      );
      const credits = creditsResult.rows[0];
      if (!credits || credits.available_credits < milestone.credit_amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "Insufficient credits for this milestone" });
      }
      
      // Deduct credits
      const newUsed = credits.used_credits + milestone.credit_amount;
      const newAvailable = credits.available_credits - milestone.credit_amount;
      
      await client.query(
        'UPDATE project_credits SET used_credits = $1, available_credits = $2, updated_at = NOW() WHERE project_id = $3',
        [newUsed, newAvailable, milestone.project_id]
      );
      
      // Record the debit transaction
      await client.query(
        'INSERT INTO credit_transactions (id, project_id, milestone_id, type, amount, balance_after, description, created_by, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())',
        [milestone.project_id, milestone.id, 'debit', milestone.credit_amount, newAvailable, `Milestone completed: ${milestone.name}`, userId]
      );
      
      // Update milestone status
      const updatedResult = await client.query(
        'UPDATE milestones SET status = $1, reviewed_at = NOW(), reviewed_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
        ['approved', userId, req.params.id]
      );
      
      await client.query('COMMIT');
      
      res.json(updatedResult.rows[0]);
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error("Error approving milestone:", error);
      res.status(500).json({ error: error.message || "Failed to approve milestone" });
    } finally {
      client.release();
    }
  });
  
  // Reject milestone (admin/manager only)
  app.post("/api/milestones/:id/reject", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { reason } = req.body;
      
      if (!reason || typeof reason !== 'string') {
        return res.status(400).json({ error: "Rejection reason is required" });
      }
      
      const [milestone] = await db.select().from(milestones).where(eq(milestones.id, req.params.id));
      if (!milestone) {
        return res.status(404).json({ error: "Milestone not found" });
      }
      
      if (milestone.status !== 'submitted') {
        return res.status(400).json({ error: "Only submitted milestones can be rejected" });
      }
      
      const [updated] = await db.update(milestones)
        .set({
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: userId,
          rejectionReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(milestones.id, req.params.id))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error rejecting milestone:", error);
      res.status(500).json({ error: error.message || "Failed to reject milestone" });
    }
  });
  
  // Update milestone revision count (manual logging)
  app.patch("/api/milestones/:id/revision", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      const { revisionNotes } = req.body;
      
      const [milestone] = await db.select().from(milestones).where(eq(milestones.id, req.params.id));
      if (!milestone) {
        return res.status(404).json({ error: "Milestone not found" });
      }
      
      const hasAccess = await canAccessProject(userId, role, milestone.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this milestone" });
      }
      
      const [updated] = await db.update(milestones)
        .set({
          revisionCount: milestone.revisionCount + 1,
          revisionNotes: revisionNotes || milestone.revisionNotes,
          status: 'pending', // Reset to pending after revision
          updatedAt: new Date(),
        })
        .where(eq(milestones.id, req.params.id))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating milestone revision:", error);
      res.status(500).json({ error: error.message || "Failed to update milestone revision" });
    }
  });
  
  // Get pending approvals for admin/manager
  app.get("/api/milestones/pending-approvals", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      // Get projects this user can manage
      let projectIds: string[] = [];
      
      if (role === 'super_admin' || role === 'admin') {
        // Super admin and admin can see all projects (consistent with canAccessProject)
        const allProjects = await storage.getAllProjects();
        projectIds = allProjects.map((p: { id: string }) => p.id);
      } else {
        // Regular users see only their own projects
        const myProjects = await storage.getProjectsByUser(userId);
        projectIds = myProjects.map(p => p.id);
      }
      
      if (projectIds.length === 0) {
        return res.json([]);
      }
      
      // Get submitted milestones for these projects
      const pendingMilestones = await db.select()
        .from(milestones)
        .where(and(
          eq(milestones.status, 'submitted'),
          sql`${milestones.projectId} = ANY(ARRAY[${sql.raw(projectIds.map(id => `'${id}'`).join(','))}]::varchar[])`
        ))
        .orderBy(milestones.submittedAt);
      
      res.json(pendingMilestones);
    } catch (error: any) {
      console.error("Error fetching pending approvals:", error);
      res.status(500).json({ error: error.message || "Failed to fetch pending approvals" });
    }
  });

  // ==================== WALLET FUNDING ROUTES ====================

  // Update project wallet total (admin only) - sets the grand total
  app.post("/api/projects/:projectId/wallet/set-total", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { projectWallet } = req.body;

      if (typeof projectWallet !== 'number' || projectWallet < 0) {
        return res.status(400).json({ error: "Project wallet must be a non-negative number" });
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      let [credits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));

      if (!credits) {
        const [newCredits] = await db.insert(projectCredits).values({
          projectId,
          projectWallet,
          walletBalance: projectWallet,
        }).returning();
        return res.json(newCredits);
      }

      const walletBalance = projectWallet - credits.walletFunded;
      const [updated] = await db.update(projectCredits)
        .set({ projectWallet, walletBalance, updatedAt: new Date() })
        .where(eq(projectCredits.projectId, projectId))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error setting project wallet:", error);
      res.status(500).json({ error: error.message || "Failed to set project wallet" });
    }
  });

  // Add wallet funding entry (admin records a payment received)
  app.post("/api/projects/:projectId/wallet/fund", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { projectId } = req.params;
      const { amount, description, paymentReference } = req.body;

      if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: "Amount must be a positive number" });
      }
      if (!description || typeof description !== 'string') {
        return res.status(400).json({ error: "Description is required" });
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      let [credits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));

      if (!credits) {
        const [newCredits] = await db.insert(projectCredits).values({
          projectId,
          walletFunded: amount,
          walletBalance: -amount,
        }).returning();
        credits = newCredits;
      } else {
        const newFunded = credits.walletFunded + amount;
        const newBalance = credits.projectWallet - newFunded;
        const [updated] = await db.update(projectCredits)
          .set({ walletFunded: newFunded, walletBalance: newBalance, updatedAt: new Date() })
          .where(eq(projectCredits.projectId, projectId))
          .returning();
        credits = updated;
      }

      await db.insert(walletFundingEntries).values({
        projectId,
        amount,
        description,
        paymentReference: paymentReference || null,
        createdBy: userId,
      });

      res.json(credits);
    } catch (error: any) {
      console.error("Error adding wallet funding:", error);
      res.status(500).json({ error: error.message || "Failed to add wallet funding" });
    }
  });

  // Get wallet funding entries for a project
  app.get("/api/projects/:projectId/wallet/entries", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";

      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }

      const entries = await db.select().from(walletFundingEntries)
        .where(eq(walletFundingEntries.projectId, req.params.projectId))
        .orderBy(desc(walletFundingEntries.createdAt));

      res.json(entries);
    } catch (error: any) {
      console.error("Error fetching wallet entries:", error);
      res.status(500).json({ error: error.message || "Failed to fetch wallet entries" });
    }
  });

  // Get payment schedule for a project (calculated from computed grand total)
  app.get("/api/projects/:projectId/payment-schedule", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      const projectId = req.params.projectId;

      const hasAccess = await canAccessProject(userId, role, projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const [lineItems, appliedOffers] = await Promise.all([
        storage.getLineItemsByProject(projectId),
        db.select().from(projectOffers).where(eq(projectOffers.projectId, projectId)),
      ]);
      const { finalPayable } = computeQuotationTotals(lineItems, project.markup || 0, project.discount || 0, appliedOffers);
      const schedule = computePaymentSchedule(finalPayable);
      res.json(schedule);
    } catch (error: any) {
      console.error("Error fetching payment schedule:", error);
      res.status(500).json({ error: error.message || "Failed to fetch payment schedule" });
    }
  });

  // ==================== ADMIN CREDITS DASHBOARD ====================
  
  // Get credits overview for admin dashboard (all projects with credit status)
  app.get("/api/admin/credits-dashboard", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      // Get all projects with their credit balances
      const projectsWithCredits = await db
        .select({
          projectId: projects.id,
          clientName: projects.clientName,
          pid: projects.pid,
          status: projects.status,
          userId: projects.userId,
          projectCreatedAt: projects.createdAt,
          totalCredits: projectCredits.totalCredits,
          usedCredits: projectCredits.usedCredits,
          availableCredits: projectCredits.availableCredits,
        })
        .from(projects)
        .leftJoin(projectCredits, eq(projects.id, projectCredits.projectId))
        .orderBy(desc(projects.createdAt));
      
      // Get milestone counts per project
      const milestoneCounts = await db
        .select({
          projectId: milestones.projectId,
          total: sql<number>`count(*)::int`,
          pending: sql<number>`count(*) filter (where ${milestones.status} = 'pending')::int`,
          submitted: sql<number>`count(*) filter (where ${milestones.status} = 'submitted')::int`,
          approved: sql<number>`count(*) filter (where ${milestones.status} = 'approved')::int`,
          rejected: sql<number>`count(*) filter (where ${milestones.status} = 'rejected')::int`,
        })
        .from(milestones)
        .groupBy(milestones.projectId);
      
      const milestoneMap = new Map(milestoneCounts.map(m => [m.projectId, m]));
      
      // Get user info for each project
      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
      }).from(users);
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      
      // Build response
      const projectsList = projectsWithCredits.map(p => {
        const mc = milestoneMap.get(p.projectId);
        const owner = userMap.get(p.userId);
        return {
          projectId: p.projectId,
          clientName: p.clientName,
          pid: p.pid,
          status: p.status,
          ownerName: owner ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() || owner.username : 'Unknown',
          totalCredits: p.totalCredits || 0,
          usedCredits: p.usedCredits || 0,
          availableCredits: p.availableCredits || 0,
          milestones: {
            total: mc?.total || 0,
            pending: mc?.pending || 0,
            submitted: mc?.submitted || 0,
            approved: mc?.approved || 0,
            rejected: mc?.rejected || 0,
          },
        };
      });
      
      // Summary metrics
      const totalCreditsInSystem = projectsList.reduce((sum, p) => sum + p.totalCredits, 0);
      const totalUsedCredits = projectsList.reduce((sum, p) => sum + p.usedCredits, 0);
      const totalAvailableCredits = projectsList.reduce((sum, p) => sum + p.availableCredits, 0);
      const projectsWithZeroCredits = projectsList.filter(p => p.totalCredits === 0).length;
      const totalPendingApprovals = projectsList.reduce((sum, p) => sum + p.milestones.submitted, 0);
      
      res.json({
        summary: {
          totalCreditsInSystem,
          totalUsedCredits,
          totalAvailableCredits,
          projectsWithZeroCredits,
          totalPendingApprovals,
          totalProjects: projectsList.length,
        },
        projects: projectsList,
      });
    } catch (error: any) {
      console.error("Error fetching credits dashboard:", error);
      res.status(500).json({ error: error.message || "Failed to fetch credits dashboard" });
    }
  });
  
  // ==================== ROOM ROUTES ====================
  
  // Get rooms for a project (with authorization check)
  app.get("/api/projects/:projectId/rooms", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      const rooms = await storage.getRoomsByProject(req.params.projectId);
      res.json(rooms);
    } catch (error: any) {
      console.error("Error fetching rooms:", error);
      res.status(500).json({ error: error.message || "Failed to fetch rooms" });
    }
  });

  // Get single room (with authorization check)
  app.get("/api/rooms/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessRoom(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this room" });
      }
      
      const room = await storage.getRoom(req.params.id);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }
      res.json(room);
    } catch (error: any) {
      console.error("Error fetching room:", error);
      res.status(500).json({ error: error.message || "Failed to fetch room" });
    }
  });

  // Create room (with authorization check)
  app.post("/api/projects/:projectId/rooms", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      // Check if project is finalized
      if (await isProjectFinalized(req.params.projectId)) {
        return res.status(403).json({ error: "Cannot modify a finalized quote" });
      }
      
      const validated = insertRoomSchema.parse({
        ...req.body,
        projectId: req.params.projectId,
      });
      
      const room = await storage.createRoom(validated);
      res.status(201).json(room);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Error creating room:", error);
      res.status(500).json({ error: error.message || "Failed to create room" });
    }
  });

  // Update room (with authorization check)
  app.patch("/api/rooms/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessRoom(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this room" });
      }
      
      // Check if project is finalized
      if (await isRoomProjectFinalized(req.params.id)) {
        return res.status(403).json({ error: "Cannot modify a finalized quote" });
      }
      
      const room = await storage.updateRoom(req.params.id, req.body);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }
      res.json(room);
    } catch (error: any) {
      console.error("Error updating room:", error);
      res.status(500).json({ error: error.message || "Failed to update room" });
    }
  });

  // Delete room (with authorization check)
  app.delete("/api/rooms/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessRoom(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this room" });
      }
      
      // Check if project is finalized
      if (await isRoomProjectFinalized(req.params.id)) {
        return res.status(403).json({ error: "Cannot modify a finalized quote" });
      }
      
      await storage.deleteRoom(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting room:", error);
      res.status(500).json({ error: error.message || "Failed to delete room" });
    }
  });

  // Duplicate a room with all line items
  app.post("/api/rooms/:id/duplicate", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessRoom(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this room" });
      }
      
      // Check if project is finalized
      if (await isRoomProjectFinalized(req.params.id)) {
        return res.status(403).json({ error: "Cannot modify a finalized quote" });
      }
      
      const newRoom = await storage.duplicateRoom(req.params.id);
      res.json(newRoom);
    } catch (error: any) {
      console.error("Error duplicating room:", error);
      res.status(500).json({ error: error.message || "Failed to duplicate room" });
    }
  });

  // ==================== ROOM SUB-CATEGORY ROUTES ====================
  // Optional grouping layer between a room and its line items (e.g. "TV Unit" inside
  // "Family Living Room"). A room with no sub-categories, or a line item with no
  // subcategoryId, renders exactly as it did before this feature existed.

  // List sub-categories for a room (with authorization check)
  app.get("/api/rooms/:roomId/subcategories", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";

      const hasAccess = await canAccessRoom(userId, role, req.params.roomId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this room" });
      }

      const subcategories = await storage.getRoomSubcategoriesByRoom(req.params.roomId);
      res.json(subcategories);
    } catch (error: any) {
      console.error("Error fetching room subcategories:", error);
      res.status(500).json({ error: error.message || "Failed to fetch subcategories" });
    }
  });

  // List sub-categories across all rooms in a project (used to render the full quotation
  // preview / PDF without an N+1 request per room)
  app.get("/api/projects/:projectId/subcategories", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";

      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }

      const subcategories = await storage.getRoomSubcategoriesByProject(req.params.projectId);
      res.json(subcategories);
    } catch (error: any) {
      console.error("Error fetching project subcategories:", error);
      res.status(500).json({ error: error.message || "Failed to fetch subcategories" });
    }
  });

  // Create a sub-category within a room (with authorization check)
  app.post("/api/rooms/:roomId/subcategories", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";

      const hasAccess = await canAccessRoom(userId, role, req.params.roomId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this room" });
      }

      if (await isRoomProjectFinalized(req.params.roomId)) {
        return res.status(403).json({ error: "Cannot modify a finalized quote" });
      }

      const existing = await storage.getRoomSubcategoriesByRoom(req.params.roomId);
      const validated = insertRoomSubcategorySchema.parse({
        roomId: req.params.roomId,
        name: req.body.name,
        sortOrder: existing.length,
      });

      const subcategory = await storage.createRoomSubcategory(validated);
      res.status(201).json(subcategory);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Error creating room subcategory:", error);
      res.status(500).json({ error: error.message || "Failed to create subcategory" });
    }
  });

  // Delete a sub-category (ungroups its line items back to the room, does not delete them)
  app.delete("/api/subcategories/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";

      const hasAccess = await canAccessRoomSubcategory(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this subcategory" });
      }

      if (await isRoomSubcategoryProjectFinalized(req.params.id)) {
        return res.status(403).json({ error: "Cannot modify a finalized quote" });
      }

      await storage.deleteRoomSubcategory(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting room subcategory:", error);
      res.status(500).json({ error: error.message || "Failed to delete subcategory" });
    }
  });

  // ==================== LINE ITEM ROUTES ====================
  
  // Get all line items for current user's projects (respects role hierarchy)
  app.get("/api/line-items/all", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      let projectsList;
      if (role === "super_admin") {
        projectsList = await storage.getAllProjects();
      } else if (role === "admin") {
        projectsList = await storage.getProjectsByTeam(userId);
      } else {
        projectsList = await storage.getProjectsByUser(userId);
      }
      
      const projectIds = projectsList.map(p => p.id);
      const allLineItems = [];
      
      for (const projectId of projectIds) {
        const lineItems = await storage.getLineItemsByProject(projectId);
        allLineItems.push(...lineItems);
      }
      
      res.json(allLineItems);
    } catch (error: any) {
      console.error("Error fetching all line items:", error);
      res.status(500).json({ error: error.message || "Failed to fetch line items" });
    }
  });
  
  // Get line items for a room (with authorization check)
  app.get("/api/rooms/:roomId/line-items", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessRoom(userId, role, req.params.roomId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this room" });
      }
      
      const lineItems = await storage.getLineItemsByRoom(req.params.roomId);
      res.json(lineItems);
    } catch (error: any) {
      console.error("Error fetching line items:", error);
      res.status(500).json({ error: error.message || "Failed to fetch line items" });
    }
  });

  // Get line items for a project (with authorization check)
  app.get("/api/projects/:projectId/line-items", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      const lineItems = await storage.getLineItemsByProject(req.params.projectId);
      res.json(lineItems);
    } catch (error: any) {
      console.error("Error fetching line items:", error);
      res.status(500).json({ error: error.message || "Failed to fetch line items" });
    }
  });

  // Create line item with auto-calculations (with authorization check)
  app.post("/api/rooms/:roomId/line-items", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessRoom(userId, role, req.params.roomId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this room" });
      }
      
      // Check if project is finalized
      if (await isRoomProjectFinalized(req.params.roomId)) {
        return res.status(403).json({ error: "Cannot modify a finalized quote" });
      }
      
      const room = await storage.getRoom(req.params.roomId);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      const { description, unitType, lengthFt, heightFt, depthFt = 0, quantity, rate, itemType, catalogItemId, subcategoryId, isComplimentary, complimentaryOfferName } = req.body;
      
      // Keep the stable item code rather than the catalog row's database id: catalog
      // rows are replaced during sync, while the item code survives across versions.
      let selectedCatalogItem: { itemCode?: string; imageUrl?: string; rate?: number | null; sellingPrice?: number | null; itemType?: string | null } | undefined;
      if (catalogItemId) {
        // Resolve through the same project-scoped catalog used by the wizard. This
        // accepts the project's pinned version and its explicit exceptions, while
        // preventing a caller from attaching an item/image from another version.
        const project = await storage.getProject(room.projectId);
        if (!project?.pricingVersionId) {
          return res.status(400).json({ error: "This project has no pricing catalog assigned." });
        }
        const permittedCatalog = await getCatalogForProject(project.pricingVersionId, room.projectId);
        selectedCatalogItem = permittedCatalog.find((item) => item.id === catalogItemId);
        if (!selectedCatalogItem) {
          return res.status(400).json({ error: "The selected catalog item is not available for this project. Refresh the catalog and try again." });
        }
      }

      // If a sub-category is targeted, it must belong to this same room -- otherwise a
      // line item could end up grouped under another room's sub-category.
      if (subcategoryId) {
        const subcategory = await storage.getRoomSubcategory(subcategoryId);
        if (!subcategory || subcategory.roomId !== req.params.roomId) {
          return res.status(400).json({ error: "Subcategory does not belong to this room" });
        }
      }

      // Calculate derived values
      const sqft = lengthFt * heightFt;
      const lengthMm = lengthFt * 300;
      const heightMm = heightFt * 300;
      const depthMm = depthFt * 300;
      
      // Amount calculation based on unit semantics:
      // - Area-based items (sqft > 0): rate × sqft × quantity
      // - Per-unit items (sqft = 0): rate × quantity
      // This applies regardless of itemType - Services/Civil with area use area pricing too
      const effectiveItemType = selectedCatalogItem?.itemType || itemType || 'woodworks';
      const isAreaBased = effectiveItemType !== 'furniture' && sqft > 0;

      const catalogRate = selectedCatalogItem
        ? (selectedCatalogItem.sellingPrice || selectedCatalogItem.rate || 0)
        : rate;
      const validated = insertLineItemSchema.parse({
        roomId: req.params.roomId,
        projectId: room.projectId,
        subcategoryId: subcategoryId || null,
        description,
        unitType,
        lengthFt,
        heightFt,
        depthFt,
        sqft,
        lengthMm,
        heightMm,
        depthMm,
        rate: catalogRate,
        quantity,
        amount: isAreaBased ? (catalogRate * sqft * quantity) : (catalogRate * quantity),
        itemType: effectiveItemType,
        catalogItemCode: selectedCatalogItem?.itemCode || null,
        imageUrl: normalizeProductImageUrl(selectedCatalogItem?.imageUrl) || null,
        isComplimentary: isComplimentary === true,
        complimentaryOfferName: isComplimentary === true ? (complimentaryOfferName || "").trim() : null,
      });
      
      const lineItem = await storage.createLineItem(validated);
      
      // Update project updatedAt timestamp
      await storage.updateProject(room.projectId, {});
      
      res.status(201).json(lineItem);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation error", details: error.errors });
      }
      console.error("Error creating line item:", error);
      res.status(500).json({ error: error.message || "Failed to create line item" });
    }
  });

  // Update line item (with authorization check)
  // Partial validation schema for updates
  const updateLineItemSchema = z.object({
    description: z.string().min(1, "Description is required").optional(),
    quantity: z.number().min(1, "Quantity must be at least 1").optional(),
    rate: z.number().min(0, "Rate cannot be negative").optional(),
    lengthFt: z.number().min(0, "Length cannot be negative").optional(),
    heightFt: z.number().min(0, "Height cannot be negative").optional(),
    depthFt: z.number().min(0, "Depth cannot be negative").optional(),
    sqft: z.number().min(0).optional(),
    lengthMm: z.number().min(0).optional(),
    heightMm: z.number().min(0).optional(),
    depthMm: z.number().min(0).optional(),
    amount: z.number().min(0).optional(),
    itemType: z.enum(["woodworks", "services", "accessories", "furniture"]).optional(),
    // Reassign which sub-category this item belongs to. null = move it back to
    // "directly under the room"; omitted = leave the current assignment unchanged.
    subcategoryId: z.string().nullable().optional(),
    isComplimentary: z.boolean().optional(),
    complimentaryOfferName: z.string().nullable().optional(),
  }).refine(
    (data) => data.isComplimentary !== true || !!data.complimentaryOfferName?.trim(),
    { message: "Offer name is required for a complimentary item", path: ["complimentaryOfferName"] }
  );

  app.patch("/api/line-items/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessLineItem(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this line item" });
      }
      
      // Check if project is finalized
      if (await isLineItemProjectFinalized(req.params.id)) {
        return res.status(403).json({ error: "Cannot modify a finalized quote" });
      }
      
      // Validate the update data
      const validationResult = updateLineItemSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Validation error", 
          details: validationResult.error.errors 
        });
      }
      
      // Get current line item to calculate derived values
      const currentItem = await storage.getLineItem(req.params.id);
      if (!currentItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      // If reassigning to a sub-category, it must belong to the same room as this item
      if (validationResult.data.subcategoryId) {
        const subcategory = await storage.getRoomSubcategory(validationResult.data.subcategoryId);
        if (!subcategory || subcategory.roomId !== currentItem.roomId) {
          return res.status(400).json({ error: "Subcategory does not belong to this item's room" });
        }
      }

      // Validate against the effective (post-merge) complimentary state, not just this
      // partial payload -- e.g. clearing the offer name on an already-complimentary
      // item without also un-checking the toggle must still be rejected.
      const effectiveIsComplimentary = validationResult.data.isComplimentary ?? currentItem.isComplimentary;
      const effectiveOfferName = validationResult.data.complimentaryOfferName !== undefined
        ? validationResult.data.complimentaryOfferName
        : currentItem.complimentaryOfferName;
      if (effectiveIsComplimentary && !effectiveOfferName?.trim()) {
        return res.status(400).json({ error: "Offer name is required for a complimentary item" });
      }
      
      // Build update data - only recalculate derived fields if their source inputs changed
      const updateData = { ...validationResult.data };
      const inputData = validationResult.data;

      // Turning the toggle off clears the offer name, so a later re-enable doesn't
      // silently resurrect a stale name.
      if (inputData.isComplimentary === false) {
        updateData.complimentaryOfferName = null;
      }
      
      // Check if any dimension-related fields were changed
      const dimensionsChanged = inputData.lengthFt !== undefined || inputData.heightFt !== undefined || inputData.depthFt !== undefined;
      const quantityChanged = inputData.quantity !== undefined;
      const rateChanged = inputData.rate !== undefined;
      
      // Only recalculate if source inputs were explicitly provided
      if (dimensionsChanged || quantityChanged || rateChanged) {
        const lengthFt = inputData.lengthFt ?? currentItem.lengthFt;
        const heightFt = inputData.heightFt ?? currentItem.heightFt;
        const depthFt = inputData.depthFt ?? currentItem.depthFt;
        const quantity = inputData.quantity ?? currentItem.quantity;
        const rate = inputData.rate ?? currentItem.rate;
        
        // Recalculate derived values
        if (dimensionsChanged) {
          updateData.sqft = lengthFt * heightFt;
          updateData.lengthMm = lengthFt * 300;
          updateData.heightMm = heightFt * 300;
          updateData.depthMm = depthFt * 300;
        }
        
        // Recalculate amount if any pricing-related field changed
        // Amount calculation based on unit semantics:
        // - Area-based items (sqft > 0): rate × sqft × quantity
        // - Per-unit items (sqft = 0): rate × quantity
        const sqft = updateData.sqft ?? currentItem.sqft;
        const isAreaBased = currentItem.itemType !== 'furniture' && sqft > 0;
        updateData.amount = isAreaBased ? (sqft * rate * quantity) : (rate * quantity);
      }
      
      const lineItem = await storage.updateLineItem(req.params.id, updateData);
      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }
      res.json(lineItem);
    } catch (error: any) {
      console.error("Error updating line item:", error);
      res.status(500).json({ error: error.message || "Failed to update line item" });
    }
  });

  // Delete line item (with authorization check)
  app.delete("/api/line-items/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessLineItem(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this line item" });
      }
      
      // Check if project is finalized
      if (await isLineItemProjectFinalized(req.params.id)) {
        return res.status(403).json({ error: "Cannot modify a finalized quote" });
      }
      
      await storage.deleteLineItem(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting line item:", error);
      res.status(500).json({ error: error.message || "Failed to delete line item" });
    }
  });

  // ==================== QUOTATION SUMMARY ROUTE ====================
  
  // Get complete quotation with totals (with authorization check)
  app.get("/api/projects/:projectId/quotation", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
      
      const project = await storage.getProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const [rooms, lineItems, appliedOffers] = await Promise.all([
        storage.getRoomsByProject(req.params.projectId),
        storage.getLineItemsByProject(req.params.projectId),
        db.select().from(projectOffers).where(eq(projectOffers.projectId, req.params.projectId)),
      ]);
      const totals = computeQuotationTotals(
        lineItems,
        project.markup || 0,
        project.discount || 0,
        appliedOffers,
      );

      // Group line items by room
      const roomsWithItems = rooms.map(room => ({
        ...room,
        lineItems: lineItems.filter(item => item.roomId === room.id),
        total: lineItems
          .filter(item => item.roomId === room.id)
          .reduce((sum, item) => sum + item.amount, 0),
      }));

      res.json({
        project,
        rooms: roomsWithItems,
        summary: {
          subtotal: totals.lineItemsSubtotal,
          markupPercentage: project.markup || 0,
          markupValue: totals.enablementFeeValue,
          totalWithMarkup: totals.totalProjectValue,
          gstPercentage: 18,
          gstAmount: totals.totalGst,
          grandTotal: totals.grandTotal,
          offerPercentageDiscount: totals.offerPercentageDiscount,
          cashDiscount: totals.cashDiscount,
          finalPayable: totals.finalPayable,
        },
      });
    } catch (error: any) {
      console.error("Error fetching quotation:", error);
      res.status(500).json({ error: error.message || "Failed to fetch quotation" });
    }
  });

  // ==================== QUOTATION TESTING ROUTES ====================
  
  // Fetch GQ sheet for comparison testing
  app.get("/api/quotations/gq/:sheetName", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { sheetName } = req.params;
      
      // Validate sheet name - includes legacy GQ sheets and new DeX golden quotations
      // Note: Sheet names must match exactly as in Google Sheets (including spaces)
      const validSheets = ['GQ 1', 'GQ 2', 'GQ 3', 'GQ 4', 'Xpress - GQ- 1', 'Xpand - GQ- 1'];
      if (!validSheets.includes(sheetName)) {
        return res.status(400).json({ 
          error: `Invalid sheet name. Must be one of: ${validSheets.join(', ')}` 
        });
      }
      
      const gqData = await fetchGQSheet(SPREADSHEET_ID, sheetName);
      
      res.json(gqData);
    } catch (error: any) {
      console.error("Error fetching GQ sheet:", error);
      res.status(500).json({ error: error.message || "Failed to fetch GQ sheet" });
    }
  });

  // Run comparison test on GQ sheet
  app.post("/api/quotations/test", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { sheetName } = req.body;
      
      // Validate sheet name - includes legacy GQ sheets and new DeX golden quotations
      // Note: Sheet names must match exactly as in Google Sheets (including spaces)
      const validSheets = ['GQ 1', 'GQ 2', 'GQ 3', 'GQ 4', 'Xpress - GQ- 1', 'Xpand - GQ- 1'];
      if (!validSheets.includes(sheetName)) {
        return res.status(400).json({ 
          error: `Invalid sheet name. Must be one of: ${validSheets.join(', ')}` 
        });
      }
      
      const comparisonResult = await testGQSheet(SPREADSHEET_ID, sheetName);
      
      res.json(comparisonResult);
    } catch (error: any) {
      console.error("Error testing GQ sheet:", error);
      res.status(500).json({ error: error.message || "Failed to test GQ sheet" });
    }
  });

  // Create project from GQ sheet data (replicates actual quotation) - Admin only
  app.post("/api/quotations/create-from-gq", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { sheetName = "Xpress - GQ- 1" } = req.body;
      
      // Validate sheet name
      const validSheets = ['GQ 1', 'GQ 2', 'GQ 3', 'GQ 4', 'Xpress - GQ- 1', 'Xpand - GQ- 1'];
      if (!validSheets.includes(sheetName)) {
        return res.status(400).json({ 
          error: `Invalid sheet name. Must be one of: ${validSheets.join(', ')}` 
        });
      }
      
      const result = await createGQ1Project(SPREADSHEET_ID, userId, sheetName);
      res.json(result);
    } catch (error: any) {
      console.error("Error creating project from GQ sheet:", error);
      res.status(500).json({ error: error.message || "Failed to create project from GQ sheet" });
    }
  });

  // Debug: Dump raw GQ sheet structure to analyze multi-section layout
  app.get("/api/quotations/debug-structure/:sheetName", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { sheetName } = req.params;
      
      const validSheets = ['GQ 1', 'GQ 2', 'GQ 3', 'GQ 4', 'Xpress - GQ- 1', 'Xpand - GQ- 1'];
      if (!validSheets.includes(sheetName)) {
        return res.status(400).json({ 
          error: `Invalid sheet name. Must be one of: ${validSheets.join(', ')}` 
        });
      }
      
      const gqData = await fetchGQSheet(SPREADSHEET_ID, sheetName);
      
      // Analyze the structure: look for section boundaries
      const structure: any[] = [];
      const { data, headers, rawData } = gqData;
      
      // DeX category keywords to identify section starts
      const categoryKeywords = ['xpress', 'xpand', 'accessories', 'services', 'lights', 'stone', 'handles', 'civil'];
      const totalKeywords = ['total', 'subtotal', 'sub total', 'grand total', 'gst', 'markup'];
      
      rawData.forEach((row: any[], index: number) => {
        if (!row || row.length === 0) {
          structure.push({ row: index + 1, type: 'empty' });
          return;
        }
        
        const rowText = row.join(' ').toLowerCase();
        const firstCell = (row[0] || '').toString().trim().toLowerCase();
        const secondCell = (row[1] || '').toString().trim().toLowerCase();
        
        // Check for category section header
        const isCategory = categoryKeywords.some(kw => 
          firstCell.includes(kw) || secondCell.includes(kw) || 
          (rowText.includes(kw) && !rowText.includes('total'))
        );
        
        // Check for total/summary row
        const isTotal = totalKeywords.some(kw => rowText.includes(kw));
        
        // Check for column headers
        const isHeader = rowText.includes('description') && rowText.includes('rate');
        
        structure.push({
          row: index + 1,
          type: isHeader ? 'header' : isCategory ? 'category' : isTotal ? 'total' : 'data',
          preview: row.slice(0, 5).map(c => (c || '').toString().substring(0, 20)).join(' | '),
          fullRow: row.map(c => (c || '').toString().substring(0, 30))
        });
      });
      
      // Write to debug file
      const debugOutput = JSON.stringify(structure, null, 2);
      fs.writeFileSync('/tmp/gq_structure_debug.json', debugOutput);
      
      res.json({
        sheetName,
        totalRows: rawData.length,
        headers,
        structure: structure.filter(s => s.type !== 'empty').slice(0, 100) // Limit output
      });
    } catch (error: any) {
      console.error("Error debugging GQ sheet structure:", error);
      res.status(500).json({ error: error.message || "Failed to debug GQ sheet structure" });
    }
  });

  // ==================== DUPLICATE PROJECT ROUTE ====================
  
  // Duplicate a project with all rooms and line items
  app.post("/api/projects/:id/duplicate", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      
      const hasAccess = await canAccessProject(userId, role, req.params.id);
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied to this project" });
      }

      const sourceProject = await storage.getProject(req.params.id);
      if (!sourceProject) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (!sourceProject.pid?.trim()) {
        return res.status(400).json({
          error: "Assign a Project ID (PID) to this legacy project before duplicating it",
        });
      }
      
      const newProject = await storage.duplicateProject(req.params.id, userId);
      res.status(201).json(newProject);
    } catch (error: any) {
      console.error("Error duplicating project:", error);
      res.status(500).json({ error: error.message || "Failed to duplicate project" });
    }
  });

  // ==================== USER MANAGEMENT ROUTES (Admin only) ====================
  
  // Get all users (admin/super_admin only)
  app.get("/api/admin/users", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      // Don't return passwords
      const sanitizedUsers = users.map(user => ({
        ...user,
        password: undefined,
      }));
      res.json(sanitizedUsers);
    } catch (error: any) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: error.message || "Failed to fetch users" });
    }
  });

  // Create user (admin/super_admin only) - create user with username and password
  app.post("/api/admin/users", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { username, password, firstName, lastName, role, managerId, cohort } = req.body;
      
      if (!username || !username.trim()) {
        return res.status(400).json({ error: "Username is required" });
      }
      
      if (!password || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      const normalizedRole = typeof role === "string" ? role : "user";
      if (!USER_ROLES.has(normalizedRole)) {
        return res.status(400).json({ error: "Invalid user role" });
      }
      const normalizedCohort = cohort === "PD" || cohort === "DTL" ? cohort : null;
      if (cohort && !normalizedCohort) {
        return res.status(400).json({ error: "TL cohort must be PD or DTL" });
      }
      if (normalizedRole === "tl" && !normalizedCohort) {
        return res.status(400).json({ error: "Choose PD or DTL for a Team Lead" });
      }
      
      // Validate username format (alphanumeric and underscores only)
      const usernameRegex = /^[a-zA-Z0-9_]+$/;
      if (!usernameRegex.test(username.trim())) {
        return res.status(400).json({ error: "Username can only contain letters, numbers, and underscores" });
      }
      
      // Check if user with this username already exists
      const existingUsers = await storage.getAllUsers();
      if (existingUsers.some(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
        return res.status(400).json({ error: "A user with this username already exists" });
      }
      
      // Admins can't create super_admin users
      const currentRole = req.session.role || "user";
      if (currentRole === "admin" && normalizedRole === "super_admin") {
        return res.status(403).json({ error: "Only super admins can create super admin users" });
      }
      
      // Validate managerId if provided - must be an existing admin/super_admin
      if (managerId) {
        const manager = existingUsers.find(u => u.id === managerId);
        if (!manager) {
          return res.status(400).json({ error: "Invalid manager: user not found" });
        }
        if (manager.role !== "admin" && manager.role !== "super_admin") {
          return res.status(400).json({ error: "Manager must be an admin or super admin" });
        }
        // Regular admins can only assign themselves or other admins they manage as managers
        if (currentRole === "admin") {
          const currentUserId = req.session.userId!;
          if (managerId !== currentUserId && manager.managerId !== currentUserId) {
            return res.status(403).json({ error: "You can only assign yourself or your team admins as manager" });
          }
        }
      }
      
      // Hash the password
      const bcrypt = await import("bcrypt");
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Create user with active status
      const newUser = await storage.createUser({
        username: username.trim().toLowerCase(),
        password: hashedPassword,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        role: normalizedRole,
        cohort: normalizedRole === "tl" ? normalizedCohort : null,
        managerId: managerId || null,
        status: "active",
      });
      
      res.status(201).json({ ...newUser, password: undefined });
    } catch (error: any) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: error.message || "Failed to create user" });
    }
  });

  // Update user (admin/super_admin only)
  app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const currentRole = req.session.role || "user";
      const targetUser = await storage.getUser(req.params.id);
      
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Prevent admins from modifying super_admin users
      if (currentRole === "admin" && targetUser.role === "super_admin") {
        return res.status(403).json({ error: "Cannot modify super admin users" });
      }
      
      // Prevent changing own role
      if (req.params.id === req.session.userId && req.body.role) {
        return res.status(403).json({ error: "Cannot change your own role" });
      }
      
      // Remove password from update if present (use separate endpoint for password changes)
      const { password, role, managerId, cohort } = req.body;
      const updateData: Record<string, string | null> = {};
      if (role !== undefined) {
        if (typeof role !== "string" || !USER_ROLES.has(role)) {
          return res.status(400).json({ error: "Invalid user role" });
        }
        if (currentRole === "admin" && role === "super_admin") {
          return res.status(403).json({ error: "Only super admins can create super admin users" });
        }
        updateData.role = role;
      }
      if (managerId !== undefined) updateData.managerId = managerId || null;
      const resultingRole = updateData.role || targetUser.role;
      if (cohort !== undefined && cohort !== null && !TL_COHORTS.has(cohort)) {
        return res.status(400).json({ error: "TL cohort must be PD or DTL" });
      }
      if (resultingRole === "tl" && !(cohort ?? targetUser.cohort)) {
        return res.status(400).json({ error: "Choose PD or DTL for a Team Lead" });
      }
      updateData.cohort = resultingRole === "tl" ? (cohort ?? targetUser.cohort) : null;
      
      const user = await storage.updateUser(req.params.id, updateData);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json({ ...user, password: undefined });
    } catch (error: any) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: error.message || "Failed to update user" });
    }
  });

  // Delete user (super_admin only, or admin for their team members)
  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const currentUserId = req.session.userId!;
      const currentRole = req.session.role || "user";
      const targetUser = await storage.getUser(req.params.id);
      
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Prevent deleting self
      if (req.params.id === currentUserId) {
        return res.status(403).json({ error: "Cannot delete your own account" });
      }
      
      // Prevent admins from deleting other admins or super_admins
      if (currentRole === "admin" && (targetUser.role === "admin" || targetUser.role === "super_admin")) {
        return res.status(403).json({ error: "Only super admins can delete admin accounts" });
      }
      
      // Admins can delete any regular user (role === "user")
      // Super admins can delete anyone
      
      await storage.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: error.message || "Failed to delete user" });
    }
  });

  // ==================== ANALYTICS ROUTES (Admin only) ====================
  
  // Get analytics data
  app.get("/api/admin/analytics", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const currentUserId = req.session.userId!;
      const currentRole = req.session.role || "user";
      
      // Admin and super_admin both see all projects
      const projectsList = await storage.getAllProjects();
      
      const projectFinancials = await Promise.all(projectsList.map(async (project) => {
        const [lineItems, appliedOffers] = await Promise.all([
          storage.getLineItemsByProject(project.id),
          db.select().from(projectOffers).where(eq(projectOffers.projectId, project.id)),
        ]);
        return {
          lineItemCount: lineItems.length,
          finalPayable: computeQuotationTotals(
            lineItems,
            project.markup || 0,
            project.discount || 0,
            appliedOffers,
          ).finalPayable,
        };
      }));
      const totalLineItems = projectFinancials.reduce((sum, project) => sum + project.lineItemCount, 0);
      const totalRevenue = projectFinancials.reduce((sum, project) => sum + project.finalPayable, 0);
      
      // Count by status
      const statusCounts = projectsList.reduce((acc, project) => {
        acc[project.status] = (acc[project.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      // Get users count
      const allUsers = await storage.getAllUsers();
      
      res.json({
        totalProjects: projectsList.length,
        totalLineItems,
        totalRevenue,
        statusBreakdown: statusCounts,
        totalUsers: allUsers.length,
        recentProjects: projectsList.slice(0, 5),
      });
    } catch (error: any) {
      console.error("Error fetching analytics:", error);
      res.status(500).json({ error: error.message || "Failed to fetch analytics" });
    }
  });

  // Get all users with their projects (admin only) - for admin portal user/project overview
  app.get("/api/admin/users-projects", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const allUsers = await storage.getAllUsers();
      const allProjects = await storage.getAllProjects();
      
      const usersWithProjects = allUsers.map(user => {
        const userProjects = allProjects.filter(p => p.userId === user.id);
        return {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          createdAt: user.createdAt,
          projectCount: userProjects.length,
          projects: userProjects.map(p => ({
            id: p.id,
            clientName: p.clientName,
            pid: p.pid,
            status: p.status,
            projectType: p.projectType,
            defaultCategory: p.defaultCategory,
            multiStyleEnabled: p.multiStyleEnabled,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        };
      });
      
      res.json(usersWithProjects);
    } catch (error: any) {
      console.error("Error fetching users-projects:", error);
      res.status(500).json({ error: error.message || "Failed to fetch users with projects" });
    }
  });

  // User quote analytics (for current user only - strictly their own projects)
  app.get("/api/analytics/quotes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      // Use getProjectsByUser to strictly get only this user's own projects
      const projects = await storage.getProjectsByUser(userId);
      
      // Calculate quote values by status
      let totalQuoteValue = 0;
      const valueByStatus: Record<string, number> = {};
      const monthlyData: Record<string, { count: number; value: number }> = {};
      
      for (const project of projects) {
        const [lineItems, appliedOffers] = await Promise.all([
          storage.getLineItemsByProject(project.id),
          db.select().from(projectOffers).where(eq(projectOffers.projectId, project.id)),
        ]);
        const projectValue = computeQuotationTotals(
          lineItems,
          project.markup || 0,
          project.discount || 0,
          appliedOffers,
        ).finalPayable;
        
        totalQuoteValue += projectValue;
        valueByStatus[project.status] = (valueByStatus[project.status] || 0) + projectValue;
        
        // Group by month (YYYY-MM format)
        const createdAt = project.createdAt ? new Date(project.createdAt) : new Date();
        const monthKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { count: 0, value: 0 };
        }
        monthlyData[monthKey].count += 1;
        monthlyData[monthKey].value += projectValue;
      }
      
      // Count by status
      const countByStatus = projects.reduce((acc, project) => {
        acc[project.status] = (acc[project.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      // Convert monthly data to array sorted by date
      const monthlyTrends = Object.entries(monthlyData)
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12); // Last 12 months
      
      res.json({
        totalQuotes: projects.length,
        totalQuoteValue,
        countByStatus,
        valueByStatus,
        monthlyTrends,
        averageQuoteValue: projects.length > 0 ? totalQuoteValue / projects.length : 0,
      });
    } catch (error: any) {
      console.error("Error fetching quote analytics:", error);
      res.status(500).json({ error: error.message || "Failed to fetch quote analytics" });
    }
  });

  // ==================== CLIENT PORTAL ROUTES ====================
  
  // Generate or regenerate share token for a project
  app.post("/api/projects/:id/share", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      if (!await canAccessProject(userId, role, project.id)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      // Generate a random share token
      const shareToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      // Set expiration to 30 days from now
      const shareExpiresAt = new Date();
      shareExpiresAt.setDate(shareExpiresAt.getDate() + 30);
      
      const updatedProject = await storage.updateProject(req.params.id, {
        shareToken,
        shareEnabled: true,
        shareExpiresAt,
      });
      
      if (!updatedProject) {
        return res.status(500).json({ error: "Failed to update project" });
      }
      
      res.json({ 
        shareToken: updatedProject.shareToken,
        shareEnabled: updatedProject.shareEnabled,
        shareExpiresAt: updatedProject.shareExpiresAt,
        shareUrl: `/quote/${updatedProject.shareToken}`,
      });
    } catch (error: any) {
      console.error("Error generating share token:", error);
      res.status(500).json({ error: error.message || "Failed to generate share token" });
    }
  });
  
  // Toggle sharing on/off
  app.patch("/api/projects/:id/share", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const role = req.session.role || "user";
      const project = await storage.getProject(req.params.id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      if (!await canAccessProject(userId, role, project.id)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const { shareEnabled } = req.body;
      
      const updatedProject = await storage.updateProject(req.params.id, {
        shareEnabled: !!shareEnabled,
      });
      
      if (!updatedProject) {
        return res.status(500).json({ error: "Failed to update project" });
      }
      
      res.json({ 
        shareToken: updatedProject.shareToken,
        shareEnabled: updatedProject.shareEnabled,
        shareExpiresAt: updatedProject.shareExpiresAt,
      });
    } catch (error: any) {
      console.error("Error toggling share status:", error);
      res.status(500).json({ error: error.message || "Failed to toggle share status" });
    }
  });
  
  // Public endpoint to get shared quotation (no auth required)
  app.get("/api/shared/:shareToken", async (req: Request, res: Response) => {
    try {
      const { shareToken } = req.params;
      
      // Find project by share token
      const project = await storage.getProjectByShareToken(shareToken);
      
      if (!project) {
        return res.status(404).json({ error: "Quote not found" });
      }
      
      if (!project.shareEnabled) {
        return res.status(403).json({ error: "This quote is no longer shared" });
      }
      
      // Check if share link has expired
      if (project.shareExpiresAt && new Date() > new Date(project.shareExpiresAt)) {
        return res.status(410).json({ error: "This share link has expired" });
      }
      
      // Update last accessed timestamp (async, don't wait)
      storage.updateProject(project.id, { shareLastAccessedAt: new Date() }).catch(err => {
        console.error("Failed to update share last accessed:", err);
      });
      
      // Get rooms, line items and sub-categories
      const rooms = await storage.getRoomsByProject(project.id);
      const [lineItems, appliedOffers] = await Promise.all([
        storage.getLineItemsByProject(project.id),
        db.select().from(projectOffers).where(eq(projectOffers.projectId, project.id)),
      ]);
      const subcategories = await storage.getRoomSubcategoriesByProject(project.id);

      const toPublicLineItem = (li: typeof lineItems[number]) => ({
        description: li.description,
        dimensions: `${li.lengthFt} × ${li.heightFt} ft`,
        lengthFt: li.lengthFt,
        heightFt: li.heightFt,
        lengthMm: li.lengthMm,
        heightMm: li.heightMm,
        sqft: li.sqft,
        quantity: li.quantity,
        rate: li.rate,
        amount: li.amount,
        itemType: li.itemType,
        imageUrl: li.imageUrl,
        isComplimentary: li.isComplimentary,
        complimentaryOfferName: li.complimentaryOfferName,
      });
      
      // Return limited project info for client view (no internal IDs)
      res.json({
        clientName: project.clientName,
        projectType: project.projectType,
        category: project.defaultCategory,
        pid: project.pid, // Include PID for display
        markup: project.markup || 0,
        discount: project.discount || 0,
        offers: appliedOffers.map((offer) => ({
          offerType: offer.offerType,
          percentageValue: offer.percentageValue,
          cashValue: offer.cashValue,
        })),
        createdAt: project.createdAt,
        rooms: rooms.map(room => {
          const roomLineItems = lineItems.filter(li => li.roomId === room.id);
          const roomSubcategories = subcategories.filter(sc => sc.roomId === room.id);
          return {
            roomName: room.roomName,
            roomType: room.roomType,
            // Kept for backward compatibility with older cached clients: the full flat
            // list of this room's line items, same shape as before sub-categories existed.
            lineItems: roomLineItems.map(toPublicLineItem),
            // New optional grouping layer. Empty when the room has no sub-categories.
            subcategories: roomSubcategories.map(sc => ({
              name: sc.name,
              lineItems: roomLineItems.filter(li => li.subcategoryId === sc.id).map(toPublicLineItem),
            })),
            // Items not in any sub-category (or all of them, when the room has none)
            ungroupedLineItems: roomLineItems.filter(li => !li.subcategoryId).map(toPublicLineItem),
          };
        }),
      });
    } catch (error: any) {
      console.error("Error fetching shared quote:", error);
      res.status(500).json({ error: error.message || "Failed to fetch quote" });
    }
  });

  // ==================== COMPANY SETTINGS ROUTES ====================
  
  // Upload company logo (admin only) - using multer for secure file handling
  // Wrapper to handle multer errors properly with 400 responses
  app.post("/api/admin/upload-logo", requireAdmin, (req: Request, res: Response, next: any) => {
    logoUpload.single('logo')(req, res, async (err: any) => {
      if (err) {
        // Handle multer-specific errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: "File too large. Maximum size is 2MB." });
        }
        if (err.message) {
          return res.status(400).json({ error: err.message });
        }
        return res.status(400).json({ error: "Failed to upload file" });
      }
      
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No logo file provided" });
        }
        
        // Return the URL path to the logo
        const logoUrl = `/uploads/${req.file.filename}`;
        
        // Update company settings with new logo URL
        await storage.updateCompanySettings({ logoUrl });
        
        res.json({ logoUrl });
      } catch (error: any) {
        console.error("Error saving logo:", error);
        res.status(500).json({ error: error.message || "Failed to save logo" });
      }
    });
  });
  
  // Get company settings (admin only)
  app.get("/api/admin/settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getCompanySettings();
      res.json(settings || {});
    } catch (error: any) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch settings" });
    }
  });
  
  // Update company settings (admin only) - with Zod validation
  const updateCompanySettingsSchema = z.object({
    appName: z.string().max(100).optional(),
    companyName: z.string().max(255).optional(),
    logoUrl: z.string().max(500).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    pincode: z.string().max(10).optional(),
    phone: z.string().max(20).optional(),
    email: z.string().email().max(255).optional().or(z.literal('')),
    website: z.string().max(255).optional(),
    gstNumber: z.string().max(20).optional(),
    panNumber: z.string().max(15).optional(),
    bankName: z.string().max(100).optional(),
    bankAccountNumber: z.string().max(30).optional(),
    bankIfscCode: z.string().max(15).optional(),
    termsAndConditions: z.string().max(2000).optional(),
    dimensionDisplayUnit: z.enum(["feet", "mm"]).optional(),
  });

  app.patch("/api/admin/settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const validationResult = updateCompanySettingsSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid settings data", 
          details: validationResult.error.errors 
        });
      }
      
      const updatedSettings = await storage.updateCompanySettings(validationResult.data);
      res.json(updatedSettings);
    } catch (error: any) {
      console.error("Error updating company settings:", error);
      res.status(500).json({ error: error.message || "Failed to update settings" });
    }
  });
  
  // Get company settings for public views (shared quotes, login page)
  const getPublicCompanySettings = async (_req: Request, res: Response) => {
    try {
      const settings = await storage.getCompanySettings();
      if (!settings) {
        return res.json({});
      }
      // Return only public-safe fields for client views
      res.json({
        appName: settings.appName,
        companyName: settings.companyName,
        logoUrl: settings.logoUrl,
        address: settings.address,
        city: settings.city,
        state: settings.state,
        pincode: settings.pincode,
        phone: settings.phone,
        email: settings.email,
        website: settings.website,
        gstNumber: settings.gstNumber,
        termsAndConditions: settings.termsAndConditions,
        dimensionDisplayUnit: settings.dimensionDisplayUnit,
      });
    } catch (error: any) {
      console.error("Error fetching public company settings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch settings" });
    }
  };
  
  app.get("/api/company-settings", getPublicCompanySettings);
  app.get("/api/company-settings/public", getPublicCompanySettings);

  // Generate PDF for a project quotation
  app.post("/api/projects/:id/pdf", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userId = req.session.userId!;
      const userRole = req.session.role || "user";
      const { showDetailedPricing = false } = req.body;

      // Check authorization
      const hasAccess = await canAccessProject(userId, userRole, projectId);
      if (!hasAccess) {
        return res.status(403).json({ error: "Not authorized to access this project" });
      }

      // Get project data
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const rooms = await storage.getRoomsByProject(projectId);
      const [lineItems, appliedOffers] = await Promise.all([
        storage.getLineItemsByProject(projectId),
        db.select().from(projectOffers).where(eq(projectOffers.projectId, projectId)),
      ]);
      const subcategories = await storage.getRoomSubcategoriesByProject(projectId);
      const companySettings = await storage.getCompanySettings();

      const [credits] = await db.select().from(projectCredits).where(eq(projectCredits.projectId, projectId));
      const projectMilestones = await db.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(milestones.createdAt);
      const walletEntries = credits ? await db.select().from(walletFundingEntries).where(eq(walletFundingEntries.projectId, projectId)).orderBy(walletFundingEntries.createdAt) : [];

      const markup = project.markup || 0;
      const discount = project.discount || 0;
      
      const {
        categoryTotals,
        woodworksSubtotal, woodworksDiscountValue, woodworksAfterDiscount,
        woodworksGst, woodworksTotal,
        enablementFeeValue, enablementFeeGst, enablementFeeTotal,
        servicesSubtotal, servicesGst, servicesTotal,
        accessoriesTotal, furnitureTotal, totalGst, grandTotal,
        offerPercentageDiscount, cashDiscount, finalPayable,
      } = computeQuotationTotals(lineItems, markup, discount, appliedOffers);

      // Format currency with no decimals (rounded to whole numbers)
      const formatCurrency = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;
      const formatDate = (date: Date) => {
        const d = new Date(date);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${d.getDate().toString().padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
      };

      // Sort line items by category order: Woodwork → Accessories → Handles → Services → Lights → Stone
      const CATEGORY_SORT_ORDER: Record<string, number> = {
        woodworks: 1,
        accessories: 2,
        handles: 3,
        services: 4,
        lights: 5,
        stone: 6
      };
      
      const sortLineItemsByCategory = (items: typeof lineItems) => {
        return [...items].sort((a, b) => {
          const orderA = CATEGORY_SORT_ORDER[a.itemType || "woodworks"] || 99;
          const orderB = CATEGORY_SORT_ORDER[b.itemType || "woodworks"] || 99;
          return orderA - orderB;
        });
      };
      
      // Determine dimension display unit
      const useMm = companySettings?.dimensionDisplayUnit === "mm";
      const dimensionUnit = useMm ? "mm" : "ft";

      // Generate HTML content
      // Builds one <table> (header + rows + subtotal footer) for a set of line items.
      // Used both for a room with no sub-categories (whole room in one table, exactly
      // as before this feature existed) and for each sub-category / ungrouped group.
      const renderLineItemsTable = (items: typeof lineItems, subtotalLabel: string) => {
        const sortedItems = sortLineItemsByCategory(items);
        const subtotal = computeRoomSubtotalDisplay(sortedItems, discount);
        // A complimentary item's ₹0/offer label needs the "Amount After Discount"
        // column even when no project-level discount is set, so it isn't hidden.
        const hasComplimentary = sortedItems.some(li => li.isComplimentary);
        const showDiscountCol = discount > 0 || hasComplimentary;

        const discountCol = showDiscountCol ? `<th style="text-align: right; padding: 8px 12px; font-size: 12px;">Amount After Discount</th>` : '';
        const headerColumns = showDetailedPricing
          ? `<th style="text-align: left; padding: 8px 12px; border-right: 1px solid #d1d5db; font-size: 12px;">Description</th>
             <th style="text-align: center; padding: 8px 6px; border-right: 1px solid #d1d5db; white-space: nowrap; font-size: 12px;">Dimensions (${dimensionUnit})</th>
             <th style="text-align: center; padding: 8px 6px; border-right: 1px solid #d1d5db; font-size: 12px;">Qty</th>
             <th style="text-align: right; padding: 8px 12px; border-right: 1px solid #d1d5db; font-size: 12px;">Amount</th>
             ${discountCol}`
          : `<th style="text-align: left; padding: 8px 12px; border-right: 1px solid #d1d5db; font-size: 12px;">Description</th>
             <th style="text-align: right; padding: 8px 12px; ${showDiscountCol ? 'border-right: 1px solid #d1d5db;' : ''} font-size: 12px;">Amount</th>
             ${discountCol}`;

        const rowsHtml = sortedItems.map((li, index) => {
          const bgColor = index % 2 === 0 ? '#ffffff' : '#f9fafb';
          
          // Check if item has dimensions (non-zero length and height)
          const hasDimensions = li.lengthFt > 0 && li.heightFt > 0;
          let dimensionDisplay = "N/A";
          if (hasDimensions) {
            if (useMm) {
              const lengthMm = li.lengthMm || Math.round(li.lengthFt * 304.8);
              const heightMm = li.heightMm || Math.round(li.heightFt * 304.8);
              dimensionDisplay = `${lengthMm} × ${heightMm} mm`;
            } else {
              dimensionDisplay = `${li.lengthFt} × ${li.heightFt} ft`;
            }
          }
          
          const isWoodwork = (li.itemType || "woodworks") === "woodworks";
          const discountCellHtml = showDiscountCol
            ? (li.isComplimentary
                ? `<td style="text-align: right; padding: 8px 12px; font-size: 12px;"><div style="color: #6b7280; font-size: 11px;">Complimentary (${li.complimentaryOfferName || ''})</div><div style="font-family: monospace; font-weight: 600;">${formatCurrency(0)}</div></td>`
                : `<td style="text-align: right; padding: 8px 12px; font-family: monospace; font-size: 12px;">${discount > 0 ? (isWoodwork ? formatCurrency(li.amount * (1 - discount / 100)) : 'Not Applicable') : 'Not Applicable'}</td>`)
            : '';
          const productImageHtml = li.imageUrl
            ? `<img src="${li.imageUrl}" alt="" style="width: 52px; height: 52px; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 4px; flex: 0 0 auto;" />`
            : '';
          const descriptionHtml = `<div style="display: flex; align-items: center; gap: 8px;">${productImageHtml}<span>${li.description}</span></div>`;
          const columns = showDetailedPricing
            ? `<td style="padding: 8px 12px; border-right: 1px solid #e5e7eb; font-size: 12px; line-height: 1.3;">${descriptionHtml}</td>
               <td style="text-align: center; padding: 8px 6px; border-right: 1px solid #e5e7eb; white-space: nowrap; font-size: 12px;">${dimensionDisplay}</td>
               <td style="text-align: center; padding: 8px 6px; border-right: 1px solid #e5e7eb; font-size: 12px;">${li.quantity}</td>
               <td style="text-align: right; padding: 8px 12px; font-family: monospace; font-weight: 500; font-size: 12px; ${showDiscountCol ? 'border-right: 1px solid #e5e7eb;' : ''}">${formatCurrency(li.amount)}</td>
               ${discountCellHtml}`
            : `<td style="padding: 8px 12px; border-right: 1px solid #e5e7eb; font-size: 12px; line-height: 1.3;">${descriptionHtml}</td>
               <td style="text-align: right; padding: 8px 12px; font-family: monospace; font-weight: 500; font-size: 12px; ${showDiscountCol ? 'border-right: 1px solid #e5e7eb;' : ''}">${formatCurrency(li.amount)}</td>
               ${discountCellHtml}`;

          return `<tr style="background-color: ${bgColor}; border-bottom: 1px solid #d1d5db;">${columns}</tr>`;
        }).join('');

        const footerColspan = showDetailedPricing ? 3 : 1;
        const footerTotalColumns = footerColspan + 1 + (showDiscountCol ? 1 : 0);

        return `
          <table style="width: 100%; font-size: 13px; border-collapse: collapse; border: 1px solid #d1d5db;">
            <thead>
              <tr style="background-color: #e5e7eb; border-bottom: 2px solid #9ca3af;">
                ${headerColumns}
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
              <tr style="background-color: #f3f4f6; border-top: 2px solid #9ca3af;">
                <td colspan="${footerTotalColumns}" style="text-align: right; padding: 8px 12px; font-size: 12px;">
                  <div style="font-weight: 600;">${subtotalLabel} (After Discount): <span style="font-family: monospace; font-weight: bold; margin-left: 16px;">${formatCurrency(subtotal.afterDiscount)}</span></div>
                  <div style="color: #6b7280; font-size: 11px; margin-top: 3px;">Pre-Discount: <span style="font-family: monospace; margin-left: 16px;">${formatCurrency(subtotal.preDiscount)}</span></div>
                </td>
              </tr>
            </tfoot>
          </table>
        `;
      };

      const roomsHtml = rooms.map(room => {
        const roomLineItems = lineItems.filter(li => li.roomId === room.id);
        if (roomLineItems.length === 0) return '';

        const roomSubtotal = computeRoomSubtotalDisplay(roomLineItems, discount);
        // Room's own style override, falling back to the project default when unset,
        // stripped of the "DeX - " prefix for a friendly label.
        const roomVariantLabel = (room.category || project.defaultCategory || '').replace(/^DeX - /, '');

        const roomSubcategories = subcategories.filter(sc => sc.roomId === room.id);
        const ungroupedItems = roomLineItems.filter(li => !li.subcategoryId);

        const bodyHtml = roomSubcategories.length === 0
          ? renderLineItemsTable(roomLineItems, 'Room Subtotal')
          : `
            <div style="display: flex; flex-direction: column; gap: 12px;">
              ${roomSubcategories.map(sc => {
                const items = roomLineItems.filter(li => li.subcategoryId === sc.id);
                if (items.length === 0) return '';
                return `
                  <div>
                    <h4 style="margin: 0 0 4px 0; font-weight: 600; font-size: 13px;">${sc.name}</h4>
                    ${renderLineItemsTable(items, 'Subtotal')}
                  </div>
                `;
              }).join('')}
              ${ungroupedItems.length > 0 ? `
                <div>
                  <h4 style="margin: 0 0 4px 0; font-weight: 600; font-size: 13px; color: #6b7280;">Other Items</h4>
                  ${renderLineItemsTable(ungroupedItems, 'Subtotal')}
                </div>
              ` : ''}
              <div style="text-align: right; font-size: 13px; padding: 4px 0;">
                <div><span style="font-weight: 600;">Room Sub Total (After Discount): </span><span style="font-family: monospace; font-weight: bold;">${formatCurrency(roomSubtotal.afterDiscount)}</span></div>
                <div style="color: #6b7280; font-size: 11px; margin-top: 3px;">Pre-Discount: <span style="font-family: monospace;">${formatCurrency(roomSubtotal.preDiscount)}</span></div>
              </div>
            </div>
          `;

        return `
          <div class="room-section" style="margin-bottom: 20px;">
            <div class="room-header" style="background-color: #f3f4f6; padding: 6px 12px; margin-bottom: 6px;">
              <h3 style="margin: 0; font-weight: 600; font-size: 14px;">${room.roomName}${roomVariantLabel ? ` (${roomVariantLabel})` : ''}</h3>
              <span style="font-size: 12px; color: #6b7280;">${room.roomType}</span>
            </div>
            ${bodyHtml}
          </div>
        `;
      }).join('');

      // Build summary section with enablement fee as separate line
      let summaryHtml = '';
      if (categoryTotals.woodworks > 0) {
        summaryHtml += `
          <tr><td style="padding: 4px 0; color: #6b7280;">Woodworks Subtotal</td><td style="text-align: right; padding: 4px 0; font-family: monospace;">${formatCurrency(woodworksSubtotal)}</td></tr>
        `;
        if (discount > 0) {
          summaryHtml += `
            <tr><td style="padding: 4px 0; color: #6b7280;">Discount (${discount}%)</td><td style="text-align: right; padding: 4px 0; font-family: monospace; color: #16a34a;">-${formatCurrency(woodworksDiscountValue)}</td></tr>
          `;
        }
        summaryHtml += `
          <tr><td style="padding: 4px 0; color: #6b7280;">GST on Woodworks (18%)</td><td style="text-align: right; padding: 4px 0; font-family: monospace;">${formatCurrency(woodworksGst)}</td></tr>
          <tr style="border-bottom: 1px solid #d1d5db;"><td style="padding: 4px 0; font-weight: 600;">Woodworks Total</td><td style="text-align: right; padding: 4px 0; font-family: monospace; font-weight: 600;">${formatCurrency(woodworksTotal)}</td></tr>
        `;
      }
      if (categoryTotals.services > 0) {
        summaryHtml += `
          <tr><td style="padding: 8px 0 4px 0; color: #6b7280;">Services Subtotal</td><td style="text-align: right; padding: 8px 0 4px 0; font-family: monospace;">${formatCurrency(servicesSubtotal)}</td></tr>
          <tr><td style="padding: 4px 0; color: #6b7280;">GST on Services (18%)</td><td style="text-align: right; padding: 4px 0; font-family: monospace;">${formatCurrency(servicesGst)}</td></tr>
          <tr style="border-bottom: 1px solid #d1d5db;"><td style="padding: 4px 0; font-weight: 600;">Services Total</td><td style="text-align: right; padding: 4px 0; font-family: monospace; font-weight: 600;">${formatCurrency(servicesTotal)}</td></tr>
        `;
      }
      if (categoryTotals.accessories > 0) {
        summaryHtml += `
          <tr style="border-bottom: 1px solid #d1d5db;"><td style="padding: 8px 0 4px 0; font-weight: 600;">Accessories Total (GST Inclusive)</td><td style="text-align: right; padding: 8px 0 4px 0; font-family: monospace; font-weight: 600;">${formatCurrency(accessoriesTotal)}</td></tr>
        `;
      }
      if (categoryTotals.furniture > 0) {
        summaryHtml += `
          <tr style="border-bottom: 1px solid #d1d5db;"><td style="padding: 8px 0 4px 0; font-weight: 600;">Furniture Total (GST Inclusive)</td><td style="text-align: right; padding: 8px 0 4px 0; font-family: monospace; font-weight: 600;">${formatCurrency(furnitureTotal)}</td></tr>
        `;
      }
      if (markup > 0 && categoryTotals.woodworks > 0) {
        summaryHtml += `
          <tr style="border-bottom: 1px solid #d1d5db;"><td style="padding: 8px 0 4px 0; font-weight: 600;">Enablement Fee (${markup}%) + GST (18%)</td><td style="text-align: right; padding: 8px 0 4px 0; font-family: monospace; font-weight: 600;">${formatCurrency(enablementFeeTotal)}</td></tr>
        `;
      }

      // Build payment schedule HTML
      let paymentScheduleHtml = '';
      const ps = computePaymentSchedule(finalPayable);
      if (ps.grandTotal > 0) {
        paymentScheduleHtml = `
          <section style="border-top: 2px solid #1f2937; padding-top: 12px; margin-top: 24px; page-break-inside: avoid;">
            <h3 style="font-weight: 600; font-size: 16px; margin-bottom: 12px;">Payment Schedule (${ps.tier})</h3>
            <table style="width: 100%; font-size: 13px; border-collapse: collapse; border: 1px solid #d1d5db;">
              <thead>
                <tr style="background-color: #e5e7eb; border-bottom: 2px solid #9ca3af;">
                  <th style="text-align: left; padding: 8px 12px; font-size: 12px;">Payment Stage</th>
                  <th style="text-align: right; padding: 8px 12px; font-size: 12px;">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 8px 12px; font-size: 12px;">Onboarding Amount</td>
                  <td style="text-align: right; padding: 8px 12px; font-family: monospace; font-size: 12px;">${formatCurrency(ps.tokenAdvance)}</td>
                </tr>
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 8px 12px; font-size: 12px;">Pre Sign-off - 30%</td>
                  <td style="text-align: right; padding: 8px 12px; font-family: monospace; font-size: 12px;">${formatCurrency(ps.preSignoff)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 8px 12px; font-size: 12px;">Design Sign Off - 30%</td>
                  <td style="text-align: right; padding: 8px 12px; font-family: monospace; font-size: 12px;">${formatCurrency(ps.designSignoff)}</td>
                </tr>
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 8px 12px; font-size: 12px;">Upon Modular Material Delivery - 40%</td>
                  <td style="text-align: right; padding: 8px 12px; font-family: monospace; font-size: 12px;">${formatCurrency(ps.materialDelivery)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 8px 12px; font-size: 12px;">Retention Amount</td>
                  <td style="text-align: right; padding: 8px 12px; font-family: monospace; font-size: 12px;">${formatCurrency(ps.retention)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr style="background-color: #f3f4f6; border-top: 2px solid #9ca3af;">
                  <td style="padding: 8px 12px; font-weight: 600; font-size: 12px;">Total</td>
                  <td style="text-align: right; padding: 8px 12px; font-family: monospace; font-weight: bold; font-size: 12px;">${formatCurrency(ps.total)}</td>
                </tr>
              </tfoot>
            </table>
          </section>`;
      }

      // Build credits HTML
      let creditsHtml = '';
      if (credits) {
        const totalCredits = credits.totalCredits || 0;
        const usedCredits = credits.usedCredits || 0;
        const availableCredits = credits.availableCredits || 0;
        if (totalCredits > 0 || projectMilestones.length > 0) {
          let milestonesHtml = '';
          if (projectMilestones.length > 0) {
            const msRows = projectMilestones.map((m, i) => {
              const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
              const statusColor = m.status === 'approved' ? '#16a34a' : m.status === 'submitted' ? '#d97706' : m.status === 'rejected' ? '#dc2626' : '#6b7280';
              const typeName = (m.milestoneType || 'N/A').replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
              return `<tr style="background-color: ${bg}; border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 6px 12px; font-size: 11px;">${typeName}</td>
                <td style="text-align: center; padding: 6px 12px; font-size: 11px;">${m.creditAmount} Credits</td>
                <td style="text-align: center; padding: 6px 12px; font-size: 11px;"><span style="color: ${statusColor}; font-weight: 500;">${(m.status || 'pending').charAt(0).toUpperCase() + (m.status || 'pending').slice(1)}</span></td>
              </tr>`;
            }).join('');
            milestonesHtml = `
              <div style="margin-top: 12px;">
                <h4 style="font-weight: 600; font-size: 13px; margin-bottom: 6px;">Milestones</h4>
                <table style="width: 100%; font-size: 12px; border-collapse: collapse; border: 1px solid #d1d5db;">
                  <thead>
                    <tr style="background-color: #e5e7eb; border-bottom: 1px solid #9ca3af;">
                      <th style="text-align: left; padding: 6px 12px; font-size: 11px;">Milestone</th>
                      <th style="text-align: center; padding: 6px 12px; font-size: 11px;">Credits</th>
                      <th style="text-align: center; padding: 6px 12px; font-size: 11px;">Status</th>
                    </tr>
                  </thead>
                  <tbody>${msRows}</tbody>
                </table>
              </div>`;
          }
          creditsHtml = `
            <section style="border-top: 2px solid #1f2937; padding-top: 12px; margin-top: 24px; page-break-inside: avoid;">
              <h3 style="font-weight: 600; font-size: 16px; margin-bottom: 12px;">Design Credits</h3>
              <table style="width: 50%; font-size: 13px;">
                <tbody>
                  <tr><td style="padding: 4px 0; color: #6b7280;">Total Credits:</td><td style="text-align: right; padding: 4px 0; font-weight: 600;">${totalCredits} Credits</td></tr>
                  <tr><td style="padding: 4px 0; color: #6b7280;">Used Credits:</td><td style="text-align: right; padding: 4px 0; font-weight: 600;">${usedCredits} Credits</td></tr>
                  <tr><td style="padding: 4px 0; color: #6b7280;">Available Credits:</td><td style="text-align: right; padding: 4px 0; font-weight: 600;">${availableCredits} Credits</td></tr>
                </tbody>
              </table>
              ${milestonesHtml}
            </section>`;
        }
      }

      // Load logo as base64 for embedding in PDF
      let logoBase64 = '';
      if (companySettings?.logoUrl) {
        try {
          const logoUrl = companySettings.logoUrl;
          if (logoUrl.startsWith('/uploads/')) {
            const filePath = path.join(process.cwd(), logoUrl);
            if (fs.existsSync(filePath)) {
              const fileBuffer = fs.readFileSync(filePath);
              const ext = path.extname(filePath).toLowerCase();
              const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
              const contentType = mimeMap[ext] || 'image/png';
              logoBase64 = `data:${contentType};base64,${fileBuffer.toString('base64')}`;
            }
          } else {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const logoResponse = await fetch(logoUrl, { signal: controller.signal });
            clearTimeout(timeout);
            if (logoResponse.ok) {
              const logoBuffer = await logoResponse.arrayBuffer();
              const contentType = logoResponse.headers.get('content-type') || 'image/png';
              logoBase64 = `data:${contentType};base64,${Buffer.from(logoBuffer).toString('base64')}`;
            }
          }
        } catch (logoErr) {
          console.warn("Failed to load logo for PDF:", logoErr);
        }
      }

      const logoHtml = logoBase64 
        ? `<img src="${logoBase64}" alt="Logo" style="height: 56px; width: auto; object-fit: contain; margin-right: 16px;" />`
        : '';

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; color: #111827; line-height: 1.4; font-size: 13px; }
            tr { page-break-inside: avoid; break-inside: avoid; }
            .room-section { page-break-inside: auto; break-inside: auto; }
            .room-header { page-break-after: avoid; break-after: avoid; }
            table { page-break-inside: auto; }
            thead { display: table-header-group; }
            tfoot { display: table-footer-group; }
          </style>
        </head>
        <body>
          <header style="border-bottom: 2px solid #1f2937; padding-bottom: 12px; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div style="display: flex; align-items: flex-start;">
                ${logoHtml}
                <div>
                  <h1 style="font-size: 22px; font-weight: bold; color: #111827; margin-bottom: 2px;">${companySettings?.companyName || 'QUOTATION'}</h1>
                  ${companySettings?.address ? `<p style="font-size: 12px; color: #4b5563; margin: 1px 0;">${companySettings.address}</p>` : ''}
                  ${companySettings?.city || companySettings?.state ? `<p style="font-size: 12px; color: #4b5563; margin: 1px 0;">${[companySettings.city, companySettings.state, companySettings.pincode].filter(Boolean).join(', ')}</p>` : ''}
                  ${companySettings?.phone ? `<p style="font-size: 12px; color: #4b5563; margin: 1px 0;">Tel: ${companySettings.phone}</p>` : ''}
                  ${companySettings?.email ? `<p style="font-size: 12px; color: #4b5563; margin: 1px 0;">${companySettings.email}</p>` : ''}
                  ${companySettings?.gstNumber ? `<p style="font-size: 12px; color: #4b5563; font-weight: 600; margin: 1px 0;">GSTIN: ${companySettings.gstNumber}</p>` : ''}
                </div>
              </div>
              <div style="text-align: right;">
                <h2 style="font-size: 18px; font-weight: bold; color: #111827; margin-bottom: 6px;">QUOTATION</h2>
                <p style="font-size: 12px; color: #4b5563;">Date: ${formatDate(new Date())}</p>
                <p style="font-size: 12px; color: #4b5563;">Quote #: ${project.pid || `QB-${project.id.slice(0, 8).toUpperCase()}`}</p>
              </div>
            </div>
          </header>

          <section style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between;">
              <div>
                <h3 style="font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Client Details</h3>
                <p style="font-weight: 600; font-size: 16px;">${project.clientName}</p>
                <p style="color: #4b5563; font-size: 13px;">${project.projectType} Project</p>
              </div>
              <div style="text-align: right;">
                <h3 style="font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Category</h3>
                <p style="font-weight: 600; font-size: 14px;">${project.multiStyleEnabled ? 'MSP (Multi Style Purpose)' : project.defaultCategory}</p>
              </div>
            </div>
          </section>

          ${roomsHtml}

          <section style="border-top: 2px solid #1f2937; padding-top: 12px; margin-top: 24px;">
            <h3 style="font-weight: 600; font-size: 16px; margin-bottom: 12px;">Summary</h3>
            <table style="width: 100%; font-size: 13px;">
              <tbody>
                ${summaryHtml}
                <tr>
                  <td style="padding: 6px 0; font-weight: 600;">GST-inclusive Total</td>
                  <td style="text-align: right; padding: 6px 0; font-family: monospace; font-weight: 600;">${formatCurrency(grandTotal)}</td>
                </tr>
                ${offerPercentageDiscount > 0 ? `<tr><td style="padding: 4px 0; color: #6b7280;">Offer Discount (%)</td><td style="text-align: right; padding: 4px 0; font-family: monospace; color: #16a34a;">-${formatCurrency(offerPercentageDiscount)}</td></tr>` : ''}
                ${cashDiscount > 0 ? `<tr><td style="padding: 4px 0; color: #6b7280;">Cash Discount (after GST)</td><td style="text-align: right; padding: 4px 0; font-family: monospace; color: #16a34a;">-${formatCurrency(cashDiscount)}</td></tr>` : ''}
                <tr style="font-size: 16px; border-top: 1px solid #d1d5db;">
                  <td style="padding: 10px 0; font-weight: bold;">FINAL PAYABLE AMOUNT</td>
                  <td style="text-align: right; padding: 10px 0; font-family: monospace; font-weight: bold; font-size: 18px;">${formatCurrency(finalPayable)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          ${paymentScheduleHtml}

          ${creditsHtml}

          <footer style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #d1d5db; font-size: 13px; color: #4b5563;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb;">
              <div>
                <span style="font-size: 11px;">Total GST: <strong>${formatCurrency(totalGst)}</strong></span>
              </div>
              <div style="text-align: right;">
                <span style="font-size: 10px; color: #9ca3af;">Generated by ${companySettings?.companyName || 'Quote Builder'}</span>
              </div>
            </div>
            
            <div>
              <h4 style="font-weight: 600; margin-bottom: 8px; font-size: 12px;">Terms & Conditions</h4>
              ${companySettings?.termsAndConditions 
                ? `<div style="font-size: 10px; line-height: 1.5; white-space: pre-line; column-count: 2; column-gap: 20px;">${companySettings.termsAndConditions}</div>`
                : `<ul style="font-size: 10px; list-style: disc; padding-left: 16px; line-height: 1.5;">
                    <li>Quote valid for 30 days from date of issue</li>
                    <li>50% advance payment required to confirm order</li>
                    <li>Delivery timeline subject to material availability</li>
                    <li>Installation charges included where applicable</li>
                  </ul>`
              }
            </div>
          </footer>
        </body>
        </html>
      `;

      // Generate PDF with Puppeteer using system-installed Chromium
      console.log("Launching Puppeteer browser...");
      let browser;
      try {
        const chromiumPath = getChromiumPath();
        console.log("Using Chromium at:", chromiumPath);
        
        browser = await puppeteer.launch({
          headless: true,
          executablePath: chromiumPath,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
        });
        console.log("Browser launched successfully");
      } catch (launchError: any) {
        console.error("Failed to launch browser:", launchError);
        return res.status(500).json({ error: "Failed to launch PDF generator: " + launchError.message });
      }
      
      try {
        const page = await browser.newPage();
        console.log("Setting HTML content...");
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        console.log("Generating PDF...");
        const pdfBuffer = await page.pdf({
          format: 'A4',
          margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
          printBackground: true
        });
        
        console.log("PDF generated, size:", pdfBuffer.length, "bytes");
        await browser.close();

        // Send PDF as binary data
        const filename = `Quotation-${project.clientName.replace(/[^a-zA-Z0-9]/g, '-')}-${formatDate(new Date()).replace(/ /g, '-')}.pdf`;
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': pdfBuffer.length.toString()
        });
        return res.end(pdfBuffer);
        
      } catch (pdfError: any) {
        console.error("PDF generation error:", pdfError);
        await browser.close();
        return res.status(500).json({ error: "Failed to generate PDF: " + pdfError.message });
      }

    } catch (error: any) {
      console.error("Error generating PDF:", error);
      return res.status(500).json({ error: error.message || "Failed to generate PDF" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
