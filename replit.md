# Quote Builder - Dynamic Quotation System

## Overview

This B2B SaaS application empowers interior designers and architects to generate professional, detailed project quotations. It facilitates the organization of projects by rooms and line items, leveraging a Google Sheets catalog for material specifications and dynamic pricing. Key capabilities include a multi-step project creation workflow, management of line items with real-time rate calculations, and instant quotation summaries incorporating markup and GST. The system ensures backward compatibility for legacy projects while integrating new category structures. The project aims to provide a robust, efficient, and user-friendly tool to streamline the quotation process in the interior design and architecture industry.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend is a React application built with TypeScript and Vite. It uses Wouter for routing, managing different views for authenticated and unauthenticated users, including a dashboard, project/room details, admin interfaces, and a public client portal. State management relies solely on TanStack Query for server state, API interactions, and caching. The UI is built with shadcn/ui (Radix UI primitives) and styled with Tailwind CSS, adhering to Material Design principles for a professional B2B experience, with Inter and JetBrains Mono fonts for typography. Form handling is managed by React Hook Form with Zod for robust validation.

### Backend

The backend is an Express.js application with TypeScript. It provides a RESTful API for managing projects, rooms, line items, and catalog data. Authentication is handled via Replit Auth (OIDC-based) with a three-tier role-based access control system (`super_admin`, `admin`, `user`) and robust authorization checks at the route level. User management supports admin provisioning and OIDC identity linking. Development uses Vite middleware for HMR, while production serves static assets. Custom middleware is used for request logging and performance monitoring.

### Project Editing

Users can edit project details (client name and PID) directly from the project detail page header:
- An edit button (pencil icon) appears next to the client name for non-finalized (Draft) projects
- The PID is displayed in parentheses next to the client name when set
- Edit dialog allows updating both client name and project ID (PID)
- Changes are persisted via PATCH /api/projects/:id endpoint
- Edit functionality is hidden for finalized projects (status = "Generated")

### Security Features

-   **Finalization Lock**: When a project status is "Generated" (finalized), all modification endpoints return 403 errors. UI controls for editing are hidden.
-   **Share Link Expiration**: Share links automatically expire after 30 days. The `shareExpiresAt` and `shareLastAccessedAt` fields track expiration and access.
-   **Data Validation**: Line items enforce validation rules - descriptions cannot be blank, quantities must be positive, and rates/dimensions cannot be negative.
-   **Public API Filtering**: The public company settings endpoint filters out sensitive data (PAN number, bank details) while keeping legally required fields (GST number).

### Data Storage

PostgreSQL is the primary database, accessed via the Neon serverless driver for scalability. Drizzle ORM is used for type-safe database interactions, with a schema-first design. The schema includes tables for Users, Projects, Rooms, Line Items, Catalog Items, Clients, and Catalog Sync Logs, all utilizing UUID primary keys and managing referential integrity with cascading deletes. Drizzle Kit handles schema migrations, and Drizzle Zod ensures consistent validation.

### Client Management

Users can create and manage client records (name, email, phone, address) which are linked to projects. When creating a project, users can either select an existing client or create a new one. Client data is scoped per user - each user can only access their own clients.

### Quote Analytics

The Analytics page (`/analytics`) provides users with insights into their quotation activity:
- Total quote count and value
- Average quote value
- Status breakdown (Draft vs Generated/Finalized)
- Monthly trends for quote activity
- Value breakdown by status

Analytics are strictly scoped to the current user's own projects only (not team members' projects).

### Design Credits System

The Design Credits system (`/admin/credits`) enables tracking of client pre-payments and milestone-based project billing:

**Core Workflow:**
1. Client pays advance → Admin adds credits to project
2. Designer creates milestones with amounts and descriptions
3. Designer submits milestone for completion
4. Manager (admin) approves/rejects submission
5. On approval, credits are automatically deducted from project balance
6. Rejected milestones can be resubmitted after revision

**Mandatory Credits:**
- Every project automatically gets a credits record (initialized at zero) upon creation
- All existing projects have been backfilled with credits records
- Credits summary card is displayed on every project detail page (right column, above quotation summary)

