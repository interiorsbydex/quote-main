# Design Guidelines: Dynamic Quote Builder

## Design Approach

**Selected System: Material Design**

**Justification:** This is a data-intensive B2B SaaS application requiring clear information hierarchy, efficient workflows, and professional credibility. Material Design excels at:
- Data tables and complex forms
- Multi-step processes with clear feedback
- Professional business applications
- Responsive layouts with consistent patterns

**Key Principles:**
1. **Clarity over decoration** - Every element serves a functional purpose
2. **Efficient workflows** - Minimize steps, maximize context
3. **Data transparency** - Numbers and calculations always visible
4. **Professional confidence** - Clean, trustworthy interface

---

## Typography

**Font Stack:**
- Primary: Inter (Google Fonts) - excellent for UI and data display
- Monospace: JetBrains Mono - for numerical values, rates, calculations

**Hierarchy:**
- Page Titles: text-3xl font-semibold (30px)
- Section Headers: text-xl font-semibold (20px)
- Card/Panel Titles: text-lg font-medium (18px)
- Body Text: text-base (16px)
- Labels: text-sm font-medium (14px)
- Table Data: text-sm (14px)
- Captions/Metadata: text-xs text-gray-600 (12px)
- Numbers/Rates: Use monospace font-mono for alignment

---

## Layout System

**Spacing Primitives:** Use Tailwind units of **2, 4, 6, 8, 12, 16** (e.g., p-4, m-8, gap-6)

**Grid Structure:**
- Dashboard: 16px padding on mobile, 24px on desktop
- Max content width: max-w-7xl for main containers
- Sidebar (if used): Fixed 280px width on desktop, drawer on mobile

**Vertical Rhythm:**
- Section spacing: mb-8 to mb-12
- Card internal padding: p-6
- Form field spacing: gap-4
- Table row height: Comfortable 48px minimum

---

## Component Library

### Core Navigation
**Top Navigation Bar:**
- Fixed position with box-shadow
- Height: 64px
- Contains: Logo, Project name (if in project), User avatar, Admin controls (if admin)
- Background: White with subtle border-bottom

**Sidebar (Project Detail View):**
- Collapsible on mobile
- Sections: Material Spec block, Rooms list, Quick actions
- Sticky positioning for easy navigation

### Data Display Components

**Project List (Dashboard):**
- Card-based grid on desktop (grid-cols-1 md:grid-cols-2 lg:grid-cols-3)
- Each card shows: Client name (bold), Project type badge, Status indicator, Last updated, Total amount preview
- Hover state: Subtle shadow lift

**Quotation Summary Panel:**
- Fixed/sticky position on right side (desktop: w-80)
- Sections clearly divided with borders
- Calculation breakdown displayed prominently:
  - Subtotal (font-mono text-lg)
  - Markup % input field (inline)
  - GST (18%) - calculated
  - Grand Total (text-2xl font-bold font-mono)

**Material Specification Block:**
- Card format with light background (bg-gray-50)
- Grid layout: Key-value pairs (2 columns on desktop)
- Format: "Core Material: Plywood | Finish: Laminate | Hinges: Hettich"

**Line Items Table:**
- Responsive table with horizontal scroll on mobile
- Columns: Description (flex-1), Length (80px), Height (80px), Sqft (80px), mm values (collapsed on mobile), Rate (100px), Qty (60px), Amount (120px)
- Alternating row backgrounds (bg-white/bg-gray-50)
- Row actions: Edit icon, Delete icon on hover
- Footer row: Bold totals

### Form Components

**4-Step Line Item Creation:**
- Stepper indicator at top (Steps 1-4)
- Each step in a card with clear heading
- Step 1: Searchable dropdown for Unit Type
- Step 2: Filtered description dropdown with visual feedback
- Step 3: Dimension inputs side-by-side (Length, Height, Quantity)
- Step 4: Auto-calculated preview before confirmation
- Navigation: "Next" and "Back" buttons, "Add Line Item" on final step

**Project Creation Form:**
- Single-page form in modal/dialog (max-w-2xl)
- Field groups with clear labels above inputs
- Input height: 40px for consistency
- Toggle switch for "Multiple Style Preferences" with helper text
- Primary action button: Full-width on mobile, right-aligned on desktop

**Room Creation:**
- Inline form in expandable panel
- Radio buttons for Room Type (Wet/Dry) displayed horizontally
- Category dropdown (if multi-style enabled)

### Interactive Elements

**Buttons:**
- Primary: Filled background, 40px height, px-6 padding, font-medium
- Secondary: Outlined border, same dimensions
- Icon buttons: 40x40px, rounded
- "Add" buttons: Always include + icon prefix

**Dropdowns/Select:**
- Custom styled with search capability for long lists
- Height: 40px
- Show item count when filtered (e.g., "12 items")

**Input Fields:**
- Height: 40px
- Border: 1px solid, rounded corners (rounded-md)
- Focus state: Ring with primary color
- Error state: Red border with error message below
- Number inputs: Right-aligned text for alignment

**Cards:**
- Border: 1px solid gray-200
- Border radius: rounded-lg
- Shadow: Subtle on hover, none by default
- Padding: p-6

### Status Indicators
- Badges for status (Draft/Generated): Rounded-full, px-3 py-1, text-xs
- Toast notifications for success/error actions
- Loading states: Spinner with text for data fetching

---

## Admin-Specific UI

**Admin Controls Panel:**
- Accessible from top nav dropdown
- Contains: "Refresh Catalog" button, "View All Projects" link, System settings
- Refresh Catalog: Shows last sync time, manual trigger button

**All Projects View (Admin):**
- Enhanced table with architect name column
- Filters: By architect, by date range, by status
- Export functionality

---

## Key UX Patterns

**Multi-Step Workflows:** Always show progress, allow going back, validate per step

**Calculations:** Display formulas on hover (e.g., "Length × Height = Sqft")

**Inline Editing:** Click-to-edit for dimensions with immediate recalculation feedback

**Empty States:** Helpful messages with clear CTAs (e.g., "No rooms yet. Add your first space to begin")

**Error Handling:** Inline validation messages, toast for system errors, fallback to cached data with warning banner

**Mobile Considerations:** 
- Bottom sheet for forms on mobile
- Horizontal scroll for tables with sticky first column
- Collapsible summary panel

---

This system prioritizes **data clarity, efficient workflows, and professional credibility** while maintaining consistency through Material Design principles adapted for a specialized B2B quotation tool.