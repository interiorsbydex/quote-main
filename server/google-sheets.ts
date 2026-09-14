import { google } from 'googleapis';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('Google Sheets connection not configured. Please contact your administrator.');
  }

  if (!hostname) {
    throw new Error('Google Sheets connection not configured. Please contact your administrator.');
  }

  try {
    connectionSettings = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-sheet',
      {
        headers: {
          'Accept': 'application/json',
          'X-Replit-Token': xReplitToken
        }
      }
    ).then(res => res.json()).then(data => data.items?.[0]);
  } catch (error: any) {
    console.error('Error fetching Google Sheets connection:', error);
    throw new Error('Unable to connect to Google Sheets. Please check your connection settings or try again later.');
  }

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Sheets not connected. Please reconnect in the Replit integrations panel.');
  }
  return accessToken;
}

export async function getUncachableGoogleSheetClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.sheets({ version: 'v4', auth: oauth2Client });
}

export interface CatalogItem {
  id: string;
  /** The row's stable code in the sheet. Absent on legacy rows that never got one. */
  itemCode?: string;
  categoryName: "Economy" | "Lite Premium" | "Premium" | "Luxury";
  roomType: "Wet / Exposed" | "Dry / Inexposed";
  unitType: string;
  materialType?: string;
  brand?: string;
  description: string;
  rate: number;
  markup: number;
  sellingPrice: number;
  imageUrl?: string;
}

export interface MaterialSpec {
  coreMaterial?: string;
  finishMaterial?: string;
  hinges?: string;
  brand?: string;
  laminateType?: string;
}