**Admin Credits Dashboard (`/admin/credits`):**
- Real-time overview of all projects' credit balances, milestone counts, and pending approvals
- Summary metrics: total credits in system, used, available, projects with zero credits, pending approvals
- Searchable, paginated project table (15 per page) with credit status, owner, milestone badges
- Each row has "Manage" link navigating to `/admin/credits/:projectId` (dedicated per-project page)
- Accessible from Admin Dashboard header via "Credits" button

**Per-Project Credits Detail (`/admin/credits/:projectId`):**
- Dedicated page for managing a single project's credits, milestones, and transactions
- Credit balance cards (total, used, available), Add Credits dialog, Milestones tab, Transaction History tab
- Back navigation to credits overview, "View Project" link to project detail page
- Master-detail pattern: overview table → click Manage → project detail page (no scrolling past unrelated projects)

**Client Credits Portal (`/client/credits/:shareToken`):**
- Public, read-only page for clients to view their credit balance, milestone progress, and transaction history
- Accessed via a shareable link generated by admins from the per-project credits detail page
- No login required; secured by cryptographically random share token (crypto.randomBytes)
- Share links expire after 30 days; expired links show a clear expiration message
- Company branding (logo, name, contact info) displayed in header
- Admins can generate, regenerate, copy, and revoke share links from the "Share with Client" dialog

**Database Schema:**
- `project_credits`: Tracks credit balance per project (available, used, total, creditsShareToken, creditsShareExpiresAt, projectWallet, walletFunded, walletBalance)
- `credit_requests`: Credit request queue with type-based requests (Project Initiation=1000, Project Top-up=500), status tracking (pending/approved/rejected)
- `milestones`: Milestone records with milestoneType (7 predefined types with fixed amounts), status (pending/submitted/approved/rejected)
- `credit_transactions`: Audit log of all credit movements (additions, deductions, refunds)
- `wallet_funding_entries`: Individual wallet funding records with amount, date, notes

**Structured Credit System:**
- Fixed credit request types: Project Initiation (1000 credits), Project Top-up (500 credits)
- Credit caps: 1500 for designers, 2000 for admins (enforced server-side)
- 7 predefined milestone types: 5 mandatory (Site Documentation=150, Layout Finalisation=200, Design Finalisation=150, Validation GFC=150, Final Design Sign-off=200) + 2 additional (Layout Change per room=75, Design Revision per room=50)
- Mandatory milestones total: 850 credits; duplicate milestone types blocked per project
- All credit additions require approval workflow
- Display convention: Credits shown as "X Credits" (no ₹ symbol); Wallet/Payment amounts shown with ₹

**Payment Schedule (Tiered):**
- Based on project value (grand total): ≤15L (₹50K advance), 15-30L (₹1L advance), >30L (₹1.5L advance)
- Schedule: Token Advance → Design Sign-off (60% - Advance) → Material Delivery (40%) → Retention (₹20K)
- Displayed in both PDF quotation and client portal

**Project Wallet:**
- projectWallet: Total project value; walletFunded: Payments received; walletBalance: Balance due
- Manual funding entries tracked with timestamps and notes

**Role-Based Access:**
- **Users (Designers)**: Create milestones (from predefined types), submit/resubmit for approval, request credits (capped at 1500), view own project credits
- **Admins (Managers)**: Approve/reject credit requests and milestones, view all credits, access credits dashboard, manage wallet funding (capped at 2000 credits)
- **Super Admins**: Full access to all credit operations

**Business Rules:**
- Credits are non-refundable and non-transferable
- Milestones use fixed amounts from predefined types (no free-text amounts)
- Milestones cannot exceed available credit balance (validated both client-side and server-side)
- All transactions are logged with timestamps and user references
- Rejected milestones can be resubmitted after revision
- Milestone approval is wrapped in a database transaction (prevents double-spending race conditions)
- Discount column shown in PDF for woodwork items when project has discount > 0

### Shared Calculation Engine

All quotation totals (woodworks, services, accessories, enablement fee, GST, grand total) and payment schedule logic are centralized in `shared/calculations.ts`. This single source of truth is imported by both the frontend (QuotationSummary, PrintableQuotation) and backend (payment schedule API, server-side PDF, client portal). This prevents calculation drift between UI and API outputs.

