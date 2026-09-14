/**
 * Read-only production verification for the grouped-room compatibility change.
 *
 * This deliberately does not import server/db.ts: that module uses DATABASE_URL.
 * The command below uses only NEON_DATABASE_URL and requires an explicit operator
 * acknowledgement:
 *
 *   CONFIRM_GROUPED_ROOM_COMPATIBILITY=I_UNDERSTAND \
 *   NEON_DATABASE_URL='...' \
 *   npx tsx scripts/verify-grouped-room-backward-compatibility.ts
 *
 * The transaction is REPEATABLE READ and READ ONLY. No migration or write is
 * needed when the production database has the legacy schema (without
 * room_subcategories and line_items.subcategory_id).
 */

import { createHash } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const CONFIRMATION = "I_UNDERSTAND";
const CONFIRMATION_ENV = "CONFIRM_GROUPED_ROOM_COMPATIBILITY";
const SCHEMA = "public";
const REQUIRED_TABLES = ["projects", "rooms", "line_items"] as const;

type JsonObject = Record<string, unknown>;
type QueryClient = {
  query<T = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  release(): void;
};

type ProjectCandidate = {
  id: string;
  project_type: string;
  room_count: number;
  line_item_count: number;
};

type Capability = {
  roomSubcategoriesTable: boolean;
  subcategoryIdColumn: boolean;
  groupingSupported: boolean;
};