// Helper function to parse multi-select cells (comma/semicolon delimited)
export function parseMultiSelectCell(cellValue: string | undefined | null): string[] {
  if (!cellValue || typeof cellValue !== 'string') {
    return [];
  }

  const trimmed = cellValue.trim();
  if (!trimmed) {
    return [];
  }

  // Handle quoted values like: "Oak, Walnut", "Teak"
  // Also handle simple comma or semicolon separated values
  const delimiters = /[,;]/;
  
  // Split by delimiter and clean up each value
  const values = trimmed
    .split(delimiters)
    .map(value => {
      // Remove surrounding quotes and trim whitespace
      return value.trim().replace(/^["']|["']$/g, '').trim();
    })
    .filter(value => value.length > 0); // Remove empty strings

  return values;
}

// Helper function to safely parse numeric values
export function parseNumericValue(value: any, defaultValue: number = 0): number {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Row validation result
interface RowValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Cache for catalog data (5-10 minute TTL)
let catalogCache: CatalogItem[] | null = null;
let materialSpecsCache: Map<string, MaterialSpec> = new Map();
let lastFetchTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchCatalogFromSheets(spreadsheetId: string, force = false): Promise<CatalogItem[]> {
  const now = Date.now();
  
  // Return cached data if still valid
  if (!force && catalogCache && (now - lastFetchTime) < CACHE_TTL) {
    console.log('Returning cached catalog data');
    return catalogCache;
  }

  try {
    const sheets = await getUncachableGoogleSheetClient();
    const categories = ["Economy", "Lite Premium", "Premium", "Luxury"] as const;
    
    const allItems: CatalogItem[] = [];
    let itemId = 1;
    let successfulCategories = 0;
    const errors: string[] = [];

    for (const category of categories) {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${category}!A2:M`,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
          console.warn(`No data found in ${category} sheet`);
          continue;
        }

        let categoryItemCount = 0;
        for (const row of rows) {
          // NO FILTERING - Sync ALL rows from Google Sheets (app is a mirror/wrapper)
          // Only skip completely empty rows
          if (!row || row.length === 0) continue;

          const [projectType, section, roomType, unitType, panelType, itemCategory, 
                 materialType, brand, description, rate, markup, markupValue, sellingPrice] = row;
          
          // Parse numeric values - use 0 for invalid/empty values (no filtering)
          const parsedRate = parseFloat(rate);
          const parsedMarkup = parseFloat(markup);
          const parsedSellingPrice = parseFloat(sellingPrice);

          // NO normalization - store RAW values from Google Sheets
          allItems.push({
            id: `cat_${itemId++}`,
            categoryName: category,
            roomType: roomType || '',               // RAW value preserved
            unitType: unitType || '',                // RAW value preserved (not "General")
            materialType: materialType || undefined,
            brand: brand || undefined,
            description: description || '',
            rate: isNaN(parsedRate) ? 0 : parsedRate,
            markup: isNaN(parsedMarkup) ? 0 : parsedMarkup,
            sellingPrice: isNaN(parsedSellingPrice) ? 0 : parsedSellingPrice,
          });
          categoryItemCount++;
        }

        if (rows.length > 0) {
          const specs: MaterialSpec = {};
          const sampleRows = rows.slice(0, Math.min(10, rows.length));
          const materials = sampleRows.map(r => r[6]).filter(Boolean);
          const brands = sampleRows.map(r => r[7]).filter(Boolean);
          
          if (materials.length > 0) {
            specs.coreMaterial = materials.find(m => m.toLowerCase().includes("plywood") || m.toLowerCase().includes("mdf"));
            specs.finishMaterial = materials.find(m => m.toLowerCase().includes("laminate") || m.toLowerCase().includes("veneer"));
          }
          
          if (brands.length > 0) {
            specs.brand = brands[0];
            specs.hinges = brands.find(b => b.toLowerCase().includes("hettich") || b.toLowerCase().includes("ebco"));
          }

          materialSpecsCache.set(category, specs);
        }

        console.log(`Successfully fetched ${categoryItemCount} items from ${category} sheet`);
        successfulCategories++;
      } catch (error: any) {
        const errorMsg = `Error fetching ${category} sheet: ${error.message}`;
        console.error(errorMsg, error);
        errors.push(errorMsg);
      }
    }

    // If we got at least some data, cache it and return
    if (allItems.length > 0) {
      catalogCache = allItems;
      lastFetchTime = now;
      console.log(`Successfully refreshed catalog: ${allItems.length} items from ${successfulCategories}/${categories.length} categories`);
      return allItems;
    }

    // If we got no data but have cached data, return the cache with a warning
    if (catalogCache && catalogCache.length > 0) {
      console.warn('Failed to fetch fresh catalog data, returning stale cache');
      return catalogCache;
    }

    // No data and no cache - throw an error
    throw new Error(
      errors.length > 0 
        ? `Failed to load catalog: ${errors.join('; ')}`
        : 'No catalog data available. The spreadsheet may be empty or incorrectly formatted.'
    );

  } catch (error: any) {
    console.error('Error in fetchCatalogFromSheets:', error);
    
    // Return cached data if available, even if expired
    if (catalogCache && catalogCache.length > 0) {
      console.warn('Returning stale cached catalog due to fetch error');
      return catalogCache;
    }

    // Re-throw with user-friendly message
    if (error.message.includes('not connected') || error.message.includes('not configured')) {
      throw error;
    } else if (error.message.includes('spreadsheet')) {
      throw new Error('Unable to access the Google Sheet. Please verify the spreadsheet ID and permissions.');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      throw new Error('Network error: Unable to reach Google Sheets. Please check your internet connection.');
    } else {
      throw new Error(`Failed to load catalog data: ${error.message}`);
    }
  }
}

export function getCachedCatalog(): CatalogItem[] | null {
  return catalogCache;
}

export function getMaterialSpecs(category: string): MaterialSpec {
  return materialSpecsCache.get(category) || {};
}

/**
 * Derives each category's material specs from catalog rows.
 *
 * Deliberately the same rule the sheet reader uses — sample the first handful of rows of
 * the category and pick out core material, finish material, brand and hinges — so the
 * wizard shows what it always showed, whether the catalog came from the sheet or from the
 * database.
 */
export function rebuildMaterialSpecsFromItems(items: CatalogItem[]): void {
  const byCategory = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const category = item.categoryName as unknown as string;
    if (!category) continue;
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(item);
    else byCategory.set(category, [item]);
  }

  for (const [category, categoryItems] of Array.from(byCategory.entries())) {
    const sample = categoryItems.slice(0, 10);
    const materials = sample.map(i => i.materialType).filter((m): m is string => !!m);
    const brands = sample.map(i => i.brand).filter((b): b is string => !!b);

    const specs: MaterialSpec = {};
    if (materials.length > 0) {
      specs.coreMaterial = materials.find(m => m.toLowerCase().includes('plywood') || m.toLowerCase().includes('mdf'));
      specs.finishMaterial = materials.find(m => m.toLowerCase().includes('laminate') || m.toLowerCase().includes('veneer'));
    }
    if (brands.length > 0) {
      specs.brand = brands[0];
      specs.hinges = brands.find(b => b.toLowerCase().includes('hettich') || b.toLowerCase().includes('ebco'));
    }

    materialSpecsCache.set(category, specs);
  }
}

export function clearCache() {
  catalogCache = null;
  materialSpecsCache.clear();
  lastFetchTime = 0;
  versionCatalogCache.clear();
  projectExceptionCache.clear();
}

/**
 * Per-version catalog cache.
 *
 * The catalog table now holds several versions at once, so a cache that is not keyed by
 * version would blend the Draft's prices into what clients are quoted. Every read is
 * therefore scoped to one version id, and entries are dropped individually when that
 * version's rows change.
 */
const versionCatalogCache = new Map<string, CatalogItem[]>();

/**
 * Turns a stored catalog row into the shape the app serves.
 *
 * Room type and unit type are passed through exactly as the sheet holds them, including
 * when they are blank. A blank room type is meaningful: it means the product suits any
 * room, and the catalog endpoint relies on that to offer it in Wet and Dry rooms alike.
 * Defaulting a blank to a real room type (as this once did) silently hid more than half
 * the catalog from Wet rooms.
 */
function toCacheItem(item: any): CatalogItem {
  return {
    id: item.id,
    itemCode: item.itemCode || undefined,
    categoryName: item.categoryName as any,
    roomType: (item.roomType || '') as any,
    unitType: item.unitType || '',
    materialType: item.materialType || undefined,
    brand: item.brand || undefined,
    description: item.description || '',
    rate: item.rate || 0,
    markup: item.markup || 0,
    sellingPrice: item.sellingPrice || 0,
    imageUrl: item.imageUrl || undefined,
    itemType: (item.itemType as 'woodworks' | 'services' | 'accessories') || 'woodworks',
  } as CatalogItem;
}

/** Loads (and caches) the complete catalog for one pricing version. */
export async function getCatalogForVersion(versionId: string): Promise<CatalogItem[]> {
  const hit = versionCatalogCache.get(versionId);
  if (hit) return hit;

  const { db } = await import('./db');
  const { catalogItems } = await import('../shared/schema');
  const { eq } = await import('drizzle-orm');

  const items = await db.select().from(catalogItems).where(eq(catalogItems.pricingVersionId, versionId));
  const mapped = items.map(toCacheItem);
  versionCatalogCache.set(versionId, mapped);
  return mapped;
}

/** Drops one version's cached catalog, or all of them when no id is given. */
export function clearVersionCatalogCache(versionId?: string) {
  if (versionId) versionCatalogCache.delete(versionId);
  else versionCatalogCache.clear();
}

/**
 * Per-project extras: products granted to a single quotation that are not in the
 * version it is pinned to.
 *
 * Kept separate from the version cache on purpose. The version cache is shared by every
 * project on that version, so merging one project's extras into it would leak them to
 * all the others.
 */
const projectExceptionCache = new Map<string, CatalogItem[]>();

export function clearProjectExceptionCache(projectId?: string) {
  if (projectId) projectExceptionCache.delete(projectId);
  else projectExceptionCache.clear();
}

async function getProjectExceptionItems(projectId: string): Promise<CatalogItem[]> {
  const hit = projectExceptionCache.get(projectId);
  if (hit) return hit;

  const { db } = await import('./db');
  const { sql } = await import('drizzle-orm');

  // The price comes from the exception row, not the catalog row: the version it was
  // granted from may be the live one, whose rows can be rewritten in place, and the price
  // this quotation was granted must not move with them. The catalog row still supplies
  // the product itself — description, category, room type and so on.
  const res: any = await db.execute(sql`
    SELECT ci.id, ci.item_code, ci.category_name, ci.room_type, ci.unit_type, ci.material_type, ci.brand,
           ci.description, ci.markup, ci.image_url, ci.item_type,
           COALESCE(e.granted_rate, ci.rate)                   AS rate,
           COALESCE(e.granted_selling_price, ci.selling_price) AS selling_price
    FROM project_catalog_exceptions e
    JOIN LATERAL (
      SELECT * FROM catalog_items
      WHERE pricing_version_id = e.source_version_id AND item_code = e.item_code
      LIMIT 1
    ) ci ON TRUE
    WHERE e.project_id = ${projectId}
  `);

  const rows = (res.rows ?? res) as any[];
  const mapped = rows.map((r) =>
    toCacheItem({
      id: r.id,
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
      imageUrl: r.image_url,
      itemType: r.item_type,
    })
  );

  projectExceptionCache.set(projectId, mapped);
  return mapped;
}

/**
 * The catalog one quotation may be built from: its pinned version, plus any product
 * specifically granted to it.
 */
export async function getCatalogForProject(versionId: string, projectId?: string): Promise<CatalogItem[]> {
  const base = await getCatalogForVersion(versionId);
  if (!projectId) return base;

  const extras = await getProjectExceptionItems(projectId);
  if (extras.length === 0) return base;

  // A product granted to this quotation can also exist in the catalog being served — it
  // may have been added to the live list after it was granted here, or the project may be
  // reading the live list rather than the one it was granted from. Offering both would
  // show the same product twice, at two prices. The granted row wins: it carries the price
  // this client was actually promised.
  const grantedCodes = new Set(extras.map((e) => e.itemCode).filter((c): c is string => !!c));
  const withoutDuplicates = grantedCodes.size === 0 ? base : base.filter((i) => !i.itemCode || !grantedCodes.has(i.itemCode));

  return [...withoutDuplicates, ...extras];
}

/**
 * Warms the cache for the live version on startup.
 *
 * Scoped to the Active version deliberately: an unscoped read would pull every
 * version's rows into one list and quote clients a mixture of old, live and unpublished
 * prices.
 */
export async function warmCacheFromDatabase() {
  try {
    const { db } = await import('./db');
    const { catalogItems } = await import('../shared/schema');
    const { eq } = await import('drizzle-orm');
    const { getActiveVersion } = await import('./pricing-versions');

    const active = await getActiveVersion();
    if (!active) {
      console.log('⚠️  No active pricing version. Cache not warmed.');
      return;
    }

    const { asc } = await import('drizzle-orm');
    // Ordered by the row's original place in the sheet so the catalog — and the material
    // specs derived from the first rows of each category — is identical on every start.
    const items = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.pricingVersionId, active.id))
      .orderBy(asc(catalogItems.categoryName), asc(catalogItems.sheetTabId), asc(catalogItems.sheetRowId));

    if (items.length === 0) {
      console.log('⚠️  Active pricing version has no items. Cache not warmed.');
      return;
    }

    catalogCache = items.map(toCacheItem);
    versionCatalogCache.set(active.id, catalogCache);
    // The material specs the add-item wizard shows used to be filled in as a side effect
    // of reading the sheet. Now that the catalog is normally loaded from the database,
    // that read no longer happens, so they have to be derived here or the wizard shows
    // nothing.
    rebuildMaterialSpecsFromItems(catalogCache);

    lastFetchTime = Date.now();
    console.log(`✓ Catalog cache warmed from database: ${catalogCache.length} items (${active.name})`);
  } catch (error: any) {
    console.error('Failed to warm cache from database:', error);
    // Don't throw - let the app continue without cache
  }
}

/**
 * Fetch GQ (Google Quotation) sheet data for testing
 * GQ sheets are manual quotations created by admins to verify software calculations
 */
export async function fetchGQSheet(spreadsheetId: string, sheetName: string) {
  try {
    const sheets = await getUncachableGoogleSheetClient();
    
    // First, get spreadsheet metadata to find the actual sheet name
    // This handles invisible characters, extra spaces, or slight naming variations
    const metadataResponse = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false,
    });
    
    const actualSheets = metadataResponse.data.sheets || [];
    const sheetTitleMap = new Map<string, string>(); // normalized -> actual
    
    for (const sheet of actualSheets) {
      const actualTitle = sheet.properties?.title || '';
      // Normalize for matching: collapse multiple spaces, trim
      const normalized = actualTitle.replace(/\s+/g, ' ').trim().toLowerCase();
      sheetTitleMap.set(normalized, actualTitle);
    }
    
    // Try to find the actual sheet name with fuzzy matching
    const normalizedInput = sheetName.replace(/\s+/g, ' ').trim().toLowerCase();
    let actualSheetName = sheetTitleMap.get(normalizedInput);
    
    // If no exact match, try partial matching
    if (!actualSheetName) {
      const entries = Array.from(sheetTitleMap.entries());
      for (const [norm, actual] of entries) {
        if (norm.includes(normalizedInput) || normalizedInput.includes(norm)) {
          actualSheetName = actual;
          console.log(`  Fuzzy matched "${sheetName}" -> "${actualSheetName}"`);
          break;
        }
      }
    }
    
    if (!actualSheetName) {
      const availableSheets = Array.from(sheetTitleMap.values()).join(', ');
      throw new Error(`Sheet "${sheetName}" not found. Available sheets: ${availableSheets}`);
    }
    
    console.log(`Found sheet: "${actualSheetName}" for requested "${sheetName}"`);
    
    // Sheet names with special characters must be wrapped in single quotes
    const quotedSheetName = `'${actualSheetName.replace(/'/g, "''")}'`;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quotedSheetName}!A:Z`,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      throw new Error(`Sheet "${sheetName}" is empty or not found`);
    }

    // Find the actual column header row by looking for expected header keywords
    // GQ sheets typically have "Description", "Rate", "Amount", etc. as column headers
    let headerRowIndex = -1;
    let headers: string[] = [];
    
    const expectedHeaders = ['description', 'rate', 'amount', 'quantity'];
    
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      
      // Convert row to lowercase for comparison
      const rowLower = row.map((cell: any) => (cell || '').toString().toLowerCase().trim());
      
      // Check if this row contains at least 2 expected header keywords
      const matchCount = expectedHeaders.filter(keyword => 
        rowLower.some(cell => cell.includes(keyword))
      ).length;
      
      if (matchCount >= 2) {
        headerRowIndex = i;
        headers = row.map((cell: any) => (cell || '').toString().trim());
        console.log(`Found header row at index ${i} with ${headers.length} columns:`, headers);
        break;
      }
    }
    
    // Fallback: if no header row found, use first non-empty row
    if (headerRowIndex === -1) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const hasContent = row && row.some((cell: any) => cell && cell.toString().trim() !== '');
        
        if (hasContent) {
          headerRowIndex = i;
          headers = row.map((cell: any) => (cell || '').toString().trim());
          console.log(`Fallback: Using row ${i} as headers with ${headers.length} columns:`, headers);
          break;
        }
      }
    }

    if (headerRowIndex === -1) {
      throw new Error(`No data found in sheet "${sheetName}"`);
    }

    // Data starts after headers
    const data = rows.slice(headerRowIndex + 1);

    console.log(`✓ Fetched ${rows.length} rows from ${sheetName} sheet (headers at row ${headerRowIndex + 1}, ${headers.length} columns)`);
    
    return {
      sheetName,
      headers,
      data,
      rawData: rows,
      totalRows: rows.length,
      headerRowIndex,
    };
  } catch (error: any) {
    console.error(`Error fetching GQ sheet ${sheetName}:`, error);
    throw new Error(`Failed to fetch ${sheetName}: ${error.message}`);
  }
}
