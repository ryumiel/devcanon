import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const INVENTORY_HEADING = "Complete Skill Inventory";
const ROUTES_HEADING = "Direct-Child Route Inventory";
const INVENTORY_HEADERS = [
  "Skill",
  "Demand / stance",
  "Source authority",
  "External authority",
  "Material override / owner note",
] as const;
const ROUTE_HEADERS = [
  "ID",
  "Surface and owner",
  "Route",
  "Existing output / termination",
] as const;

const DEMANDS = ["mechanical", "bounded", "inherited", "synthesis"] as const;
const STANCES = ["normal", "adversarial"] as const;
const SOURCE_AUTHORITIES = ["source-immutable", "source-mutable"] as const;
const EXTERNAL_AUTHORITIES = ["none", "external-mutable"] as const;

type Demand = (typeof DEMANDS)[number];
type Stance = (typeof STANCES)[number];
type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];
type ExternalAuthority = (typeof EXTERNAL_AUTHORITIES)[number];

export interface AgentRoutingSkillInventoryRow {
  readonly skill: string;
  readonly demand: Demand;
  readonly stance: Stance;
  readonly sourceAuthority: SourceAuthority;
  readonly externalAuthority: ExternalAuthority;
  readonly materialOverrideOrOwnerNote: string;
}

export interface AgentRoutingDirectChildRouteRow {
  readonly id: `D${number}`;
  readonly surfaceAndOwner: string;
  readonly route: string;
  readonly existingOutputOrTermination: string;
}

export interface AgentRoutingPolicyOwner {
  readonly inventory: readonly AgentRoutingSkillInventoryRow[];
  readonly directChildRoutes: readonly AgentRoutingDirectChildRouteRow[];
}

/** Reads and validates the Markdown owner used by primary-layer contract tests. */
export async function readAgentRoutingPolicyOwner(
  ownerRelativePath: string,
): Promise<AgentRoutingPolicyOwner> {
  const ownerPath = resolveRepositoryRelativePath(ownerRelativePath);
  let markdown: string;

  try {
    markdown = await readFile(ownerPath, "utf8");
  } catch (error) {
    throw new Error(
      `Agent routing policy owner file is not readable: ${ownerRelativePath}`,
      { cause: error },
    );
  }

  const sourceSkills = await readSourceSkillNames();
  return parseAgentRoutingPolicyOwner(markdown, sourceSkills);
}

/** Pure parsing seam for focused single-dimension mutation tests. */
export function parseAgentRoutingPolicyOwner(
  markdown: string,
  sourceSkills: readonly string[],
): AgentRoutingPolicyOwner {
  if (markdown.trim() === "") {
    throw new Error("Agent routing policy owner file is empty");
  }

  const inventoryTable = parseOwnedTable(
    markdown,
    INVENTORY_HEADING,
    INVENTORY_HEADERS,
    "inventory",
  );
  const routeTable = parseOwnedTable(
    markdown,
    ROUTES_HEADING,
    ROUTE_HEADERS,
    "direct-route",
  );
  const inventory = inventoryTable.map(parseInventoryRow);
  const directChildRoutes = routeTable.map(parseRouteRow);

  assertUnique(
    inventory.map((row) => row.skill),
    "inventory skill",
  );
  assertInventoryCoverage(inventory, sourceSkills);
  assertUnique(
    directChildRoutes.map((row) => row.id),
    "direct-route ID",
  );
  assertDirectRouteCoverage(directChildRoutes);

  return { inventory, directChildRoutes };
}

function resolveRepositoryRelativePath(relativePath: string): string {
  if (relativePath.trim() === "" || path.isAbsolute(relativePath)) {
    throw new Error(
      `Agent routing policy owner path must be repository-relative: ${relativePath}`,
    );
  }

  const repositoryRoot = process.cwd();
  const resolved = path.resolve(repositoryRoot, relativePath);
  const relation = path.relative(repositoryRoot, resolved);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error(
      `Agent routing policy owner path escapes the repository: ${relativePath}`,
    );
  }
  return resolved;
}