Key functions:
- `computeQuotationTotals(lineItems, markup, discount)` — returns all category subtotals, GST, enablement fee, and grand total
- `computePaymentSchedule(grandTotal)` — returns tiered payment schedule (token advance, design sign-off, material delivery, retention)

### Design System and Quotation Logic

The application follows a Material Design approach, emphasizing clarity and efficient workflows. A key feature is the dynamic quotation testing and validation system. It creates projects from Golden Quotation (GQ) Google Sheets data, parsing multi-section sheets and dynamically detecting column headers. The system accounts for manual adjustments common in real-world quotations by applying a "Strict Tolerance" (±₹0.50) for overall project totals and a "Lenient Tolerance" (±₹10) for line items and room subtotals, classifying discrepancies into "Match", "Minor Rounding", or "Discrepancy".

### Multi-Category Line Item Wizard

The Add Line Item wizard supports 6 item categories per room:
- **Woodwork** (Xpress/Xpand/Xclusive): 6-7 step flow (Item Type → Unit Type → Finish → [Handle if available] → Description → Dimensions → Review)
- **Accessories**: 6-step flow (Item Type → Unit Type → Brand → Description → Qty → Review)
- **Handles**: 6-7 step flow (Item Type → Unit Type → Size → [Image if available] → Description → Qty → Review) - uses materialType for size filtering, supports optional product image selection with auto-populated description
- **Services**: 5-step flow (Item Type → Unit Type → Description → Qty → Review) - no Work Type step
- **Lights**: 5-step flow with quantity-only input
- **Stone/Quartz**: 5-step flow with quantity-only input

Pricing logic:
- Woodwork: rate × sqft × quantity (area-based)
- Non-woodwork: rate × quantity (per-unit)

**Pricing Architecture**: The AddLineItemWizard is the single source of truth for rate selection. It passes both the rate and catalogItemId directly to the server, avoiding any re-lookup from unfiltered catalog data. This ensures Xpress, Xpand, and Xclusive items (which may have similar descriptions but different pricing) always capture the correct category-specific rate.

Rate and Sqft values are used internally for calculations but hidden from user UI (line item tables, review steps, edit dialogs, PDF exports).

### Product Image Support

The catalog schema supports product images via the `imageUrl` field:
- Images are displayed in the wizard's Review step when available
- Image URLs are stored in the `catalog_items.image_url` column
- Images should be hosted externally and referenced by URL in Google Sheets
- The system gracefully handles missing or broken image links

### Catalog Pricing Versions

The catalog is versioned. Each project is stamped with the pricing version it was created
with, and the server resolves which catalog a request sees from that stamp, so reopening an
old quotation shows the prices it was built with even after the catalog is republished.
Requests with no project context see the active version. A Draft is the working copy that
the Google Sheet syncs into; it only affects anyone once published.

Live since 10 August 2026, with all existing quotations attached to V1 - Initial Catalog.
See `docs/pricing-versions-guide.md` for the team-facing guide: how prices are raised and
published, what happens to existing, new and duplicated quotations, and how to undo a price
rise.

## External Dependencies

-   **Google Sheets API v4**: Used for catalog data synchronization. Authenticates via Replit Connectors (OAuth2). It syncs 8 DeX catalog sheets, handling metadata-driven sheet discovery by stable GID and a hybrid persistence strategy (Sheets → PostgreSQL → in-memory cache). Includes intelligent multi-select parsing and data quality tracking.
-   **Replit Infrastructure**: Leverages Replit Connectors for Google Sheets OAuth and Replit's Neon integration for PostgreSQL database hosting.
-   **CRM callback configuration**: Set `CRM_PRODUCTION_BASE_URL` to the CRM base URL (production: `https://fyx.interiorsbydex.com`) and store the shared `CRM_CALLBACK_SECRET` as a Replit Secret. The application posts generated CRM-linked quotations to `/api/quotes/callback`; the secret must never be placed in source code.
-   **Third-Party Libraries**:
    -   `@radix-ui/*`: UI primitives for accessibility.
    -   `Tailwind CSS`: For styling and custom design tokens.
    -   `date-fns`: For date manipulation.
    -   `Lucide React`: For iconography.
    -   `ws`: For WebSocket support with Neon driver.
-   **Build & Development Tools**: `esbuild` (server bundling), `Vite` (client bundling), `TypeScript`, `tsx`, `PostCSS`.