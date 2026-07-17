import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const INVENTORY_HEADING = "Complete Skill Inventory";
const ROUTES_HEADING = "Direct-Child Route Inventory";
const ESCALATION_ADOPTION_HEADING = "Capability Escalation Adoption Inventory";
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
const ESCALATION_ADOPTION_HEADERS = [
  "ID",
  "Adoption state",
  "Transition",
] as const;
const SEMANTIC_ROLE_HEADING = "Semantic role catalog";
const SEMANTIC_ROLE_HEADERS = [
  "Agent",
  "Capability",
  "Claude effort",
  "Codex effort",
  "Source default",
  "External default",
  "Primary use",
] as const;
const TOOL_ENVELOPE_HEADING = "Tool and sandbox behavior";
const TOOL_ENVELOPE_HEADERS = [
  "Agent",
  "Claude tools",
  "Codex sandbox",
  "Default network",
] as const;
const CLAUDE_TOOLS = [
  "Read",
  "Grep",
  "Bash",
  "Edit",
  "Write",
  "WebFetch",
  "WebSearch",
] as const;
const CODEX_SANDBOXES = ["workspace-write"] as const;
const DEFAULT_NETWORKS = ["None", "Dispatch-owned", "Task-owned"] as const;

const DEMANDS = ["mechanical", "bounded", "inherited", "synthesis"] as const;
const STANCES = ["normal", "adversarial"] as const;
const SOURCE_AUTHORITIES = ["source-immutable", "source-mutable"] as const;
const EXTERNAL_AUTHORITIES = ["none", "external-mutable"] as const;
const ESCALATION_ADOPTION_STATES = ["adopt", "specialize", "opt-out"] as const;
const NO_ADOPTION_TRANSITION = "none";

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
  readonly ownerSkill: string;
  readonly evidenceLabel: string;
  readonly evidenceLocator?: string;
  readonly clauses: readonly AgentRoutingRouteClause[];
  readonly d4Contract?: AgentRoutingD4RouteContract;
}

export interface AgentRoutingEscalationAdoptionRow {
  readonly id: `D${number}`;
  readonly state: (typeof ESCALATION_ADOPTION_STATES)[number];
  readonly transition: string;
}

export interface AgentRoutingD4RouteContract {
  readonly roleCardinality: 6;
  readonly selectionTiming: "before spawn";
  readonly configuration: "exact configured capability/effort";
  readonly sourceDefault: "matching source default";
  readonly scopeAndTermination: "scope/termination";
  readonly externalAuthority: "none";
}

export interface AgentRoutingRouteClause {
  readonly role: string;
  readonly capability: (typeof ROUTE_CAPABILITIES)[number];
  readonly effort: (typeof ROUTE_EFFORTS)[number];
  readonly sourceAuthority: SourceAuthority;
  readonly qualifier?: string;
}

export interface AgentRoutingPolicyOwner {
  readonly inventory: readonly AgentRoutingSkillInventoryRow[];
  readonly directChildRoutes: readonly AgentRoutingDirectChildRouteRow[];
  readonly escalationAdoptionInventory: readonly AgentRoutingEscalationAdoptionRow[];
}

export interface AgentSemanticRoleContract {
  readonly name: string;
  readonly capability: (typeof ROUTE_CAPABILITIES)[number];
  readonly claudeEffort: (typeof ROUTE_EFFORTS)[number];
  readonly codexEffort: (typeof ROUTE_EFFORTS)[number];
  readonly sourceAuthority: SourceAuthority;
  readonly externalAuthority: "none";
  readonly primaryUse: string;
  readonly claudeTools: readonly (typeof CLAUDE_TOOLS)[number][];
  readonly codexSandbox: (typeof CODEX_SANDBOXES)[number];
  readonly defaultNetwork: (typeof DEFAULT_NETWORKS)[number];
}

/** Reads the exact semantic-role and target-envelope owner in the agent spec. */
export async function readAgentSemanticRoleOwner(
  ownerRelativePath = "docs/specs/agents.md",
): Promise<readonly AgentSemanticRoleContract[]> {
  const ownerPath = resolveRepositoryRelativePath(ownerRelativePath);
  let markdown: string;
  try {
    markdown = await readFile(ownerPath, "utf8");
  } catch (error) {
    throw new Error(
      `Agent spec owner file is not readable: ${ownerRelativePath}`,
      {
        cause: error,
      },
    );
  }
  return parseAgentSemanticRoleOwner(markdown);
}

