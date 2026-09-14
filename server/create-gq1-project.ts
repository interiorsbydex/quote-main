/**
 * Script to create a real project based on GQ sheet line items
 * This creates an actual project in the software with the same structure as GQ sheets
 * 
 * MULTI-SECTION SUPPORT: GQ sheets contain multiple category sections:
 * - Modular Work (Xpress/Xpand)
 * - Accessories
 * - Civil/Services
 * Each section has different column structures that need to be parsed separately.
 */

import { fetchGQSheet } from "./google-sheets";
import { db } from "./db";
import { projects, rooms, lineItems } from "../shared/schema";
import { sql } from "drizzle-orm";
import { createProjectWithActiveVersion } from "./pricing-versions";

interface ParsedLineItem {
  rowNumber: number;
  description: string;
  lengthFt: number;
  heightFt: number;
  sqft: number;
  rate: number;
  quantity: number;
  amount: number;  // Use sheet's amount directly
  category: string;
}

interface ParsedRoom {
  name: string;
  lineItems: ParsedLineItem[];
  category: string;
}

interface Section {
  category: string;
  startRow: number;
  headerRow: number;
  headers: string[];
  subtotal: number;
  discountPercent: number;
  discountedTotal: number;
  gstPercent: number;
  gstAmount: number;
  grandTotal: number;
}

