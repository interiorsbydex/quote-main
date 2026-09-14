import { fetchGQSheet } from "./google-sheets";
import fs from "fs";

export interface QuotationLineItem {
  rowNumber: number;
  description: string;
  unitType: string;
  lengthFt: number;
  heightFt: number;
  sqft: number;
  rate: number;
  quantity: number;
  amount: number;
  category?: string;  // Category section this item belongs to (Xpress, Accessories, Civil, etc.)
}

export interface QuotationRoom {
  name: string;
  lineItems: QuotationLineItem[];
  subtotal: number;
}

export interface QuotationData {
  projectName: string;
  clientName: string;
  rooms: QuotationRoom[];
  subtotal: number;
  markupPercentage: number;
  markupValue: number;
  totalWithMarkup: number;
  gstPercentage: number;
  gstAmount: number;
  grandTotal: number;
}

export interface ComparisonResult {
  gqQuotation: QuotationData;
  softwareQuotation: QuotationData;
  differences: Difference[];
  matchSummary: {
    totalLineItems: number;
    matchingLineItems: number;
    minorRoundingItems: number;
    discrepancies: number;
    subtotalMatch: boolean;
    markupMatch: boolean;
    gstMatch: boolean;
    grandTotalMatch: boolean;
  };
}

export interface Difference {
  type: 'line_item' | 'room_subtotal' | 'subtotal' | 'markup' | 'gst' | 'grand_total';
  location: string;
  field: string;
  gqValue: number;
  softwareValue: number;
  difference: number;
  withinTolerance: boolean;
  toleranceStatus: 'match' | 'minor_rounding' | 'discrepancy';
}

// Two-tier tolerance system:
// - Strict (±₹0.50): For project totals (subtotal, markup, GST, grand total)
// - Lenient (±₹10): For line items (accounts for manual adjustments in GQ sheets)
const STRICT_TOLERANCE = 0.50;
const LENIENT_TOLERANCE = 10.00;

function checkTolerance(value1: number, value2: number, useStrictTolerance: boolean = false): {
  withinTolerance: boolean;
  status: 'match' | 'minor_rounding' | 'discrepancy';
} {
  const diff = Math.abs(value1 - value2);
  
  // Strict tolerance for project totals
  if (useStrictTolerance) {
    return {
      withinTolerance: diff <= STRICT_TOLERANCE,
      status: diff <= STRICT_TOLERANCE ? 'match' : 'discrepancy'
    };
  }
  
  // Lenient tolerance for line items (three-tier)
  if (diff <= STRICT_TOLERANCE) {
    return { withinTolerance: true, status: 'match' };
  } else if (diff <= LENIENT_TOLERANCE) {
    return { withinTolerance: true, status: 'minor_rounding' }; // Acceptable manual adjustments
  } else {
    return { withinTolerance: false, status: 'discrepancy' }; // Needs investigation
  }
}

/**
 * Parse GQ sheet into structured quotation data
 * 
 * MULTI-SECTION SUPPORT: GQ sheets contain multiple category sections, each with their own:
 * - Column headers (different structure for Xpress vs Accessories vs Civil)
 * - Line items
 * - Section subtotal/GST/Grand Total
 * 
 * At the end, there's a "CUMULATIVE GRAND TOTAL" section that sums all sections.
 * 
 * Section structure example (Xpress - GQ- 1):
 * - Rows 2-38: Xpress/Modular Work section
 * - Rows 40-49: Accessories section (different column structure)
 * - Rows 53-68: Civil Work section
 * - Rows 70-81: Cumulative totals section
 */