/** Pure parsing seam for focused agent-spec owner-integrity mutations. */
export function parseAgentSemanticRoleOwner(
  markdown: string,
): readonly AgentSemanticRoleContract[] {
  const roleRows = parseAgentSpecTable(
    markdown,
    "##",
    SEMANTIC_ROLE_HEADING,
    SEMANTIC_ROLE_HEADERS,
    "semantic-role",
  );
  const toolRows = parseAgentSpecTable(
    markdown,
    "###",
    TOOL_ENVELOPE_HEADING,
    TOOL_ENVELOPE_HEADERS,
    "tool-envelope",
  );
  const roles = roleRows.map((row, index) => ({
    name: exactCodeRole(row[0], `semantic-role identity at row ${index + 1}`),
    capability: closedValue(
      row[1],
      ROUTE_CAPABILITIES,
      "semantic-role capability",
    ),
    claudeEffort: closedValue(
      row[2],
      ROUTE_EFFORTS,
      "semantic-role Claude effort",
    ),
    codexEffort: closedValue(
      row[3],
      ROUTE_EFFORTS,
      "semantic-role Codex effort",
    ),
    sourceAuthority: exactCodeClosedValue(
      row[4],
      SOURCE_AUTHORITIES,
      "semantic-role source authority",
    ),
    externalAuthority: exactCodeClosedValue(
      row[5],
      ["none"] as const,
      "semantic-role external authority",
    ),
    primaryUse: row[6],
  }));
  const envelopes = toolRows.map((row, index) => ({
    name: exactCodeRole(row[0], `tool-envelope identity at row ${index + 1}`),
    claudeTools: row[1]
      .split(",")
      .map((tool) =>
        closedValue(tool.trim(), CLAUDE_TOOLS, "tool-envelope Claude tool"),
      ),
    codexSandbox: closedValue(
      row[2],
      CODEX_SANDBOXES,
      "tool-envelope Codex sandbox",
    ),
    defaultNetwork: closedValue(
      row[3],
      DEFAULT_NETWORKS,
      "tool-envelope default network",
    ),
  }));

  for (const envelope of envelopes) {
    assertUnique(
      envelope.claudeTools,
      `Claude tool in the ${envelope.name} tool envelope`,
    );
  }

  assertUnique(
    roles.map((role) => role.name),
    "semantic-role identity",
  );
  assertUnique(
    envelopes.map((role) => role.name),
    "tool-envelope identity",
  );
  if (roles.length !== 6) {
    throw new Error(
      `Agent spec semantic-role catalog must contain exactly six rows: ${roles.length}`,
    );
  }
  assertExactIdentitySet(
    envelopes.map((role) => role.name),
    roles.map((role) => role.name),
    "tool-envelope and semantic-role",
  );

  const envelopesByName = new Map(envelopes.map((row) => [row.name, row]));
  return roles.map((role) => {
    const envelope = envelopesByName.get(role.name);
    if (!envelope)
      throw new Error(
        `Agent spec is missing the tool envelope for ${role.name}`,
      );
    return { ...role, ...envelope };
  });
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
  const adoptionTable = parseOwnedTable(
    markdown,
    ESCALATION_ADOPTION_HEADING,
    ESCALATION_ADOPTION_HEADERS,
    "adoption",
  );
  const inventory = inventoryTable.map(parseInventoryRow);
  const knownSkills = new Set(inventory.map((row) => row.skill));
  const directChildRoutes = routeTable.map((cells, index) =>
    parseRouteRow(cells, index, knownSkills),
  );
  const escalationAdoptionInventory = adoptionTable.map(
    parseEscalationAdoptionRow,
  );

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
  assertUnique(
    escalationAdoptionInventory.map((row) => row.id),
    "escalation-adoption ID",
  );
  assertEscalationAdoptionCoverage(escalationAdoptionInventory);

  return { inventory, directChildRoutes, escalationAdoptionInventory };
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

function parseAgentSpecTable(
  markdown: string,
  headingLevel: "##" | "###",
  heading: string,
  expectedHeaders: readonly string[],
  dimension: string,
): readonly (readonly string[])[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...markdown.matchAll(
      new RegExp(`^${headingLevel} ${escapedHeading}\\s*$`, "gm"),
    ),
  ];
  if (matches.length !== 1) {
    throw new Error(
      `Agent spec ${dimension} heading must appear exactly once: ${heading}`,
    );
  }
  const start = (matches[0].index ?? 0) + matches[0][0].length;
  const rest = markdown.slice(start);
  const nextHeading = rest.search(/^#{1,3} /m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const lines = section.split(/\r?\n/).map((line) => line.trim());
  const tableStart = lines.findIndex((line) => line.startsWith("|"));
  const candidates = tableStart === -1 ? [] : lines.slice(tableStart);
  const tableEnd = candidates.findIndex((line) => !line.startsWith("|"));
  const tableLines = candidates.slice(
    0,
    tableEnd === -1 ? candidates.length : tableEnd,
  );
  if (tableLines.length < 3) {
    throw new Error(`Agent spec ${dimension} table is empty`);
  }
  const headers = splitTableRow(tableLines[0]);
  if (!sameValues(headers, expectedHeaders)) {
    throw new Error(
      `Agent spec ${dimension} headers must be: ${expectedHeaders.join(" | ")}`,
    );
  }
  const divider = splitTableRow(tableLines[1]);
  if (
    divider.length !== expectedHeaders.length ||
    !divider.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    throw new Error(`Agent spec ${dimension} table divider is malformed`);
  }
  return tableLines.slice(2).map((line, index) => {
    const cells = splitTableRow(line);
    if (
      cells.length !== expectedHeaders.length ||
      cells.some((cell) => !cell)
    ) {
      throw new Error(`Agent spec ${dimension} row ${index + 1} is malformed`);
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

function parseEscalationAdoptionRow(
  cells: readonly string[],
  index: number,
): AgentRoutingEscalationAdoptionRow {
  const id = cells[0];
  if (!/^D\d+$/.test(id)) {
    throw new Error(
      `Agent routing policy owner escalation-adoption ID at row ${index + 1} is invalid: ${id}`,
    );
  }
  const state = closedValue(
    cells[1],
    ESCALATION_ADOPTION_STATES,
    "adoption state",
  );
  if (state !== "opt-out") {
    throw new Error(
      `Agent routing policy owner adoption state is unsupported until exact declaration validation exists: ${state}`,
    );
  }
  if (state === "opt-out" && cells[2] !== NO_ADOPTION_TRANSITION) {
    throw new Error(
      `Agent routing policy owner adoption opt-out transition must be exactly: ${NO_ADOPTION_TRANSITION}`,
    );
  }
  return { id: id as `D${number}`, state, transition: cells[2] };
}

const ROUTE_CAPABILITIES = ["efficient", "balanced", "frontier"] as const;
const ROUTE_EFFORTS = ["medium", "high", "xhigh"] as const;
const ROUTE_CLAUSE_PATTERN =
  /^(?:(?:[A-Za-z][A-Za-z -]{0,38}:|Inline or)\s+)?`([a-z][a-z0-9-]*)`,\s*([a-z][a-z-]*)\/([a-z][a-z0-9-]*),\s*(source-[^,;\s]+)(?:,\s*([A-Za-z][A-Za-z -]{0,38}))?$/;
const ROUTE_CLAUSE_WITHOUT_SOURCE_PATTERN =
  /^(?:(?:[A-Za-z][A-Za-z -]{0,38}:|Inline or)\s+)?`[a-z][a-z0-9-]*`,\s*[a-z][a-z-]*\/[a-z][a-z0-9-]*\s*,?$/;

function parseRouteRow(
  cells: readonly string[],
  index: number,
  knownSkills: ReadonlySet<string>,
): AgentRoutingDirectChildRouteRow {
  const id = cells[0];
  if (!/^D\d+$/.test(id)) {
    throw new Error(
      `Agent routing policy owner direct-route ID at row ${index + 1} is invalid: ${id}`,
    );
  }

  const d4Contract = id === "D4" ? parseD4RouteContract(cells[2]) : undefined;
  const clauses = id === "D4" ? [] : parseRouteClauses(id, cells[2]);
  const [evidenceLabel, ownerSurface = ""] = cells[1].split(/\s+—\s+/, 2);
  const explicitOwners = [...ownerSurface.matchAll(/`([a-z][a-z0-9-]*)`/g)]
    .map((match) => match[1])
    .filter((name) => knownSkills.has(name));
  const ownerSkill =
    explicitOwners.length === 1
      ? explicitOwners[0]
      : /issue priming/i.test(ownerSurface)
        ? "issue-priming-workflow"
        : /execution/i.test(ownerSurface)
          ? "play-subagent-execution"
          : undefined;
  if (!ownerSkill) {
    throw new Error(
      `Agent routing policy owner direct-route ${id} must resolve exactly one owner skill`,
    );
  }
  const evidenceLocator = ownerSurface.match(/\b(?:Phase|Step)\s+\d+\b/i)?.[0];

  return {
    id: id as `D${number}`,
    surfaceAndOwner: cells[1],
    route: cells[2],
    existingOutputOrTermination: cells[3],
    ownerSkill,
    evidenceLabel,
    evidenceLocator,
    clauses,
    d4Contract,
  };
}

function parseD4RouteContract(route: string): AgentRoutingD4RouteContract {
  const segments = route.split(";").map((segment) => segment.trim());
  if (segments.length !== 4) {
    throw new Error(
      "Agent routing policy owner direct-route D4 must contain exactly four route dimensions",
    );
  }

  const selection =
    /^Resolve exactly one of the ([a-z]+) semantic roles (.+)$/.exec(
      segments[0],
    );
  const roleConfiguration = /^use its (.+) and (.+)$/.exec(segments[1]);
  const scopeAndTermination = /^declare (.+)$/.exec(segments[2]);
  const externalAuthority = /^external authority `([^`]+)`$/.exec(segments[3]);
  if (
    !selection ||
    !roleConfiguration ||
    !scopeAndTermination ||
    !externalAuthority
  ) {
    throw new Error(
      "Agent routing policy owner direct-route D4 has malformed route structure",
    );
  }

  closedValue(
    selection[1],
    ["six"] as const,
    "direct-route D4 role cardinality",
  );
  return {
    roleCardinality: 6,
    selectionTiming: closedValue(
      selection[2],
      ["before spawn"] as const,
      "direct-route D4 selection timing",
    ),
    configuration: closedValue(
      roleConfiguration[1],
      ["exact configured capability/effort"] as const,
      "direct-route D4 configured capability and effort",
    ),
    sourceDefault: closedValue(
      roleConfiguration[2],
      ["matching source default"] as const,
      "direct-route D4 source default",
    ),
    scopeAndTermination: closedValue(
      scopeAndTermination[1],
      ["scope/termination"] as const,
      "direct-route D4 scope and termination",
    ),
    externalAuthority: closedValue(
      externalAuthority[1],
      ["none"] as const,
      "direct-route D4 external authority",
    ),
  };
}

function parseRouteClauses(
  id: string,
  route: string,
): readonly AgentRoutingRouteClause[] {
  const clauses = route.split(";").map((clause) => clause.trim());

  const requiredMultiplicity = id === "D17" ? 3 : 1;
  if (clauses.length !== requiredMultiplicity) {
    throw new Error(
      `Agent routing policy owner direct-route ${id} must contain exactly ${requiredMultiplicity} route clause${requiredMultiplicity === 1 ? "" : "s"}`,
    );
  }

  return clauses.map((clause, index) => {
    const tuple = ROUTE_CLAUSE_PATTERN.exec(clause);
    if (!tuple && ROUTE_CLAUSE_WITHOUT_SOURCE_PATTERN.test(clause)) {
      throw new Error(
        `Agent routing policy owner direct-route ${id} clause ${index + 1} is missing a source authority dimension`,
      );
    }
    if (!tuple) {
      throw new Error(
        `Agent routing policy owner direct-route ${id} clause ${index + 1} has malformed clause structure`,
      );
    }

    return {
      role: tuple[1],
      capability: closedValue(
        tuple[2],
        ROUTE_CAPABILITIES,
        `direct-route ${id} capability`,
      ),
      effort: closedValue(tuple[3], ROUTE_EFFORTS, `direct-route ${id} effort`),
      sourceAuthority: closedValue(
        tuple[4],
        SOURCE_AUTHORITIES,
        `direct-route ${id} source authority`,
      ),
      qualifier: tuple[5],
    };
  });
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

function assertEscalationAdoptionCoverage(
  rows: readonly AgentRoutingEscalationAdoptionRow[],
): void {
  const expected: readonly `D${number}`[] = Array.from(
    { length: 17 },
    (_, index) => `D${index + 1}` as const,
  );
  const actual = new Set(rows.map((row) => row.id));
  const missing = expected.filter((id) => !actual.has(id));
  const unexpected = rows
    .map((row) => row.id)
    .filter((id) => !expected.includes(id));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Agent routing policy owner escalation-adoption ID coverage must be exactly D1-D17; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
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

function assertExactIdentitySet(
  actual: readonly string[],
  expected: readonly string[],
  dimension: string,
): void {
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const unexpected = actual.filter((value) => !expected.includes(value));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Agent spec ${dimension} identities must match exactly; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }
}

function exactCodeClosedValue<const Values extends readonly string[]>(
  value: string,
  allowed: Values,
  dimension: string,
): Values[number] {
  const match = /^`([^`]+)`$/.exec(value);
  if (!match) {
    throw new Error(
      `Agent spec ${dimension} must be one exact code token: ${value}`,
    );
  }
  return closedValue(match[1], allowed, dimension);
}

function exactCodeRole(value: string, dimension: string): string {
  const match = /^`([a-z][a-z0-9-]*)`$/.exec(value);
  if (!match) {
    throw new Error(
      `Agent spec ${dimension} must be one exact backticked role token: ${value}`,
    );
  }
  return match[1];
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