async function readSourceSkillNames(): Promise<readonly string[]> {
  const skillsRoot = path.join(process.cwd(), "skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skillNames = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          await access(path.join(skillsRoot, entry.name, "SKILL.md"));
          return entry.name;
        } catch {
          return undefined;
        }
      }),
  );
  return skillNames.filter((name): name is string => name !== undefined).sort();
}

function parseOwnedTable(
  markdown: string,
  heading: string,
  expectedHeaders: readonly string[],
  dimension: string,
): readonly (readonly string[])[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingMatches = [
    ...markdown.matchAll(new RegExp(`^## ${escapedHeading}\\s*$`, "gm")),
  ];
  if (headingMatches.length !== 1) {
    throw new Error(
      `Agent routing policy owner ${dimension} heading must appear exactly once: ${heading}`,
    );
  }

  const start = (headingMatches[0].index ?? 0) + headingMatches[0][0].length;
  const rest = markdown.slice(start);
  const nextHeading = rest.search(/^## /m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const sectionLines = section.split(/\r?\n/).map((line) => line.trim());
  const tableStart = sectionLines.findIndex((line) => line.startsWith("|"));
  const candidateLines =
    tableStart === -1 ? [] : sectionLines.slice(tableStart);
  const tableEnd = candidateLines.findIndex((line) => !line.startsWith("|"));
  const tableLines = candidateLines.slice(
    0,
    tableEnd === -1 ? candidateLines.length : tableEnd,
  );

  if (tableLines.length < 3) {
    throw new Error(`Agent routing policy owner ${dimension} table is empty`);
  }

  const headers = splitTableRow(tableLines[0]);
  if (!sameValues(headers, expectedHeaders)) {
    throw new Error(
      `Agent routing policy owner ${dimension} headers must be: ${expectedHeaders.join(" | ")}`,
    );
  }
  const divider = splitTableRow(tableLines[1]);
  if (
    divider.length !== expectedHeaders.length ||
    !divider.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    throw new Error(
      `Agent routing policy owner ${dimension} table divider is malformed`,
    );
  }

  return tableLines.slice(2).map((line, index) => {
    const cells = splitTableRow(line);
    if (
      cells.length !== expectedHeaders.length ||
      cells.some((cell) => !cell)
    ) {
      throw new Error(
        `Agent routing policy owner ${dimension} row ${index + 1} is malformed`,
      );
    }
    return cells;
  });
}

function splitTableRow(line: string): readonly string[] {
  return line
    .slice(1, line.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((cell) => cell.trim());
}

function parseInventoryRow(
  cells: readonly string[],
  index: number,
): AgentRoutingSkillInventoryRow {
  const skill = unwrapCode(cells[0]);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) {
    throw new Error(
      `Agent routing policy owner inventory skill at row ${index + 1} is invalid: ${cells[0]}`,
    );
  }

  const demandAndStance = cells[1].split(" / ");
  if (demandAndStance.length !== 2) {
    throw new Error(
      `Agent routing policy owner inventory demand / stance at row ${index + 1} is malformed`,
    );
  }
  const demand = closedValue(demandAndStance[0], DEMANDS, "inventory demand");
  const stance = closedValue(demandAndStance[1], STANCES, "inventory stance");
  const sourceAuthority = closedValue(
    cells[2],
    SOURCE_AUTHORITIES,
    "inventory source authority",
  );
  const externalAuthority = closedValue(
    cells[3],
    EXTERNAL_AUTHORITIES,
    "inventory external authority",
  );

  return {
    skill,
    demand,
    stance,
    sourceAuthority,
    externalAuthority,
    materialOverrideOrOwnerNote: cells[4],
  };
}

const ROUTE_CAPABILITIES = ["efficient", "balanced", "frontier"] as const;
const ROUTE_EFFORTS = ["medium", "high", "xhigh"] as const;

function parseRouteRow(
  cells: readonly string[],
  index: number,
): AgentRoutingDirectChildRouteRow {
  const id = cells[0];
  if (!/^D\d+$/.test(id)) {
    throw new Error(
      `Agent routing policy owner direct-route ID at row ${index + 1} is invalid: ${id}`,
    );
  }

  if (id === "D4") {
    if (
      !cells[2].includes("six semantic roles") ||
      !cells[2].includes("source default") ||
      !cells[2].includes("external authority `none`")
    ) {
      throw new Error(
        "Agent routing policy owner direct-route D4 is missing a closed dispatch field",
      );
    }
  } else {
    validateRouteTuples(id, cells[2]);
  }

  return {
    id: id as `D${number}`,
    surfaceAndOwner: cells[1],
    route: cells[2],
    existingOutputOrTermination: cells[3],
  };
}

function validateRouteTuples(id: string, route: string): void {
  const tuplePrefixes =
    route.match(/`?[a-z][a-z0-9-]*`?,\s*[a-z][a-z-]*\/[a-z][a-z0-9-]*/g) ?? [];
  const tuplePattern =
    /`?([a-z][a-z0-9-]*)`?,\s*([a-z][a-z-]*)\/([a-z][a-z0-9-]*),\s*(source-[a-z-]+)/g;
  const tuples = [...route.matchAll(tuplePattern)];
  if (tuplePrefixes.length !== tuples.length) {
    throw new Error(
      `Agent routing policy owner direct-route ${id} is missing a source authority dimension`,
    );
  }
  if (tuples.length === 0) {
    throw new Error(
      `Agent routing policy owner direct-route ${id} is missing a required role/capability/effort/source tuple`,
    );
  }

  for (const tuple of tuples) {
    closedValue(tuple[2], ROUTE_CAPABILITIES, `direct-route ${id} capability`);
    closedValue(tuple[3], ROUTE_EFFORTS, `direct-route ${id} effort`);
    closedValue(
      tuple[4],
      SOURCE_AUTHORITIES,
      `direct-route ${id} source authority`,
    );
  }
}

function assertInventoryCoverage(
  inventory: readonly AgentRoutingSkillInventoryRow[],
  sourceSkills: readonly string[],
): void {
  const inventorySkills = new Set(inventory.map((row) => row.skill));
  const sourceSkillSet = new Set(sourceSkills);
  const missing = sourceSkills.filter((skill) => !inventorySkills.has(skill));
  const unknown = inventory
    .map((row) => row.skill)
    .filter((skill) => !sourceSkillSet.has(skill));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `Agent routing policy owner inventory source-skill coverage mismatch; missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}`,
    );
  }
}