type ProjectResult = {
  projectIds: string[];
  roomIds: string[];
  lineItemIds: string[];
  itemIdentityAndFields: boolean;
  fallback: boolean;
  detail: string;
  fingerprints: boolean;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

function fingerprint(rows: JsonObject[]): string {
  const payload = rows
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(canonical)
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

function asJsonRows<T extends JsonObject>(rows: T[]): JsonObject[] {
  return rows.map((row) => row);
}

function ids(rows: JsonObject[]): string[] {
  return rows.map((row) => String(row.id));
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function quote(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

async function tableExists(client: QueryClient, table: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
     ) AS exists`,
    [SCHEMA, table],
  );
  return result.rows[0]?.exists === true;
}

async function columnExists(client: QueryClient, table: string, column: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
     ) AS exists`,
    [SCHEMA, table, column],
  );
  return result.rows[0]?.exists === true;
}

async function rowsFor(
  client: QueryClient,
  table: "projects" | "rooms" | "line_items",
  projectIds: string[],
): Promise<JsonObject[]> {
  if (projectIds.length === 0) return [];
  const tableName = quote(table);
  const result = await client.query<{ row: JsonObject }>(
    `SELECT to_jsonb(t) AS row
       FROM ${quote(SCHEMA)}.${tableName} AS t
      WHERE t.project_id = ANY($1::text[])`,
    [projectIds],
  );
  return result.rows.map((resultRow) => resultRow.row);
}

async function projectRowsFor(
  client: QueryClient,
  projectIds: string[],
): Promise<JsonObject[]> {
  if (projectIds.length === 0) return [];
  const result = await client.query<{ row: JsonObject }>(
    `SELECT to_jsonb(t) AS row
       FROM ${quote(SCHEMA)}.${quote("projects")} AS t
      WHERE t.id = ANY($1::text[])`,
    [projectIds],
  );
  return result.rows.map((resultRow) => resultRow.row);
}

async function subcategoryRowsFor(
  client: QueryClient,
  roomIds: string[],
): Promise<JsonObject[]> {
  if (roomIds.length === 0) return [];
  const result = await client.query<{ row: JsonObject }>(
    `SELECT to_jsonb(t) AS row
       FROM ${quote(SCHEMA)}.${quote("room_subcategories")} AS t
      WHERE t.room_id = ANY($1::text[])`,
    [roomIds],
  );
  return result.rows.map((resultRow) => resultRow.row);
}

async function main(): Promise<void> {
  if (process.env[CONFIRMATION_ENV] !== CONFIRMATION) {
    throw new Error(
      `Refusing to run without ${CONFIRMATION_ENV}=${CONFIRMATION}. ` +
        "This command reads real production data; the acknowledgement is mandatory.",
    );
  }

  const databaseUrl = process.env.NEON_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "NEON_DATABASE_URL is required. This verifier intentionally does not read DATABASE_URL.",
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  let client: QueryClient | undefined;
  let committed = false;
  try {
    client = (await pool.connect()) as unknown as QueryClient;
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const missingTables: string[] = [];
    for (const table of REQUIRED_TABLES) {
      if (!(await tableExists(client, table))) missingTables.push(table);
    }
    if (missingTables.length > 0) {
      throw new Error(`Required production table(s) missing: ${missingTables.join(", ")}`);
    }

    const capability: Capability = {
      roomSubcategoriesTable: await tableExists(client, "room_subcategories"),
      subcategoryIdColumn: await columnExists(client, "line_items", "subcategory_id"),
      groupingSupported: false,
    };
    capability.groupingSupported =
      capability.roomSubcategoriesTable && capability.subcategoryIdColumn;

    const typeRows = await client.query<{ project_type: string | null }>(
      `SELECT DISTINCT project_type
         FROM ${quote(SCHEMA)}.${quote("projects")}
        WHERE project_type IS NOT NULL
        ORDER BY project_type`,
    );
    const projectTypes = typeRows.rows
      .map((row) => row.project_type)
      .filter((projectType): projectType is string => projectType !== null);
    if (projectTypes.length === 0) {
      throw new Error("No non-null project_type exists in production.");
    }

    const candidatesQuery = await client.query<ProjectCandidate>(
      `SELECT p.id,
              p.project_type,
              count(DISTINCT r.id)::int AS room_count,
              count(li.id)::int AS line_item_count
         FROM ${quote(SCHEMA)}.${quote("projects")} AS p
         JOIN ${quote(SCHEMA)}.${quote("rooms")} AS r ON r.project_id = p.id
         LEFT JOIN ${quote(SCHEMA)}.${quote("line_items")} AS li
           ON li.project_id = p.id
        WHERE p.project_type IS NOT NULL
        GROUP BY p.id, p.project_type
       HAVING count(DISTINCT r.id) >= 2 AND count(DISTINCT li.id) >= 2
        ORDER BY p.project_type, max(p.updated_at) DESC NULLS LAST, p.id`,
    );

    const selectedByType = new Map<string, ProjectCandidate[]>();
    for (const projectType of projectTypes) {
      const candidates = candidatesQuery.rows.filter(
        (candidate) => candidate.project_type === projectType,
      );
      if (candidates.length === 0) {
        throw new Error(
          `No project_type=${JSON.stringify(projectType)} has at least two rooms and two line items.`,
        );
      }
      // Verify several real quotations for every project type currently present.
      // Five keeps the production snapshot bounded while exercising more than a
      // one-off sample.
      selectedByType.set(projectType, candidates.slice(0, 5));
    }

    const selectedProjects = [...selectedByType.values()].flat();
    const selectedProjectIds = selectedProjects.map((project) => project.id);
    if ([...selectedByType.values()].some((projects) => projects.length < 5)) {
      throw new Error("Fewer than five qualifying projects exist for at least one production project type.");
    }

    const projectsBefore = asJsonRows(await projectRowsFor(client, selectedProjectIds));
    const roomsBefore = asJsonRows(await rowsFor(client, "rooms", selectedProjectIds));
    const lineItemsBefore = asJsonRows(
      await rowsFor(client, "line_items", selectedProjectIds),
    );
    const subcategories = capability.roomSubcategoriesTable
      ? await subcategoryRowsFor(client, ids(roomsBefore))
      : [];

    const roomsById = new Map<string, JsonObject>(
      roomsBefore.map((room) => [String(room.id), room]),
    );
    const subcategoriesById = new Map<string, JsonObject>(
      subcategories.map((subcategory) => [String(subcategory.id), subcategory]),
    );

    const results = new Map<string, ProjectResult>();
    for (const [projectType, selected] of selectedByType) {
      const typeProjectIds = new Set(selected.map((project) => project.id));
      const typeProjects = projectsBefore.filter((project) =>
        typeProjectIds.has(String(project.id)),
      );
      const typeRooms = roomsBefore.filter((room) =>
        typeProjectIds.has(String(room.project_id)),
      );
      const typeLineItems = lineItemsBefore.filter((lineItem) =>
        typeProjectIds.has(String(lineItem.project_id)),
      );
      const detailProblems: string[] = [];
      if (typeProjects.length !== selected.length) {
        detailProblems.push("project snapshot row count changed");
      }

      const roomModels = new Map<
        string,
        { directLineItems: JsonObject[]; subcategories: Map<string, JsonObject[]> }
      >();
      for (const room of typeRooms) {
        roomModels.set(String(room.id), {
          directLineItems: [],
          subcategories: new Map<string, JsonObject[]>(),
        });
      }

      const renderedItems: JsonObject[] = [];
      let fallbackOk = true;
      for (const lineItem of typeLineItems) {
        const roomId = String(lineItem.room_id);
        const roomModel = roomModels.get(roomId);
        if (!roomModel || String(lineItem.project_id) !== String(roomsById.get(roomId)?.project_id)) {
          detailProblems.push(`line item ${String(lineItem.id)} has no matching room`);
          continue;
        }

        let effectiveSubcategoryId: string | null = null;
        if (capability.groupingSupported && lineItem.subcategory_id != null) {
          const subcategoryId = String(lineItem.subcategory_id);
          const subcategory = subcategoriesById.get(subcategoryId);
          if (!subcategory || String(subcategory.room_id) !== roomId) {
            fallbackOk = false;
            detailProblems.push(`line item ${String(lineItem.id)} references an invalid subcategory`);
          } else {
            effectiveSubcategoryId = subcategoryId;
          }
        } else if (lineItem.subcategory_id != null && !capability.subcategoryIdColumn) {
          detailProblems.push(`line item ${String(lineItem.id)} unexpectedly has subcategory_id`);
          fallbackOk = false;
        } else if (lineItem.subcategory_id != null && !capability.roomSubcategoriesTable) {
          detailProblems.push(`line item ${String(lineItem.id)} has no subcategory table`);
          fallbackOk = false;
        }

        // This is the staging fallback: null subcategoryId is not dropped or
        // hidden; it stays directly under its room.
        const modelItem = { ...lineItem, subcategoryId: effectiveSubcategoryId };
        if (effectiveSubcategoryId === null) {
          roomModel.directLineItems.push(modelItem);
        } else {
          const items = roomModel.subcategories.get(effectiveSubcategoryId) ?? [];
          items.push(modelItem);
          roomModel.subcategories.set(effectiveSubcategoryId, items);
        }
        renderedItems.push(modelItem);
      }
      const directRenderedCount = [...roomModels.values()].reduce(
        (total, roomModel) => total + roomModel.directLineItems.length,
        0,
      );
      if (!capability.groupingSupported && directRenderedCount !== typeLineItems.length) {
        fallbackOk = false;
        detailProblems.push(
          "legacy rows were not all retained directly under their rooms",
        );
      }

      const sourceById = new Map(typeLineItems.map((lineItem) => [String(lineItem.id), lineItem]));
      const renderedCounts = new Map<string, number>();
      for (const renderedItem of renderedItems) {
        const id = String(renderedItem.id);
        renderedCounts.set(id, (renderedCounts.get(id) ?? 0) + 1);
      }
      let itemIdentityAndFields =
        renderedItems.length === typeLineItems.length &&
        sourceById.size === typeLineItems.length &&
        renderedCounts.size === sourceById.size;
      for (const [id, sourceItem] of sourceById) {
        const renderedCount = renderedCounts.get(id) ?? 0;
        const renderedItem = renderedItems.find((item) => String(item.id) === id);
        // subcategoryId is the model's camel-case grouping field. It is
        // synthetic when the legacy column is absent; every DB-persisted
        // snake-case field must still match the snapshot exactly.
        const renderedPersistedItem = renderedItem
          ? { ...renderedItem }
          : undefined;
        if (renderedPersistedItem) delete renderedPersistedItem.subcategoryId;
        if (
          renderedCount !== 1 ||
          !renderedItem ||
          !renderedPersistedItem ||
          !sameJson(sourceItem, renderedPersistedItem) ||
          String(sourceItem.id) !== String(renderedItem.id)
        ) {
          itemIdentityAndFields = false;
          detailProblems.push(`line item ${id} was not preserved exactly once`);
        }
      }

      const beforeProjectIds = ids(typeProjects);
      const beforeRoomIds = ids(typeRooms);
      const beforeLineItemIds = ids(typeLineItems);
      const projectFingerprint = fingerprint(typeProjects);
      const roomFingerprint = fingerprint(typeRooms);
      const lineItemFingerprint = fingerprint(typeLineItems);
      const afterProjects = asJsonRows(await projectRowsFor(client, beforeProjectIds));
      const afterRooms = asJsonRows(await rowsFor(client, "rooms", beforeProjectIds));
      const afterLineItems = asJsonRows(await rowsFor(client, "line_items", beforeProjectIds));
      const fingerprints =
        projectFingerprint === fingerprint(afterProjects.filter((row) => beforeProjectIds.includes(String(row.id)))) &&
        roomFingerprint === fingerprint(afterRooms.filter((row) => beforeRoomIds.includes(String(row.id)))) &&
        lineItemFingerprint ===
          fingerprint(afterLineItems.filter((row) => beforeLineItemIds.includes(String(row.id))));

      if (!fingerprints) detailProblems.push("project/room/line-item fingerprint changed");
      if (!itemIdentityAndFields) detailProblems.push("line-item identity/fields check failed");
      if (!fallbackOk) detailProblems.push("subcategory fallback check failed");

      results.set(projectType, {
        projectIds: beforeProjectIds,
        roomIds: beforeRoomIds,
        lineItemIds: beforeLineItemIds,
        itemIdentityAndFields,
        fallback: fallbackOk,
        detail: detailProblems.length > 0 ? detailProblems.join("; ") : "all checks passed",
        fingerprints,
      });
    }

    console.log("\nGROUPED-ROOM BACKWARD-COMPATIBILITY VERIFICATION");
    console.log("Database source: NEON_DATABASE_URL (credentials omitted)");
    console.log(`Transaction: REPEATABLE READ, READ ONLY`);
    console.log(
      `Schema capability: room_subcategories table=${capability.roomSubcategoriesTable ? "present" : "absent"}, ` +
        `line_items.subcategory_id column=${capability.subcategoryIdColumn ? "present" : "absent"}, ` +
        `grouping=${capability.groupingSupported ? "available" : "legacy fallback"}`,
    );
    console.log(
      "Legacy fallback: a line item with no subcategoryId is rendered directly under its room.",
    );
    console.log("\nPASS/FAIL MATRIX BY PROJECT TYPE");
    console.log("project_type | projects | rooms | line_items | item IDs + fields | fallback | DB fingerprints | result");
    console.log("-".repeat(122));

    let overallPass = true;
    for (const projectType of projectTypes) {
      const result = results.get(projectType);
      if (!result) {
        overallPass = false;
        console.log(`${projectType} | - | - | - | FAIL | FAIL | FAIL | FAIL`);
        continue;
      }
      const pass = result.itemIdentityAndFields && result.fallback && result.fingerprints;
      overallPass = overallPass && pass;
      console.log(
        `${projectType} | ${result.projectIds.length} | ${result.roomIds.length} | ` +
          `${result.lineItemIds.length} | ${result.itemIdentityAndFields ? "PASS" : "FAIL"} | ` +
          `${result.fallback ? "PASS" : "FAIL"} | ${result.fingerprints ? "PASS" : "FAIL"} | ` +
          `${pass ? "PASS" : "FAIL"}`,
      );
      if (!pass) console.log(`  detail: ${result.detail}`);
    }

    // One final whole-selection fingerprint comparison makes the no-write claim
    // visible in addition to each project-type row above.
    const projectsAfter = asJsonRows(await projectRowsFor(client, selectedProjectIds));
    const roomsAfter = asJsonRows(await rowsFor(client, "rooms", selectedProjectIds));
    const lineItemsAfter = asJsonRows(await rowsFor(client, "line_items", selectedProjectIds));
    const wholeFingerprintsUnchanged =
      fingerprint(projectsBefore) === fingerprint(projectsAfter) &&
      fingerprint(roomsBefore) === fingerprint(roomsAfter) &&
      fingerprint(lineItemsBefore) === fingerprint(lineItemsAfter);
    console.log(
      `\nWhole selected snapshot fingerprints (projects/rooms/line_items): ` +
        `${wholeFingerprintsUnchanged ? "PASS" : "FAIL"}`,
    );
    overallPass = overallPass && wholeFingerprintsUnchanged;
    console.log(`\nOVERALL: ${overallPass ? "PASS" : "FAIL"}`);
    if (!overallPass) {
      throw new Error("Grouped-room backward-compatibility verification failed.");
    }
    committed = true;
  } finally {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Could not roll back read-only verification transaction:", rollbackError);
        committed = false;
      }
      client.release();
    }
    await pool.end();
  }

  if (!committed) {
    throw new Error("Verification transaction did not close cleanly.");
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});