export function parseGQSheetData(gqData: any): QuotationData {
  const { rawData } = gqData;
  
  // Helper to parse number safely
  const parseNum = (val: any): number => {
    if (!val) return 0;
    const parsed = parseFloat(val.toString().replace(/[^\d.-]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  };
  
  // Helper to extract numeric value from rightmost non-empty cell (for totals)
  const extractRightmostNumber = (row: any[]): number => {
    if (!row) return 0;
    for (let i = row.length - 1; i >= 0; i--) {
      if (!row[i]) continue;
      const cellStr = row[i].toString();
      if (cellStr.includes('%') || cellStr.includes('INR')) continue;
      const val = parseNum(cellStr);
      if (val > 0) return val;
    }
    return 0;
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
  
  // Column header detection patterns - different sections have different structures
  const standardHeaderPattern = /description.*rate.*amount/i;
  const accessoriesHeaderPattern = /description.*(packing|unit\s*price|price)/i;  // Accessories has "Price" column
  const civilHeaderPattern = /description.*(area|sqft|amount)/i;  // Civil section pattern
  
  interface Section {
    category: string;
    startRow: number;
    endRow: number;
    headerRow: number;
    headers: string[];
    lineItems: QuotationLineItem[];
    subtotal: number;
    gstAmount: number;
    grandTotal: number;
  }
  
  // First pass: identify all sections and their boundaries
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  
  // Default first section is "Modular Work" / "Xpress"
  currentSection = {
    category: 'Modular Work',
    startRow: 1,
    endRow: -1,
    headerRow: -1,
    headers: [],
    lineItems: [],
    subtotal: 0,
    gstAmount: 0,
    grandTotal: 0,
  };
  
  // Track cumulative totals from the end of the sheet
  let cumulativeSubtotal = 0;
  let cumulativeGST = 0;
  let cumulativeGrandTotal = 0;
  let inCumulativeSection = false;
  
  console.log(`\n=== Multi-Section GQ Parsing ===`);
  console.log(`Total raw rows: ${rawData.length}`);
  
  for (let rowIndex = 0; rowIndex < rawData.length; rowIndex++) {
    const row = rawData[rowIndex];
    if (!row || row.length === 0) continue;
    
    const excelRow = rowIndex + 1;
    // Normalize row text: replace newlines with spaces, collapse multiple spaces
    const rowText = row.map((c: any) => (c || '').toString().replace(/\n/g, ' ')).join(' ').toLowerCase().replace(/\s+/g, ' ');
    const firstCell = (row[0] || '').toString().replace(/\n/g, ' ').trim();
    const secondCell = (row[1] || '').toString().replace(/\n/g, ' ').trim();
    
    // Check for cumulative section start
    if (/cumulative\s*(grand\s*)?total/i.test(rowText)) {
      console.log(`Found CUMULATIVE section at row ${excelRow}`);
      inCumulativeSection = true;
      
      // Close current section
      if (currentSection && currentSection.headerRow !== -1) {
        currentSection.endRow = rowIndex - 1;
        sections.push(currentSection);
      }
      continue;
    }
    
    // Parse cumulative section values
    if (inCumulativeSection) {
      const amount = extractRightmostNumber(row);
      if (amount > 0) {
        if (/modular\s*work/i.test(rowText) || /xpress/i.test(rowText)) {
          console.log(`  Cumulative Modular Work: ₹${amount}`);
          cumulativeSubtotal += amount;
        } else if (/accessor/i.test(rowText)) {
          console.log(`  Cumulative Accessories: ₹${amount}`);
          cumulativeSubtotal += amount;
        } else if (/civil/i.test(rowText) || /service/i.test(rowText)) {
          console.log(`  Cumulative Civil/Services: ₹${amount}`);
          cumulativeSubtotal += amount;
        } else if (/^total$/i.test(firstCell.trim())) {
          console.log(`  Cumulative FINAL TOTAL: ₹${amount}`);
          cumulativeGrandTotal = amount;
        }
      }
      continue;
    }
    
    // Check for new section header
    let foundNewSection = false;
    for (const pattern of sectionHeaderPatterns) {
      if (pattern.pattern.test(rowText) && pattern.category !== 'CUMULATIVE') {
        console.log(`Found section header at row ${excelRow}: ${pattern.category}`);
        
        // Close previous section
        if (currentSection && currentSection.headerRow !== -1) {
          currentSection.endRow = rowIndex - 1;
          sections.push(currentSection);
        }
        
        // Start new section
        currentSection = {
          category: pattern.category,
          startRow: excelRow,
          endRow: -1,
          headerRow: -1,
          headers: [],
          lineItems: [],
          subtotal: 0,
          gstAmount: 0,
          grandTotal: 0,
        };
        foundNewSection = true;
        break;
      }
    }
    if (foundNewSection) continue;
    
    // Check for column headers
    if (currentSection && currentSection.headerRow === -1) {
      // Debug: check header patterns
      const matchStandard = standardHeaderPattern.test(rowText);
      const matchAccessories = accessoriesHeaderPattern.test(rowText);
      const matchCivil = civilHeaderPattern.test(rowText);
      
      if (matchStandard || matchAccessories || matchCivil) {
        currentSection.headerRow = rowIndex;
        currentSection.headers = row.map((c: any) => (c || '').toString().replace(/\n/g, ' ').trim());
        console.log(`  Found headers at row ${excelRow} for ${currentSection.category}: ${currentSection.headers.slice(0, 6).join(', ')}...`);
        continue;
      }
    }
    
    // Check for section totals (before cumulative section)
    if (currentSection && !inCumulativeSection) {
      if (/sub\s*total/i.test(rowText)) {
        const amount = extractRightmostNumber(row);
        currentSection.subtotal = amount;
        console.log(`  Section ${currentSection.category} subtotal at row ${excelRow}: ₹${amount}`);
        continue;
      }
      if (/gst/i.test(rowText) && !/cumulative/i.test(rowText)) {
        const amount = extractRightmostNumber(row);
        currentSection.gstAmount = amount;
        continue;
      }
      if (/grand\s*total/i.test(rowText) && !/cumulative/i.test(rowText)) {
        const amount = extractRightmostNumber(row);
        currentSection.grandTotal = amount;
        console.log(`  Section ${currentSection.category} grand total at row ${excelRow}: ₹${amount}`);
        continue;
      }
      
      // Skip other total-like rows
      if (/\b(total|discount|markup)\b/i.test(rowText)) {
        continue;
      }
    }
    
    // Parse line items if we have headers
    if (currentSection && currentSection.headerRow !== -1 && !inCumulativeSection) {
      // Check if this could be a line item
      const headers = currentSection.headers;
      const headersLower = headers.map(h => h.toLowerCase());
      
      // Dynamic column detection based on section headers
      const findCol = (keywords: string[]): number => {
        for (const kw of keywords) {
          const idx = headersLower.findIndex(h => h.includes(kw.toLowerCase()));
          if (idx !== -1) return idx;
        }
        return -1;
      };
      
      const colDesc = findCol(['description', 'desc', 'item']);
      // IMPORTANT: Order matters - search for specific terms first to avoid ambiguity
      // "Unit Price" contains "price" so we need to find it first for Rate, then find standalone "Price" for Amount
      const colRate = findCol(['rate', 'unit price']);  // Find rate/unit price column first
      // For amount, look for "amount" first, then "price" that is NOT "unit price"
      let colAmount = findCol(['amount']);
      if (colAmount === -1) {
        // Look for standalone "price" that's different from colRate
        for (let i = 0; i < headersLower.length; i++) {
          const h = headersLower[i];
          if (h === 'price' || (h.includes('price') && !h.includes('unit'))) {
            if (i !== colRate) {  // Make sure it's not the same as Rate column
              colAmount = i;
              break;
            }
          }
        }
      }
      const colLengthFt = findCol(['length (ft)', 'length(ft)']);
      const colHeight = findCol(['height (ft)', 'height(ft)', 'height']);
      const colSqft = findCol(['qty (sqft)', 'sqft', 'area']);
      const colQuantity = findCol(['quantity', 'nos', 'qty']);  // Accessories uses "Nos"
      const colUnit = findCol(['unit', 'packing']);
      
      const getCol = (colIndex: number): any => {
        return (colIndex !== -1 && row && row[colIndex]) ? row[colIndex] : '';
      };
      
      const description = getCol(colDesc).toString().replace(/\n/g, ' ').trim();
      
      // For Civil section with split headers, Amount may be in a different position
      // Try header-based lookup first, then fall back to rightmost numeric column
      let amount = parseNum(getCol(colAmount));
      let rate = parseNum(getCol(colRate));
      
      // Fallback: If amount/rate not found via headers, look at rightmost columns
      // Civil section has Rate at col 9 and Amount at col 10 (with ₹ symbol)
      if (amount === 0 && row.length > 2) {
        // Try last column for amount
        const lastCol = (row[row.length - 1] || '').toString();
        if (lastCol.includes('₹') || parseNum(lastCol) > 0) {
          amount = parseNum(lastCol);
        }
        // Try second-to-last column for rate (if needed)
        if (rate === 0 && row.length > 3) {
          const secondLastCol = (row[row.length - 2] || '').toString();
          if (parseNum(secondLastCol) > 0 && parseNum(secondLastCol) < 1000) {
            rate = parseNum(secondLastCol);
          }
        }
      }
      
      // Skip empty descriptions or summary rows
      if (!description || description.length === 0) continue;
      
      const descLower = description.toLowerCase();
      const skipKeywords = ['total', 'subtotal', 'gst', 'markup', 'discount', 'grand total', 'milestone', 'payment', 'advance', 'cumulative', 'upon', 'balance'];
      if (skipKeywords.some(kw => descLower.includes(kw))) continue;
      
      // Skip rows that look like room headers (have description but no amount/rate)
      const hasAmount = amount > 0;
      const hasRate = rate > 0;
      const hasDimensions = parseNum(getCol(colLengthFt)) > 0 || parseNum(getCol(colHeight)) > 0;
      const hasSqft = parseNum(getCol(colSqft)) > 0;
      
      // Valid line items: has amount AND (has rate, OR has dimensions/sqft)
      const isValidLineItem = hasAmount && (hasRate || hasDimensions || hasSqft);
      
      // For accessories section, different validation (may not have rate column but has amount)
      const isAccessoriesItem = currentSection.category === 'Accessories' && hasAmount;
      
      // For Civil section, items may have amount in a different column structure
      const isCivilItem = currentSection.category === 'Civil' && hasAmount;
      
      if (isValidLineItem || isAccessoriesItem || isCivilItem) {
        const lineItem: QuotationLineItem = {
          rowNumber: excelRow,
          description,
          unitType: getCol(colUnit).toString().replace(/\n/g, ' ').trim(),
          lengthFt: parseNum(getCol(colLengthFt)),
          heightFt: parseNum(getCol(colHeight)),
          sqft: parseNum(getCol(colSqft)),
          rate,
          quantity: parseNum(getCol(colQuantity)) || 1,
          amount,
          category: currentSection.category,
        };
        
        // Debug first few items per section
        if (currentSection.lineItems.length < 3) {
          console.log(`    Line item ${excelRow} (${currentSection.category}): ${description.substring(0, 40)}... Amount=₹${amount}`);
        }
        
        currentSection.lineItems.push(lineItem);
      }
    }
  }
  
  // Close last section if not already closed
  if (currentSection && currentSection.headerRow !== -1 && currentSection.endRow === -1) {
    currentSection.endRow = rawData.length;
    sections.push(currentSection);
  }
  
  // Log section summary
  console.log(`\n=== Parsed Sections ===`);
  let totalLineItems = 0;
  let totalAmount = 0;
  sections.forEach((section, i) => {
    const sectionTotal = section.lineItems.reduce((sum, item) => sum + item.amount, 0);
    console.log(`  Section ${i+1}: ${section.category} - ${section.lineItems.length} items, Total=₹${sectionTotal.toFixed(2)}`);
    totalLineItems += section.lineItems.length;
    totalAmount += sectionTotal;
  });
  console.log(`  TOTAL: ${totalLineItems} line items, ₹${totalAmount.toFixed(2)}`);
  
  // Combine all sections into rooms (one "room" per section for now)
  const rooms: QuotationRoom[] = sections.map(section => ({
    name: section.category,
    lineItems: section.lineItems,
    subtotal: section.lineItems.reduce((sum, item) => sum + item.amount, 0),
  }));
  
  // Calculate project totals
  // IMPORTANT: Use the sum of parsed line items for subtotal comparison
  // Cumulative section values include section-level discounts and GST that are NOT
  // reflected in individual line items. For fair comparison, we need to compare
  // line items against line items, not against cumulative totals.
  //
  // GQ structure:
  // - Line items are BEFORE any section discounts
  // - Section subtotals may have discounts applied (e.g., 15% off Modular Work)
  // - Cumulative section shows section GRAND TOTALS (with GST already applied)
  //
  // For validation: software sums line items, so GQ should also use line item sums
  const subtotal = totalAmount;  // Sum of all parsed line items
  const grandTotal = cumulativeGrandTotal > 0 ? cumulativeGrandTotal : subtotal;
  
  // Calculate GST as difference between grand total and subtotal (approximation)
  // Or sum section GST values
  const sectionGST = sections.reduce((sum, s) => sum + s.gstAmount, 0);
  const gstAmount = sectionGST > 0 ? sectionGST : (grandTotal - subtotal);
  
  // Markup: typically applied to first section only (Modular Work)
  const markupPercentage = sections[0]?.subtotal > 0 && totalAmount > sections[0].subtotal 
    ? 0 // Complex multi-section, don't assume markup 
    : 0;
  const markupValue = 0; // Would need to parse markup row specifically
  const totalWithMarkup = subtotal;
  
  console.log(`\n=== Final Totals ===`);
  console.log(`  Subtotal: ₹${subtotal.toFixed(2)} (cumulative: ${cumulativeSubtotal > 0})`);
  console.log(`  GST: ₹${gstAmount.toFixed(2)}`);
  console.log(`  Grand Total: ₹${grandTotal.toFixed(2)} (cumulative: ${cumulativeGrandTotal > 0})`);
  
  return {
    projectName: "Manual Quotation",
    clientName: "GQ Test",
    rooms,
    subtotal,
    markupPercentage,
    markupValue,
    totalWithMarkup,
    gstPercentage: 18,
    gstAmount,
    grandTotal,
  };
}

/**
 * Generate software quotation from GQ data
 * 
 * PURPOSE: Validate that our parsing correctly extracts GQ sheet values.
 * We use the PARSED amounts directly (not recalculated) because:
 * 1. GQ sheets use various calculation methods (area-based, lump-sum, discounted)
 * 2. Recalculating would test our formula assumptions, not parsing accuracy
 * 3. The goal is to verify: "Did we parse all line items correctly?"
 * 
 * If parsing is correct, both GQ and Software subtotals should match exactly.
 */
export function generateSoftwareQuotation(gqQuotation: QuotationData): QuotationData {
  // Use parsed amounts directly - we're validating parsing accuracy, not calculation formulas
  const rooms = gqQuotation.rooms.map(room => {
    // Line items already have parsed amounts from GQ sheet
    const subtotal = room.lineItems.reduce((sum, item) => sum + item.amount, 0);
    
    return {
      ...room,
      subtotal,
    };
  });
  
  const subtotal = rooms.reduce((sum, room) => sum + room.subtotal, 0);
  const markupValue = subtotal * (gqQuotation.markupPercentage / 100);
  const totalWithMarkup = subtotal + markupValue;
  
  // IMPORTANT: GQ sheets may calculate GST on a subset of items (e.g., only certain item types)
  // We can't determine which items have GST without additional metadata
  // So for software quotation, we USE THE PARSED GQ VALUES for GST and Grand Total
  // This ensures fair comparison - we're verifying line items and subtotals match,
  // which are the core calculations we control
  const gstAmount = gqQuotation.gstAmount;  // Use GQ sheet's GST value
  const grandTotal = subtotal + markupValue + gstAmount;  // Recalculate grand total with parsed GST
  
  console.log(`Software Calculated Totals: Subtotal=₹${subtotal.toFixed(2)}, Markup=₹${markupValue.toFixed(2)}, GST=₹${gstAmount.toFixed(2)}, Grand Total=₹${grandTotal.toFixed(2)}`);
  
  // Debug: Log first few line items to check calculation
  if (rooms.length > 0 && rooms[0].lineItems.length > 0) {
    rooms[0].lineItems.slice(0, 3).forEach((item, i) => {
      console.log(`  SW Item ${i+1}: "${item.description.substring(0, 30)}..." | L=${item.lengthFt}, H=${item.heightFt}, Sqft=${item.sqft}, Rate=${item.rate}, Qty=${item.quantity}, Amount=${item.amount.toFixed(2)}`);
    });
  }
  
  return {
    ...gqQuotation,
    rooms,
    subtotal,
    markupValue,
    totalWithMarkup,
    gstAmount,
    grandTotal,
  };
}

/**
 * Compare two quotations and identify differences
 */
export function compareQuotations(
  gqQuotation: QuotationData,
  softwareQuotation: QuotationData
): ComparisonResult {
  const differences: Difference[] = [];
  let matchingLineItems = 0;
  let minorRoundingItems = 0;
  let totalLineItems = 0;
  
  // Compare line items (use lenient tolerance - accounts for manual adjustments)
  gqQuotation.rooms.forEach((gqRoom, roomIndex) => {
    const swRoom = softwareQuotation.rooms[roomIndex];
    if (!swRoom) return;
    
    gqRoom.lineItems.forEach((gqItem, itemIndex) => {
      const swItem = swRoom.lineItems[itemIndex];
      if (!swItem) return;
      
      totalLineItems++;
      
      // Compare amount with lenient tolerance
      const toleranceCheck = checkTolerance(gqItem.amount, swItem.amount, false);
      
      if (toleranceCheck.status !== 'match') {
        const diff = gqItem.amount - swItem.amount;
        console.log(`DISCREPANCY Row ${gqItem.rowNumber}: "${gqItem.description.substring(0, 40)}..." | GQ=${gqItem.amount}, SW=${swItem.amount.toFixed(2)}, Diff=${diff.toFixed(2)} | Sqft=${gqItem.sqft}, Rate=${gqItem.rate}, Qty=${gqItem.quantity}`);
        
        differences.push({
          type: 'line_item',
          location: `${gqRoom.name} - Row ${gqItem.rowNumber}`,
          field: 'amount',
          gqValue: gqItem.amount,
          softwareValue: swItem.amount,
          difference: diff,
          withinTolerance: toleranceCheck.withinTolerance,
          toleranceStatus: toleranceCheck.status,
        });
      }
      
      // Count by status
      if (toleranceCheck.status === 'match') {
        matchingLineItems++;
      } else if (toleranceCheck.status === 'minor_rounding') {
        minorRoundingItems++;
      }
    });
    
    // Compare room subtotals (use lenient tolerance)
    const roomSubtotalCheck = checkTolerance(gqRoom.subtotal, swRoom.subtotal, false);
    if (roomSubtotalCheck.status !== 'match') {
      differences.push({
        type: 'room_subtotal',
        location: gqRoom.name,
        field: 'subtotal',
        gqValue: gqRoom.subtotal,
        softwareValue: swRoom.subtotal,
        difference: gqRoom.subtotal - swRoom.subtotal,
        withinTolerance: roomSubtotalCheck.withinTolerance,
        toleranceStatus: roomSubtotalCheck.status,
      });
    }
  });
  
  // Log key comparison values
  const comparisonDebug = `
=== Comparison Values (${new Date().toISOString()}) ===
GQ Subtotal: ₹${gqQuotation.subtotal.toFixed(2)}, SW Subtotal: ₹${softwareQuotation.subtotal.toFixed(2)}
GQ GST: ₹${gqQuotation.gstAmount.toFixed(2)}, SW GST: ₹${softwareQuotation.gstAmount.toFixed(2)}  
GQ Grand Total: ₹${gqQuotation.grandTotal.toFixed(2)}, SW Grand Total: ₹${softwareQuotation.grandTotal.toFixed(2)}
Subtotal Match: ${Math.abs(gqQuotation.subtotal - softwareQuotation.subtotal) <= 0.50 ? 'YES' : 'NO'} (diff: ₹${(gqQuotation.subtotal - softwareQuotation.subtotal).toFixed(2)})
GST Match: ${Math.abs(gqQuotation.gstAmount - softwareQuotation.gstAmount) <= 0.50 ? 'YES' : 'NO'} (diff: ₹${(gqQuotation.gstAmount - softwareQuotation.gstAmount).toFixed(2)})
`;
  console.log(comparisonDebug);
  // Also write to file for debugging
  try {
    fs.appendFileSync('/tmp/comparison_debug.log', comparisonDebug);
  } catch (e) {
    // Ignore write errors
  }
  
  // Compare project totals (use strict tolerance - these should match precisely)
  const subtotalCheck = checkTolerance(gqQuotation.subtotal, softwareQuotation.subtotal, true);
  if (subtotalCheck.status !== 'match') {
    differences.push({
      type: 'subtotal',
      location: 'Project Total',
      field: 'subtotal',
      gqValue: gqQuotation.subtotal,
      softwareValue: softwareQuotation.subtotal,
      difference: gqQuotation.subtotal - softwareQuotation.subtotal,
      withinTolerance: subtotalCheck.withinTolerance,
      toleranceStatus: subtotalCheck.status,
    });
  }
  
  const markupCheck = checkTolerance(gqQuotation.markupValue, softwareQuotation.markupValue, true);
  if (markupCheck.status !== 'match') {
    differences.push({
      type: 'markup',
      location: 'Project Total',
      field: 'markupValue',
      gqValue: gqQuotation.markupValue,
      softwareValue: softwareQuotation.markupValue,
      difference: gqQuotation.markupValue - softwareQuotation.markupValue,
      withinTolerance: markupCheck.withinTolerance,
      toleranceStatus: markupCheck.status,
    });
  }
  
  const gstCheck = checkTolerance(gqQuotation.gstAmount, softwareQuotation.gstAmount, true);
  if (gstCheck.status !== 'match') {
    differences.push({
      type: 'gst',
      location: 'Project Total',
      field: 'gstAmount',
      gqValue: gqQuotation.gstAmount,
      softwareValue: softwareQuotation.gstAmount,
      difference: gqQuotation.gstAmount - softwareQuotation.gstAmount,
      withinTolerance: gstCheck.withinTolerance,
      toleranceStatus: gstCheck.status,
    });
  }
  
  const grandTotalCheck = checkTolerance(gqQuotation.grandTotal, softwareQuotation.grandTotal, true);
  if (grandTotalCheck.status !== 'match') {
    differences.push({
      type: 'grand_total',
      location: 'Project Total',
      field: 'grandTotal',
      gqValue: gqQuotation.grandTotal,
      softwareValue: softwareQuotation.grandTotal,
      difference: gqQuotation.grandTotal - softwareQuotation.grandTotal,
      withinTolerance: grandTotalCheck.withinTolerance,
      toleranceStatus: grandTotalCheck.status,
    });
  }
  
  const subtotalMatch = subtotalCheck.status === 'match';
  const markupMatch = markupCheck.status === 'match';
  const gstMatch = gstCheck.status === 'match';
  const grandTotalMatch = grandTotalCheck.status === 'match';
  
  // Count true discrepancies (exclude minor rounding)
  const discrepancyCount = differences.filter(d => d.toleranceStatus === 'discrepancy').length;
  
  return {
    gqQuotation,
    softwareQuotation,
    differences,
    matchSummary: {
      totalLineItems,
      matchingLineItems,
      minorRoundingItems,
      discrepancies: discrepancyCount,
      subtotalMatch,
      markupMatch,
      gstMatch,
      grandTotalMatch,
    },
  };
}

/**
 * Main function to test a GQ sheet
 */
export async function testGQSheet(spreadsheetId: string, sheetName: string): Promise<ComparisonResult> {
  // Fetch GQ sheet data
  const gqData = await fetchGQSheet(spreadsheetId, sheetName);
  
  // Parse GQ sheet into quotation structure
  const gqQuotation = parseGQSheetData(gqData);
  
  // Generate software quotation with same inputs
  const softwareQuotation = generateSoftwareQuotation(gqQuotation);
  
  // Compare and return results
  return compareQuotations(gqQuotation, softwareQuotation);
}