function assertDirectRouteCoverage(
  routes: readonly AgentRoutingDirectChildRouteRow[],
): void {
  const expected: readonly `D${number}`[] = Array.from(
    { length: 17 },
    (_, index) => `D${index + 1}` as const,
  );
  const actual = new Set(routes.map((row) => row.id));
  const missing = expected.filter((id) => !actual.has(id));
  const unexpected = routes
    .map((row) => row.id)
    .filter((id) => !expected.includes(id));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Agent routing policy owner direct-route ID coverage must be exactly D1-D17; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }
}

function assertUnique(values: readonly string[], dimension: string): void {
  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index,
  );
  if (duplicates.length > 0) {
    throw new Error(
      `Agent routing policy owner duplicate ${dimension}: ${[...new Set(duplicates)].join(", ")}`,
    );
  }
}

function closedValue<const Values extends readonly string[]>(
  value: string,
  allowed: Values,
  dimension: string,
): Values[number] {
  if (!allowed.includes(value)) {
    throw new Error(
      `Agent routing policy owner ${dimension} has invalid closed value: ${value}`,
    );
  }
  return value as Values[number];
}

function unwrapCode(value: string): string {
  return value.startsWith("`") && value.endsWith("`")
    ? value.slice(1, -1)
    : value;
}

function sameValues(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, i) => value === expected[i])
  );
}