export async function createGQ1Project(
  spreadsheetId: string, 
  userId: string = "gq1-test-user",
  sheetName: string = "GQ 1"
): Promise<{
  projectId: string;
  rooms: { roomId: string; name: string; lineItemCount: number }[];
  totals: {
    subtotal: number;
    markupPercentage: number;
    markupValue: number;
    gstPercentage: number;
    gstAmount: number;
    grandTotal: number;
  };
  gqTotals: {
    subtotal: number;
    markupPercentage: number;
    markupValue: number;
    gstPercentage: number;
    gstAmount: number;
    grandTotal: number;
  };
}> {
  console.log(`\n=== Creating Project from ${sheetName} ===`);
  
  // Fetch raw data from sheet
  const gqData = await fetchGQSheet(spreadsheetId, sheetName);
  const rawData = gqData.rawData || gqData.data || [];
  
  console.log(`Fetched ${rawData.length} raw rows`);
  
  // Helper functions
  const parseNum = (val: any): number => {
    if (!val) return 0;
    const parsed = parseFloat(val.toString().replace(/[^\d.-]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  };
  
  const extractRightmostNumber = (row: any[]): number => {
    if (!row) return 0;
    for (let i = row.length - 1; i >= 0; i--) {
      if (!row[i]) continue;
      const cellStr = row[i].toString();
      if (cellStr.includes('%')) continue;
      const val = parseNum(cellStr);
      if (val > 0) return val;
    }
    return 0;
  };
  
  const extractPercentage = (rowText: string): number | null => {
    const match = rowText.match(/(\d+(?:\.\d+)?)%/);
    return match ? parseFloat(match[1]) : null;
  };
  
  // Section detection patterns
  const sectionHeaderPatterns = [
    { pattern: /quotation\s*-\s*accessor/i, category: 'Accessories' },
    { pattern: /quotation\s*-\s*civil/i, category: 'Civil' },
    { pattern: /quotation\s*-\s*services/i, category: 'Services' },
    { pattern: /quotation\s*-\s*lights/i, category: 'Lights' },
    { pattern: /quotation\s*-\s*stone/i, category: 'Stone Master' },
    { pattern: /quotation\s*-\s*handles/i, category: 'Handles' },
    { pattern: /cumulative\s*(grand\s*)?total/i, category: 'CUMULATIVE' },
  ];
  
  // Column header detection patterns
  const headerPatterns = [
    /description.*rate.*amount/i,
    /description.*(packing|unit\s*price|price)/i,
    /description.*(area|sqft|amount)/i,
    /sno.*description/i,
    /no.*description/i,
  ];
  
  // Parse data into sections and line items
  const parsedRooms: ParsedRoom[] = [];
  let currentSection: Section = {
    category: 'Modular Work',
    startRow: 1,
    headerRow: -1,
    headers: [],
    subtotal: 0,
    discountPercent: 0,
    discountedTotal: 0,
    gstPercent: 18,
    gstAmount: 0,
    grandTotal: 0,
  };
  let currentRoom: ParsedRoom | null = null;
  let inCumulativeSection = false;
  
  // Track overall GQ totals - only capture from Modular Work section (first section)
  // Other sections (Accessories, Civil) have their own totals that we don't want to overwrite
  let gqSubtotal = 0;
  let gqDiscountPercent = 0;
  let gqDiscountedTotal = 0;
  let gqGstPercent = 18;
  let gqGstAmount = 0;
  let gqGrandTotal = 0;
  let modularWorkTotalsSet = false; // Only set totals once from Modular Work section
  
  for (let rowIndex = 0; rowIndex < rawData.length; rowIndex++) {
    const row = rawData[rowIndex];
    if (!row || row.length === 0) continue;
    
    const excelRow = rowIndex + 1;
    const rowText = row.map((c: any) => (c || '').toString().replace(/\n/g, ' ')).join(' ').toLowerCase().replace(/\s+/g, ' ');
    const firstCell = (row[0] || '').toString().replace(/\n/g, ' ').trim();
    
    // Check for cumulative section (end of data)
    if (/cumulative\s*(grand\s*)?total/i.test(rowText)) {
      console.log(`Found CUMULATIVE section at row ${excelRow}`);
      inCumulativeSection = true;
      
      // Save current room
      if (currentRoom && currentRoom.lineItems.length > 0) {
        parsedRooms.push(currentRoom);
        currentRoom = null;
      }
      continue;
    }
    
    if (inCumulativeSection) continue; // Skip cumulative section rows
    
    // Check for new section header (Accessories, Civil, etc.)
    let foundNewSection = false;
    for (const pattern of sectionHeaderPatterns) {
      if (pattern.pattern.test(rowText) && pattern.category !== 'CUMULATIVE') {
        console.log(`Found section header at row ${excelRow}: ${pattern.category}`);
        
        // Save current room
        if (currentRoom && currentRoom.lineItems.length > 0) {
          parsedRooms.push(currentRoom);
          currentRoom = null;
        }
        
        // Start new section
        currentSection = {
          category: pattern.category,
          startRow: excelRow,
          headerRow: -1,
          headers: [],
          subtotal: 0,
          discountPercent: 0,
          discountedTotal: 0,
          gstPercent: 18,
          gstAmount: 0,
          grandTotal: 0,
        };
        foundNewSection = true;
        break;
      }
    }
    if (foundNewSection) continue;
    
    // Check for column headers within section
    if (currentSection.headerRow === -1) {
      const isHeader = headerPatterns.some(p => p.test(rowText));
      if (isHeader) {
        currentSection.headerRow = rowIndex;
        currentSection.headers = row.map((c: any) => (c || '').toString().replace(/\n/g, ' ').trim());
        console.log(`  Found headers at row ${excelRow} for ${currentSection.category}`);
        continue;
      }
    }
    
    // Check for totals (SUB TOTAL, Discount, GST, GRAND TOTAL)
    // Only capture from Modular Work section (first section) - don't let later sections overwrite
    if (/sub\s*total/i.test(rowText)) {
      const amount = extractRightmostNumber(row);
      currentSection.subtotal = amount;
      // Only set GQ totals from Modular Work section (first section with subtotal)
      if (!modularWorkTotalsSet && currentSection.category === 'Modular Work') {
        gqSubtotal = amount;
        console.log(`  [Modular Work] Subtotal at row ${excelRow}: ₹${amount.toLocaleString()}`);
      } else {
        console.log(`  [${currentSection.category}] Subtotal at row ${excelRow}: ₹${amount.toLocaleString()} (not captured for main totals)`);
      }
      continue;
    }
    
    if (/discount/i.test(rowText) && !/sub/i.test(rowText)) {
      const amount = extractRightmostNumber(row);
      const percent = extractPercentage(rowText);
      if (percent && currentSection.category === 'Modular Work' && !modularWorkTotalsSet) {
        gqDiscountPercent = percent;
        gqDiscountedTotal = amount;
        console.log(`  [Modular Work] Discount ${percent}% at row ${excelRow}: ₹${amount.toLocaleString()} (after discount)`);
      }
      continue;
    }
    
    if (/gst/i.test(rowText) && !/cumulative/i.test(rowText)) {
      const amount = extractRightmostNumber(row);
      const percent = extractPercentage(rowText);
      if (currentSection.category === 'Modular Work' && !modularWorkTotalsSet) {
        if (percent) gqGstPercent = percent;
        gqGstAmount = amount;
        console.log(`  [Modular Work] GST ${gqGstPercent}% at row ${excelRow}: ₹${amount.toLocaleString()}`);
      }
      continue;
    }
    
    if (/grand\s*total/i.test(rowText) && !/cumulative/i.test(rowText)) {
      const amount = extractRightmostNumber(row);
      if (currentSection.category === 'Modular Work' && !modularWorkTotalsSet) {
        gqGrandTotal = amount;
        modularWorkTotalsSet = true; // Lock totals after capturing from Modular Work
        console.log(`  [Modular Work] Grand Total at row ${excelRow}: ₹${amount.toLocaleString()} (LOCKED)`);
      } else {
        console.log(`  [${currentSection.category}] Grand Total at row ${excelRow}: ₹${amount.toLocaleString()} (not captured)`);
      }
      continue;
    }
    
    // Skip other summary rows
    if (/\b(total|markup|milestone|payment|advance)\b/i.test(rowText)) {
      continue;
    }
    
    // Skip if we don't have headers yet
    if (currentSection.headerRow === -1) continue;
    
    // Dynamic column detection based on current section headers
    const headers = currentSection.headers;
    const headersLower = headers.map(h => h.toLowerCase());
    
    const findCol = (keywords: string[]): number => {
      for (const kw of keywords) {
        const idx = headersLower.findIndex(h => h.includes(kw.toLowerCase()));
        if (idx !== -1) return idx;
      }
      return -1;
    };
    
    const colDesc = findCol(['description', 'desc', 'item']);
    const colLengthFt = findCol(['length (ft)', 'length(ft)']);
    const colHeight = findCol(['height (ft)', 'height(ft)', 'height']);
    const colSqft = findCol(['qty (sqft)', 'sqft', 'area']);
    const colRate = findCol(['rate', 'unit price']);
    let colAmount = findCol(['amount']);
    if (colAmount === -1) {
      // Look for standalone "price" that's different from colRate
      for (let i = 0; i < headersLower.length; i++) {
        const h = headersLower[i];
        if (h === 'price' || (h.includes('price') && !h.includes('unit'))) {
          if (i !== colRate) {
            colAmount = i;
            break;
          }
        }
      }
    }
    const colQuantity = findCol(['quantity', 'nos', 'qty']);
    
    const getCol = (colIndex: number): any => {
      return (colIndex !== -1 && row && row[colIndex]) ? row[colIndex] : '';
    };
    
    const description = getCol(colDesc).toString().replace(/\n/g, ' ').trim();
    if (!description) continue;
    
    const descLower = description.toLowerCase();
    const skipKeywords = ['total', 'subtotal', 'gst', 'markup', 'discount', 'grand total', 'modular work', 'accessories', 'civil', 'quotation'];
    if (skipKeywords.some(kw => descLower.includes(kw))) continue;
    
    // Parse values
    let amount = parseNum(getCol(colAmount));
    let rate = parseNum(getCol(colRate));
    const lengthFt = parseNum(getCol(colLengthFt));
    const height = parseNum(getCol(colHeight));
    const sqft = parseNum(getCol(colSqft));
    const quantity = parseNum(getCol(colQuantity)) || 1;
    
    // Fallback: If amount not found via headers, try rightmost column
    if (amount === 0 && row.length > 2) {
      const lastCol = (row[row.length - 1] || '').toString();
      if (lastCol.includes('₹') || parseNum(lastCol) > 0) {
        amount = parseNum(lastCol);
      }
    }
    
    // Determine if this is a room header or a line item
    const hasAmount = amount > 0;
    const hasRate = rate > 0;
    const hasDimensions = lengthFt > 0 || height > 0 || sqft > 0;
    
    // Valid line items have amount AND (rate OR dimensions)
    const isLineItem = hasAmount && (hasRate || hasDimensions);
    // Accessories items may only have amount (no dimensions)
    const isAccessoriesItem = currentSection.category === 'Accessories' && hasAmount;
    
    if (isLineItem || isAccessoriesItem) {
      // This is a line item
      if (!currentRoom) {
        // Create default room for this section
        currentRoom = {
          name: currentSection.category,
          lineItems: [],
          category: currentSection.category,
        };
      }
      
      currentRoom.lineItems.push({
        rowNumber: excelRow,
        description,
        lengthFt,
        heightFt: height,
        sqft,
        rate,
        quantity,
        amount, // Use sheet's amount directly!
        category: currentSection.category,
      });
    } else if (description && !hasAmount && !hasRate && !hasDimensions) {
      // This looks like a room header
      if (currentRoom && currentRoom.lineItems.length > 0) {
        parsedRooms.push(currentRoom);
      }
      currentRoom = {
        name: description,
        lineItems: [],
        category: currentSection.category,
      };
      console.log(`  Found room: ${description}`);
    }
  }
  
  // Save last room
  if (currentRoom && currentRoom.lineItems.length > 0) {
    parsedRooms.push(currentRoom);
  }
  
  console.log(`\n=== Parsed Structure ===`);
  console.log(`Total rooms: ${parsedRooms.length}`);
  let totalLineItems = 0;
  parsedRooms.forEach(room => {
    console.log(`  ${room.name} (${room.category}): ${room.lineItems.length} items`);
    totalLineItems += room.lineItems.length;
  });
  console.log(`Total line items: ${totalLineItems}`);
  
  console.log(`\n=== GQ Sheet Totals ===`);
  console.log(`  Subtotal: ₹${gqSubtotal.toLocaleString()}`);
  console.log(`  Discount (${gqDiscountPercent}%): After discount = ₹${gqDiscountedTotal.toLocaleString()}`);
  console.log(`  GST (${gqGstPercent}%): ₹${gqGstAmount.toLocaleString()}`);
  console.log(`  Grand Total: ₹${gqGrandTotal.toLocaleString()}`);
  
  // Create project in database
  console.log(`\n=== Creating Project in Database ===`);
  
  // Determine default category based on sheet name
  let defaultCategory = "DeX - Xpress";
  if (sheetName.toLowerCase().includes("xpand")) {
    defaultCategory = "DeX - Xpand";
  }
  
  // Store discount as negative markup
  const markupPercentage = gqDiscountPercent > 0 ? -gqDiscountPercent : 0;
  
  // Pinned to the live pricing version like every other quotation, so a later price rise
  // cannot reprice it.
  const project = await createProjectWithActiveVersion({
    userId,
    clientName: `${sheetName} - Reference Quote`,
    projectType: "Residential",
    defaultCategory,
    markup: markupPercentage,
  });
  
  console.log(`Created project: ${project.id}`);
  
  const createdRooms: { roomId: string; name: string; lineItemCount: number }[] = [];
  let softwareSubtotal = 0;
  let modularWorkTotal = 0; // Track Modular Work section separately
  
  // Create rooms and line items
  for (const parsedRoom of parsedRooms) {
    const [room] = await db.insert(rooms).values({
      projectId: project.id,
      roomName: parsedRoom.name,
      roomType: "Dry / Inexposed",
    }).returning();
    
    console.log(`  Created room: ${parsedRoom.name} (${room.id}) [${parsedRoom.category}]`);
    
    let roomTotal = 0;
    for (const item of parsedRoom.lineItems) {
      // Calculate amount using our formula based on unit semantics:
      // - Area-based items (sqft > 0): rate × sqft × quantity
      // - Per-unit items (sqft = 0): rate × quantity
      const sqftValue = item.sqft > 0 ? item.sqft : (item.lengthFt * item.heightFt);
      const isAreaBased = sqftValue > 0;
      const finalAmount = isAreaBased ? (item.rate * sqftValue * item.quantity) : (item.rate * item.quantity);
      
      await db.insert(lineItems).values({
        roomId: room.id,
        projectId: project.id,
        description: item.description,
        unitType: "General",
        lengthFt: item.lengthFt,
        heightFt: item.heightFt,
        sqft: sqftValue,
        lengthMm: item.lengthFt * 300,
        heightMm: item.heightFt * 300,
        rate: item.rate,
        quantity: item.quantity,
        amount: finalAmount,
      });
      
      roomTotal += finalAmount;
      softwareSubtotal += finalAmount;
    }
    
    // Track Modular Work section separately (for comparison with GQ sheet totals)
    if (parsedRoom.category === 'Modular Work') {
      modularWorkTotal += roomTotal;
    }
    
    createdRooms.push({
      roomId: room.id,
      name: parsedRoom.name,
      lineItemCount: parsedRoom.lineItems.length,
    });
  }
  
  console.log(`\n=== Section Breakdown ===`);
  console.log(`  Modular Work Total: ₹${modularWorkTotal.toLocaleString()}`);
  console.log(`  All Sections Total: ₹${softwareSubtotal.toLocaleString()}`);
  
  // Use Modular Work total for comparison since GQ sheet totals refer to that section
  const comparisonSubtotal = modularWorkTotal;
  
  // Calculate software totals using Modular Work section (for comparison with GQ sheet)
  // The GQ sheet's SUB TOTAL, Discount, GST, and Grand Total refer to Modular Work only
  
  // IMPORTANT: Use the actual discounted total from the sheet, not a recalculated percentage
  // The sheet may have manual adjustments, so "Discount 15%" might not be exactly 15%
  // Example: ₹616,091 with "15% discount" → ₹533,678 (actual discount is ~13.37%)
  let modularTotalAfterDiscount: number;
  let actualDiscountValue: number;
  
  if (gqDiscountedTotal > 0) {
    // Use the sheet's actual discounted total
    modularTotalAfterDiscount = gqDiscountedTotal;
    actualDiscountValue = modularWorkTotal - gqDiscountedTotal;
    console.log(`  Using sheet's discounted total: ₹${gqDiscountedTotal.toLocaleString()}`);
    console.log(`  Actual discount amount: ₹${actualDiscountValue.toLocaleString()} (${(actualDiscountValue / modularWorkTotal * 100).toFixed(2)}%)`);
  } else {
    // Fallback to calculated discount if no discounted total in sheet
    actualDiscountValue = modularWorkTotal * (gqDiscountPercent / 100);
    modularTotalAfterDiscount = modularWorkTotal - actualDiscountValue;
  }
  
  const modularGstAmount = modularTotalAfterDiscount * (gqGstPercent / 100);
  const modularGrandTotal = modularTotalAfterDiscount + modularGstAmount;
  
  console.log(`\n=== Software Calculated Totals (Modular Work Section) ===`);
  console.log(`  Subtotal: ₹${modularWorkTotal.toLocaleString()}`);
  console.log(`  Discount: ₹${actualDiscountValue.toLocaleString()} (${gqDiscountPercent}% stated)`);
  console.log(`  After Discount: ₹${modularTotalAfterDiscount.toLocaleString()}`);
  console.log(`  GST (${gqGstPercent}%): ₹${modularGstAmount.toLocaleString()}`);
  console.log(`  Grand Total: ₹${modularGrandTotal.toLocaleString()}`);
  
  console.log(`\n=== Comparison (Modular Work vs GQ Sheet) ===`);
  console.log(`  Subtotal Diff: ₹${(modularWorkTotal - gqSubtotal).toLocaleString()}`);
  console.log(`  Grand Total Diff: ₹${(modularGrandTotal - gqGrandTotal).toLocaleString()}`);
  
  return {
    projectId: project.id,
    rooms: createdRooms,
    totals: {
      // Return Modular Work totals for comparison with GQ sheet
      subtotal: modularWorkTotal,
      markupPercentage: gqDiscountPercent > 0 ? -gqDiscountPercent : 0,
      markupValue: -actualDiscountValue, // Negative for discount
      gstPercentage: gqGstPercent,
      gstAmount: modularGstAmount,
      grandTotal: modularGrandTotal,
    },
    gqTotals: {
      subtotal: gqSubtotal,
      markupPercentage: gqDiscountPercent > 0 ? -gqDiscountPercent : 0,
      markupValue: gqSubtotal - gqDiscountedTotal,
      gstPercentage: gqGstPercent,
      gstAmount: gqGstAmount,
      grandTotal: gqGrandTotal,
    },
  };
}
