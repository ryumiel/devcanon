import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { resolveCapabilityModel } from "../render/capability-profiles.js";

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
const ESCALATION_ANCHOR = "escalation-adoption-anchor";
const COMMON_OWNER_PATH = "skills/subagent-lifecycle/SKILL.md";
const INVENTORY_OWNER_PATH =
  "docs/guidelines/agent-routing-and-mutation-policy.md";
const ESCALATION_PROJECTIONS = [
  [
    "ESC-ADR-0027",
    "docs/adr/adr-0027-semantic-agent-routing-and-mutation-authority.md",
    "reference-consumer",
    [],
    [],
    "non-owner",
  ],
  [
    "ESC-AGENT-AUTHORING",
    "docs/guidelines/agent-authoring-guide.md",
    "authoring-consumer",
    [],
    [],
    "non-owner",
  ],
  [
    "ESC-WRITING-SKILLS",
    "docs/guidelines/writing-skills.md",
    "authoring-consumer",
    [],
    [],
    "non-owner",
  ],
  [
    "ESC-AFDS-ROUTING",
    "docs/specs/afds-workflow-routing.md",
    "reference-consumer",
    [],
    [],
    "non-owner",
  ],
  [
    "ESC-AGENT-ROLES",
    "docs/specs/agents.md",
    "semantic-role-owner",
    ["D4"],
    [],
    "role-tuples-only",
  ],
  [
    "ESC-ISSUE-PRIMING",
    "skills/issue-priming-workflow/SKILL.md",
    "workflow-consumer",
    ["D1", "D2", "D3"],
    ["ESC-ADOPT-D1", "ESC-ADOPT-D2", "ESC-ADOPT-D3"],
    "non-owner",
  ],
  [
    "ESC-EXECUTION-LIFECYCLE",
    "skills/play-subagent-execution/references/lifecycle-status-policy.md",
    "workflow-consumer",
    ["D12", "D13"],
    ["ESC-ADOPT-D12", "ESC-ADOPT-D13"],
    "non-owner",
  ],
  [
    "ESC-PR-MERGE",
    "skills/pr-merge/SKILL.md",
    "workflow-consumer",
    ["D17"],
    ["ESC-ADOPT-D17"],
    "non-owner",
  ],
] as const;

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
  readonly branchId?: string;
  readonly selectionMode?: string;
  readonly networkBinding?: string;
  readonly evidenceQualifier?: string;
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

export interface CapabilityEscalationAdoptionContract {
  readonly contractId: "capability-escalation-adoption";
  readonly commonOwnerPath: typeof COMMON_OWNER_PATH;
  readonly inventoryOwnerPath: typeof INVENTORY_OWNER_PATH;
  readonly adoptions: readonly CapabilityEscalationAdoptionRecord[];
  readonly d4RouteSet: CapabilityEscalationD4RouteSet;
  readonly projections: readonly CapabilityEscalationProjection[];
}

export interface CapabilityEscalationAdoptionRecord {
  readonly routeId: `D${number}`;
  readonly adoptionRef: `ESC-ADOPT-D${number}`;
  readonly targetIds: readonly ("claude" | "codex")[];
  readonly targetPermission: "exact-only";
  readonly rolePermission: "same-role-must-match" | "selected-role-must-match";
  readonly directRouteClauses?: readonly CapabilityEscalationDirectRouteClause[];
  readonly directRouteRoleIds?: readonly string[];
  readonly currentState: "opt-out";
  readonly transition: "none";
  readonly nextTuple: "none";
  readonly mechanism: "none";
  readonly escalationBudget: "none";
  readonly relation: "none" | "D13-to-D12-reclassification";
  readonly counter: "none" | "independent-from-escalation";
  readonly producerSourcePath: string;
}

export interface CapabilityEscalationDirectRouteClause {
  readonly roleId: string;
  readonly branchId?: string;
  readonly selectionMode?: string;
  readonly networkBinding?: string;
  readonly evidenceQualifier?: string;
}

export interface CapabilityEscalationD4RouteSet {
  readonly routeId: "D4";
  readonly allowedRoleIds: readonly string[];
  readonly selectionMode: "planner-selected";
  readonly adoptionRef: "ESC-ADOPT-D4";
}

export interface CapabilityEscalationProjection {
  readonly declarationId: string;
  readonly sourcePath: string;
  readonly surfaceMode:
    | "reference-consumer"
    | "authoring-consumer"
    | "semantic-role-owner"
    | "workflow-consumer";
  readonly routeIds: readonly string[];
  readonly adoptionRefs: readonly string[];
  readonly authorityRef: "non-owner" | "role-tuples-only";
}

export interface D4ProducedDeclaration {
  readonly route_id: string;
  readonly target_id: string;
  readonly selected_role_id: string;
  readonly capability: string;
  readonly effort: string;
  readonly model: string;
  readonly source_authority: string;
  readonly external_authority: string;
  readonly claude_tools: readonly string[];
  readonly codex_sandbox: string;
  readonly default_network: string;
  readonly scope: string;
  readonly termination: string;
  readonly context_ref: string;
  readonly approval_ref: string;
}

export interface D4DispatchExpectation {
  readonly plannerSelectedRoleId: string;
  readonly targetId: string;
  readonly scope: string;
  readonly termination: string;
  readonly contextRef: string;
  readonly approvalRef: string;
}

/** Reads the two owners and all closed consumer projections before normalization. */
export async function parseCapabilityEscalationAdoptionContract(): Promise<CapabilityEscalationAdoptionContract> {
  const paths = [
    COMMON_OWNER_PATH,
    INVENTORY_OWNER_PATH,
    ...ESCALATION_PROJECTIONS.map((projection) => projection[1]),
  ];
  const entries = await Promise.all(
    paths.map(
      async (sourcePath) =>
        [
          sourcePath,
          await readFile(resolveRepositoryRelativePath(sourcePath), "utf8"),
        ] as const,
    ),
  );
  return parseCapabilityEscalationAdoptionContractFromSources(
    Object.fromEntries(entries),
  );
}

/** Pure parsing seam for owner and consumer mutation tests. */
export function parseCapabilityEscalationAdoptionContractFromSources(
  sources: Readonly<Record<string, string>>,
): CapabilityEscalationAdoptionContract {
  const expectedPaths = [
    COMMON_OWNER_PATH,
    INVENTORY_OWNER_PATH,
    ...ESCALATION_PROJECTIONS.map((projection) => projection[1]),
  ];
  assertExactIdentitySet(
    Object.keys(sources),
    expectedPaths,
    "escalation source",
  );

  const anchors = expectedPaths.map((sourcePath) =>
    parseEscalationAnchor(sources[sourcePath], sourcePath),
  );
  assertUnique(
    anchors.map((anchor) =>
      exactString(anchor.declaration_id, "escalation declaration ID"),
    ),
    "escalation declaration ID",
  );

  const common = anchors.find(
    (anchor) => anchor.source_path === COMMON_OWNER_PATH,
  );
  const inventory = anchors.find(
    (anchor) => anchor.source_path === INVENTORY_OWNER_PATH,
  );
  if (!common || !inventory) {
    throw new Error(
      "Capability-escalation contract must contain both exact owners",
    );
  }
  assertExactAnchorKeys(
    common,
    [
      "declaration_id",
      "source_path",
      "surface_mode",
      "contract_id",
      "inventory_owner_path",
      "authority_ref",
    ],
    "capability-escalation common owner fields",
  );
  assertExactAnchorKeys(
    inventory,
    [
      "declaration_id",
      "source_path",
      "surface_mode",
      "contract_id",
      "common_owner_path",
      "authority_ref",
      "adoptions",
      "d4_route_set",
    ],
    "capability-escalation inventory owner fields",
  );
  assertExactValues(
    common,
    {
      declaration_id: "ESC-COMMON-OWNER",
      source_path: COMMON_OWNER_PATH,
      surface_mode: "common-owner",
      contract_id: "capability-escalation-adoption",
      inventory_owner_path: INVENTORY_OWNER_PATH,
      authority_ref: "common-normative-owner",
    },
    "common owner",
  );
  assertExactValues(
    inventory,
    {
      declaration_id: "ESC-INVENTORY-OWNER",
      source_path: INVENTORY_OWNER_PATH,
      surface_mode: "inventory-owner",
      contract_id: "capability-escalation-adoption",
      common_owner_path: COMMON_OWNER_PATH,
      authority_ref: "inventory-owner",
    },
    "inventory owner",
  );

  const routingPolicyOwner = parseAgentRoutingPolicyOwner(
    sources[INVENTORY_OWNER_PATH],
  );
  const roles = parseAgentSemanticRoleOwner(sources["docs/specs/agents.md"]);
  const adoptions = parseEscalationAdoptionRecords(inventory.adoptions);
  validateAdoptionDirectRouteBindings(
    adoptions,
    routingPolicyOwner.directChildRoutes,
    roles,
  );
  const d4RouteSet = parseD4RouteSet(
    inventory.d4_route_set,
    roles.map((role) => role.name),
  );
  const projections = ESCALATION_PROJECTIONS.map((expected) => {
    const anchor = anchors.find(
      (candidate) => candidate.source_path === expected[1],
    );
    if (!anchor)
      throw new Error(`Missing escalation projection: ${expected[0]}`);
    return parseProjection(anchor, expected);
  });

  return {
    contractId: "capability-escalation-adoption",
    commonOwnerPath: COMMON_OWNER_PATH,
    inventoryOwnerPath: INVENTORY_OWNER_PATH,
    adoptions,
    d4RouteSet,
    projections,
  };
}

/** Validates a D4 runtime declaration against the parsed catalog and model precedence. */
export async function validateD4ProducedDeclaration(
  declaration: D4ProducedDeclaration,
  expectations: D4DispatchExpectation,
): Promise<void> {
  assertExactObjectKeys(
    declaration as unknown as Record<string, unknown>,
    [
      "route_id",
      "target_id",
      "selected_role_id",
      "capability",
      "effort",
      "model",
      "source_authority",
      "external_authority",
      "claude_tools",
      "codex_sandbox",
      "default_network",
      "scope",
      "termination",
      "context_ref",
      "approval_ref",
    ],
    "D4 produced declaration fields",
  );
  if (declaration.route_id !== "D4")
    throw new Error("D4 declaration route_id must be exactly D4");
  assertExactObjectKeys(
    expectations as unknown as Record<string, unknown>,
    [
      "plannerSelectedRoleId",
      "targetId",
      "scope",
      "termination",
      "contextRef",
      "approvalRef",
    ],
    "D4 dispatch expectations fields",
  );
  assertNonEmptyExactBinding(
    declaration.selected_role_id,
    expectations.plannerSelectedRoleId,
    "selected_role_id",
  );
  if (expectations.targetId.trim() === "") {
    throw new Error("D4 dispatch expectation target_id must be non-empty");
  }
  assertClosedD4Target(
    expectations.targetId,
    "D4 dispatch expectation targetId",
  );
  assertNonEmptyExactBinding(
    declaration.target_id,
    expectations.targetId,
    "target_id",
  );
  assertClosedD4Target(declaration.target_id, "D4 declaration target_id");
  assertNonEmptyExactBinding(declaration.scope, expectations.scope, "scope");
  assertNonEmptyExactBinding(
    declaration.termination,
    expectations.termination,
    "termination",
  );
  assertNonEmptyExactBinding(
    declaration.context_ref,
    expectations.contextRef,
    "context_ref",
  );
  assertNonEmptyExactBinding(
    declaration.approval_ref,
    expectations.approvalRef,
    "approval_ref",
  );
  const target = declaration.target_id as "claude" | "codex";
  const parsedContract = await parseCapabilityEscalationAdoptionContract();
  if (
    !parsedContract.d4RouteSet.allowedRoleIds.includes(
      declaration.selected_role_id,
    )
  ) {
    throw new Error(
      `D4 declaration selected_role_id is not allowed: ${declaration.selected_role_id}`,
    );
  }
  const roles = await readAgentSemanticRoleOwner();
  const role = roles.find(
    (candidate) => candidate.name === declaration.selected_role_id,
  );
  if (!role)
    throw new Error(
      `D4 declaration selected_role_id is unknown: ${declaration.selected_role_id}`,
    );
  const config = await loadConfig(
    resolveRepositoryRelativePath("devcanon.config.yaml"),
    true,
  );
  const expectedModel = resolveCapabilityModel(
    undefined,
    role.capability,
    target,
    config.capabilityProfiles,
  );
  const expectedEffort =
    target === "claude" ? role.claudeEffort : role.codexEffort;
  if (declaration.capability !== role.capability)
    throw new Error("D4 declaration capability must match selected role");
  if (declaration.effort !== expectedEffort)
    throw new Error(
      "D4 declaration effort must match selected role and target",
    );
  if (declaration.model !== expectedModel)
    throw new Error("D4 declaration model must match target model resolution");
  if (declaration.source_authority !== role.sourceAuthority)
    throw new Error("D4 declaration source authority must match selected role");
  if (declaration.external_authority !== role.externalAuthority)
    throw new Error(
      "D4 declaration external authority must match selected role",
    );
  assertUnique(declaration.claude_tools, "D4 declaration Claude tool");
  if (!sameValues(declaration.claude_tools, role.claudeTools)) {
    throw new Error(
      "D4 declaration Claude tools must match selected role in order",
    );
  }
  if (declaration.codex_sandbox !== role.codexSandbox)
    throw new Error("D4 declaration Codex sandbox must match selected role");
  if (declaration.default_network !== role.defaultNetwork)
    throw new Error("D4 declaration default network must match selected role");
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
    "Agent spec tool-envelope and semantic-role",
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
  sourceSkills?: readonly string[],
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
  if (sourceSkills !== undefined)
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
  /^(?:branch `([a-z][a-z0-9-]*)`:\s+)?`([a-z][a-z0-9-]*)`,\s*([a-z][a-z-]*)\/([a-z][a-z0-9-]*),\s*(source-[^,;\s]+)(.*)$/;
const ROUTE_CLAUSE_WITHOUT_SOURCE_PATTERN =
  /^(?:branch `[a-z][a-z0-9-]*`:\s+)?`[a-z][a-z0-9-]*`,\s*[a-z][a-z-]*\/[a-z][a-z0-9-]*(?:,\s*[a-z][a-z-]* `[a-z][a-z0-9-]*`)*\s*,?$/;

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

    const operands = parseRouteClauseOperands(id, index, tuple[6]);

    return {
      role: tuple[2],
      capability: closedValue(
        tuple[3],
        ROUTE_CAPABILITIES,
        `direct-route ${id} capability`,
      ),
      effort: closedValue(tuple[4], ROUTE_EFFORTS, `direct-route ${id} effort`),
      sourceAuthority: closedValue(
        tuple[5],
        SOURCE_AUTHORITIES,
        `direct-route ${id} source authority`,
      ),
      branchId: tuple[1],
      ...operands,
      qualifier: operands.evidenceQualifier,
    };
  });
}

function parseRouteClauseOperands(
  routeId: string,
  index: number,
  suffix: string,
): Pick<
  AgentRoutingRouteClause,
  "selectionMode" | "networkBinding" | "evidenceQualifier"
> {
  let rest = suffix;
  const operands: Record<string, string> = {};
  while (rest !== "") {
    const match = /^,\s*([a-z][a-z-]*) `([^`]*)`([\s\S]*)$/u.exec(rest);
    if (!match) {
      throw new Error(
        `Agent routing policy owner direct-route ${routeId} clause ${index + 1} has malformed clause structure`,
      );
    }
    const key = match[1].replaceAll("-", "_");
    if (
      key !== "selection_mode" &&
      key !== "network_binding" &&
      key !== "evidence_qualifier"
    ) {
      throw new Error(
        `Agent routing policy owner direct-route ${routeId} operand key is unknown: ${match[1]}`,
      );
    }
    if (operands[key] !== undefined) {
      throw new Error(
        `Agent routing policy owner direct-route ${routeId} operand is duplicated: ${key}`,
      );
    }
    operands[key] = exactSlug(
      match[2],
      `Agent routing policy owner direct-route ${routeId} ${key}`,
    );
    rest = match[3];
  }
  return {
    selectionMode: operands.selection_mode,
    networkBinding: operands.network_binding,
    evidenceQualifier: operands.evidence_qualifier,
  };
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
  diagnosticLabel: string,
): void {
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const unexpected = actual.filter((value) => !expected.includes(value));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${diagnosticLabel} identities must match exactly; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
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

function parseEscalationAnchor(
  markdown: string | undefined,
  expectedPath: string,
): Record<string, unknown> {
  if (markdown === undefined)
    throw new Error(`Missing escalation source: ${expectedPath}`);
  const matches = [
    ...markdown.matchAll(
      new RegExp(`<!-- ${ESCALATION_ANCHOR}\\n([\\s\\S]*?)\\n-->`, "g"),
    ),
  ];
  if (matches.length !== 1) {
    throw new Error(
      `Escalation source must contain exactly one machine-readable anchor: ${expectedPath}`,
    );
  }
  assertNoDuplicateEscalationAnchorKeys(matches[0][1], expectedPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch {
    throw new Error(`Escalation anchor is malformed JSON: ${expectedPath}`);
  }
  if (!isRecord(parsed))
    throw new Error(`Escalation anchor must be an object: ${expectedPath}`);
  if (parsed.source_path !== expectedPath) {
    throw new Error(
      `Escalation anchor source_path must match its source: ${expectedPath}`,
    );
  }
  return parsed;
}

function assertNoDuplicateEscalationAnchorKeys(
  json: string,
  expectedPath: string,
): void {
  const objectKeySets: Set<string>[] = [];

  for (let index = 0; index < json.length; index += 1) {
    const character = json[index];
    if (character === "{") {
      objectKeySets.push(new Set<string>());
      continue;
    }
    if (character === "}") {
      objectKeySets.pop();
      continue;
    }
    if (character !== '"') continue;

    let end = index + 1;
    while (end < json.length) {
      if (json[end] === "\\") {
        end += 2;
        continue;
      }
      if (json[end] === '"') break;
      end += 1;
    }
    if (end >= json.length) {
      throw new Error(
        `Escalation anchor has unterminated JSON string: ${expectedPath}`,
      );
    }
    const literal = json.slice(index, end + 1);
    let next = end + 1;
    while (/\s/u.test(json[next] ?? "")) next += 1;
    if (objectKeySets.length > 0 && json[next] === ":") {
      let key: unknown;
      try {
        key = JSON.parse(literal);
      } catch {
        throw new Error(
          `Escalation anchor has malformed JSON key: ${expectedPath}`,
        );
      }
      if (typeof key === "string") {
        const keys = objectKeySets.at(-1);
        if (!keys) {
          throw new Error(
            `Escalation anchor has malformed object scope: ${expectedPath}`,
          );
        }
        if (keys.has(key)) {
          throw new Error(
            `Escalation anchor has duplicate key ${key}: ${expectedPath}`,
          );
        }
        keys.add(key);
      }
    }
    index = end;
  }
}

function parseEscalationAdoptionRecords(
  value: unknown,
): readonly CapabilityEscalationAdoptionRecord[] {
  if (!Array.isArray(value))
    throw new Error("Escalation adoption records must be an array");
  const records = value.map((raw) => {
    if (!isRecord(raw))
      throw new Error("Escalation adoption record must be an object");
    assertExactAnchorKeys(
      raw,
      raw.route_id === "D4"
        ? [
            "route_id",
            "adoption_ref",
            "target_ids",
            "target_permission",
            "role_permission",
            "current_state",
            "transition",
            "next_tuple",
            "mechanism",
            "escalation_budget",
            "relation",
            "counter",
            "producer_source_path",
          ]
        : [
            "route_id",
            "adoption_ref",
            "target_ids",
            "target_permission",
            "role_permission",
            "direct_route_clauses",
            "current_state",
            "transition",
            "next_tuple",
            "mechanism",
            "escalation_budget",
            "relation",
            "counter",
            "producer_source_path",
          ],
      "capability-escalation adoption record fields",
    );
    const routeId = exactRouteId(raw.route_id, "escalation adoption route_id");
    const targetIds = exactStringArray(
      raw.target_ids,
      "escalation adoption target_ids",
    );
    assertUnique(targetIds, "escalation adoption target_id");
    assertExactIdentitySet(
      targetIds,
      ["claude", "codex"],
      "capability-escalation adoption target IDs",
    );
    const directRouteClauses =
      routeId === "D4"
        ? undefined
        : parseDirectRouteClauses(routeId, raw.direct_route_clauses);
    const record: CapabilityEscalationAdoptionRecord = {
      routeId,
      adoptionRef: exactAdoptionRef(raw.adoption_ref, routeId),
      targetIds: targetIds as readonly ("claude" | "codex")[],
      targetPermission: exactLiteral(
        raw.target_permission,
        "exact-only",
        "escalation adoption target_permission",
      ),
      rolePermission: exactOneOf(
        raw.role_permission,
        ["same-role-must-match", "selected-role-must-match"] as const,
        "escalation adoption role_permission",
      ),
      directRouteClauses,
      directRouteRoleIds:
        routeId === "D4"
          ? undefined
          : directRouteClauses?.map((clause) => clause.roleId),
      currentState: exactLiteral(
        raw.current_state,
        "opt-out",
        "escalation adoption current_state",
      ),
      transition: exactLiteral(
        raw.transition,
        "none",
        "escalation adoption transition",
      ),
      nextTuple: exactLiteral(
        raw.next_tuple,
        "none",
        "escalation adoption next_tuple",
      ),
      mechanism: exactLiteral(
        raw.mechanism,
        "none",
        "escalation adoption mechanism",
      ),
      escalationBudget: exactLiteral(
        raw.escalation_budget,
        "none",
        "escalation adoption escalation_budget",
      ),
      relation: exactOneOf(
        raw.relation,
        ["none", "D13-to-D12-reclassification"] as const,
        "escalation adoption relation",
      ),
      counter: exactOneOf(
        raw.counter,
        ["none", "independent-from-escalation"] as const,
        "escalation adoption counter",
      ),
      producerSourcePath: exactString(
        raw.producer_source_path,
        "escalation adoption producer_source_path",
      ),
    };
    const isD4 = routeId === "D4";
    if (
      record.rolePermission !==
      (isD4 ? "selected-role-must-match" : "same-role-must-match")
    ) {
      throw new Error(
        `Escalation adoption ${routeId} role permission is contradictory`,
      );
    }
    if (
      record.relation !==
      (routeId === "D13" ? "D13-to-D12-reclassification" : "none")
    ) {
      throw new Error(
        `Escalation adoption ${routeId} relation is contradictory`,
      );
    }
    if (
      record.counter !==
      (routeId === "D17" ? "independent-from-escalation" : "none")
    ) {
      throw new Error(
        `Escalation adoption ${routeId} counter is contradictory`,
      );
    }
    if (
      record.producerSourcePath !==
      (isD4 ? "skills/play-agent-dispatch/SKILL.md" : "none")
    ) {
      throw new Error(
        `Escalation adoption ${routeId} producer source is contradictory`,
      );
    }
    return record;
  });
  assertUnique(
    records.map((record) => record.routeId),
    "escalation adoption route_id",
  );
  assertExactIdentitySet(
    records.map((record) => record.routeId),
    Array.from({ length: 17 }, (_, index) => `D${index + 1}`),
    "capability-escalation adoption route IDs",
  );
  return records;
}

function parseDirectRouteClauses(
  routeId: `D${number}`,
  value: unknown,
): readonly CapabilityEscalationDirectRouteClause[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Escalation adoption ${routeId} direct_route_clauses must be an array`,
    );
  }
  return value.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new Error(
        `Escalation adoption ${routeId} direct_route_clauses ${index + 1} must be an object`,
      );
    }
    const dimension = `Escalation adoption ${routeId} direct_route_clause`;
    assertDescriptorKeys(raw, dimension);
    const clause: CapabilityEscalationDirectRouteClause = {
      roleId: exactSlug(raw.role_id, `${dimension} role_id`),
    };
    return {
      ...clause,
      ...(raw.branch_id === undefined
        ? {}
        : { branchId: exactSlug(raw.branch_id, `${dimension} branch_id`) }),
      ...(raw.selection_mode === undefined
        ? {}
        : {
            selectionMode: exactSlug(
              raw.selection_mode,
              `${dimension} selection_mode`,
            ),
          }),
      ...(raw.network_binding === undefined
        ? {}
        : {
            networkBinding: exactSlug(
              raw.network_binding,
              `${dimension} network_binding`,
            ),
          }),
      ...(raw.evidence_qualifier === undefined
        ? {}
        : {
            evidenceQualifier: exactSlug(
              raw.evidence_qualifier,
              `${dimension} evidence_qualifier`,
            ),
          }),
    };
  });
}

function assertDescriptorKeys(
  value: Record<string, unknown>,
  dimension: string,
): void {
  const keys = Object.keys(value);
  const allowed = new Set([
    "role_id",
    "branch_id",
    "selection_mode",
    "network_binding",
    "evidence_qualifier",
  ]);
  const missing = keys.includes("role_id") ? [] : ["role_id"];
  const unexpected = keys.filter((key) => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${dimension} fields identities must match exactly; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }
}

function exactSlug(value: unknown, dimension: string): string {
  const slug = exactString(value, dimension);
  if (!/^[a-z][a-z0-9-]*$/u.test(slug)) {
    throw new Error(`${dimension} must be one non-empty slug: ${slug}`);
  }
  return slug;
}

function validateAdoptionDirectRouteBindings(
  adoptions: readonly CapabilityEscalationAdoptionRecord[],
  directRoutes: readonly AgentRoutingDirectChildRouteRow[],
  roles: readonly AgentSemanticRoleContract[],
): void {
  const directRoutesById = new Map(
    directRoutes.map((route) => [route.id, route]),
  );
  const rolesById = new Map(roles.map((role) => [role.name, role]));

  validateAdoptionClauseSemantics(adoptions, directRoutesById);

  for (const route of directRoutes) {
    for (const [index, clause] of route.clauses.entries()) {
      const role = rolesById.get(clause.role);
      if (!role) {
        throw new Error(
          `Direct-route ${route.id} clause ${index + 1} role is absent from the canonical role owner: ${clause.role}`,
        );
      }
      if (clause.capability !== role.capability) {
        throw new Error(
          `Direct-route ${route.id} clause ${index + 1} capability must match canonical role ${clause.role}`,
        );
      }
      if (
        clause.effort !== role.claudeEffort ||
        clause.effort !== role.codexEffort
      ) {
        throw new Error(
          `Direct-route ${route.id} clause ${index + 1} effort must match canonical role ${clause.role} for both targets`,
        );
      }
      if (clause.sourceAuthority !== role.sourceAuthority) {
        throw new Error(
          `Direct-route ${route.id} clause ${index + 1} source authority must match canonical role ${clause.role}`,
        );
      }
    }
  }
}

function validateAdoptionClauseSemantics(
  adoptions: readonly CapabilityEscalationAdoptionRecord[],
  directRoutesById: ReadonlyMap<`D${number}`, AgentRoutingDirectChildRouteRow>,
): void {
  for (const adoption of adoptions) {
    if (adoption.routeId === "D4") continue;
    const route = directRoutesById.get(adoption.routeId);
    if (!route) {
      throw new Error(
        `Escalation adoption ${adoption.routeId} has no exact direct-route owner`,
      );
    }
    const descriptors = adoption.directRouteClauses;
    const actualRoleIds = adoption.directRouteRoleIds;
    if (!descriptors || !actualRoleIds) {
      throw new Error(
        `Escalation adoption ${adoption.routeId} direct_route_clauses is required`,
      );
    }
    if (descriptors.length !== route.clauses.length) {
      throw new Error(
        `Escalation adoption ${adoption.routeId} direct_route_clauses cardinality must match direct-route clauses: expected ${route.clauses.length}; received ${descriptors.length}`,
      );
    }
    const expectedRoleIds = route.clauses.map((clause) => clause.role);
    if (!sameValues(actualRoleIds, expectedRoleIds)) {
      throw new Error(
        `Escalation adoption ${adoption.routeId} direct_route_clauses must match direct-route roles in order; expected: ${expectedRoleIds.join(", ")}; actual: ${actualRoleIds.join(", ")}`,
      );
    }

    for (const [index, descriptor] of descriptors.entries()) {
      const tableClause = route.clauses[index];
      if (descriptor.branchId !== tableClause.branchId) {
        throw new Error(
          `Escalation adoption ${adoption.routeId} branch_id must match direct-route clause ${index + 1}`,
        );
      }
      if (descriptor.selectionMode !== tableClause.selectionMode) {
        throw new Error(
          `Escalation adoption ${adoption.routeId} selection_mode must match direct-route clause ${index + 1}`,
        );
      }
      if (descriptor.networkBinding !== tableClause.networkBinding) {
        throw new Error(
          `Escalation adoption ${adoption.routeId} network_binding must match direct-route clause ${index + 1}`,
        );
      }
      if (descriptor.evidenceQualifier !== tableClause.evidenceQualifier) {
        throw new Error(
          `Escalation adoption ${adoption.routeId} evidence_qualifier must match direct-route clause ${index + 1}`,
        );
      }
    }
  }
}

function parseD4RouteSet(
  value: unknown,
  expectedRoleIds: readonly string[],
): CapabilityEscalationD4RouteSet {
  if (!isRecord(value)) throw new Error("D4 route set must be an object");
  assertExactAnchorKeys(
    value,
    ["route_id", "allowed_role_ids", "selection_mode", "adoption_ref"],
    "capability-escalation D4 route-set fields",
  );
  const allowedRoleIds = exactStringArray(
    value.allowed_role_ids,
    "D4 allowed_role_ids",
  );
  assertUnique(allowedRoleIds, "D4 allowed_role_id");
  assertExactIdentitySet(
    allowedRoleIds,
    expectedRoleIds,
    "capability-escalation D4 allowed role IDs",
  );
  return {
    routeId: exactLiteral(value.route_id, "D4", "D4 route_id"),
    allowedRoleIds,
    selectionMode: exactLiteral(
      value.selection_mode,
      "planner-selected",
      "D4 selection_mode",
    ),
    adoptionRef: exactLiteral(
      value.adoption_ref,
      "ESC-ADOPT-D4",
      "D4 adoption_ref",
    ),
  };
}

function parseProjection(
  anchor: Record<string, unknown>,
  expected: (typeof ESCALATION_PROJECTIONS)[number],
): CapabilityEscalationProjection {
  assertExactAnchorKeys(
    anchor,
    [
      "declaration_id",
      "source_path",
      "surface_mode",
      "route_ids",
      "adoption_refs",
      "authority_ref",
    ],
    "capability-escalation projection fields",
  );
  const [
    declarationId,
    sourcePath,
    surfaceMode,
    routeIds,
    adoptionRefs,
    authorityRef,
  ] = expected;
  assertExactValues(
    anchor,
    {
      declaration_id: declarationId,
      source_path: sourcePath,
      surface_mode: surfaceMode,
      authority_ref: authorityRef,
    },
    `escalation projection ${declarationId}`,
  );
  const actualRouteIds = exactStringArray(
    anchor.route_ids,
    `escalation projection ${declarationId} route_ids`,
  );
  const actualAdoptionRefs = exactStringArray(
    anchor.adoption_refs,
    `escalation projection ${declarationId} adoption_refs`,
  );
  assertUnique(
    actualRouteIds,
    `escalation projection ${declarationId} route_id`,
  );
  assertUnique(
    actualAdoptionRefs,
    `escalation projection ${declarationId} adoption_ref`,
  );
  assertExactIdentitySet(
    actualRouteIds,
    routeIds,
    `capability-escalation projection ${declarationId} at ${sourcePath} route IDs`,
  );
  assertExactIdentitySet(
    actualAdoptionRefs,
    adoptionRefs,
    `capability-escalation projection ${declarationId} at ${sourcePath} adoption refs`,
  );
  return {
    declarationId,
    sourcePath,
    surfaceMode: surfaceMode as CapabilityEscalationProjection["surfaceMode"],
    routeIds: actualRouteIds,
    adoptionRefs: actualAdoptionRefs,
    authorityRef:
      authorityRef as CapabilityEscalationProjection["authorityRef"],
  };
}

function assertExactAnchorKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  diagnosticLabel: string,
): void {
  assertExactIdentitySet(Object.keys(value), expected, diagnosticLabel);
}

function assertExactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  diagnosticLabel: string,
): void {
  assertExactIdentitySet(Object.keys(value), expected, diagnosticLabel);
}

function assertExactValues(
  value: Record<string, unknown>,
  expected: Readonly<Record<string, string>>,
  dimension: string,
): void {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue)
      throw new Error(`${dimension} ${key} must be exactly: ${expectedValue}`);
  }
}

function exactString(value: unknown, dimension: string): string {
  if (typeof value !== "string" || value === "")
    throw new Error(`${dimension} must be one non-empty string`);
  return value;
}

function assertNonEmptyExactBinding(
  actual: string,
  expected: string,
  dimension: string,
): void {
  if (expected.trim() === "") {
    throw new Error(`D4 dispatch expectation ${dimension} must be non-empty`);
  }
  if (actual !== expected) {
    throw new Error(
      `D4 declaration ${dimension} must match dispatch expectation`,
    );
  }
}

function assertClosedD4Target(value: string, dimension: string): void {
  if (!(["claude", "codex"] as readonly string[]).includes(value)) {
    throw new Error(`${dimension} must be exact: ${value}`);
  }
}

function exactStringArray(
  value: unknown,
  dimension: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item === "")
  ) {
    throw new Error(`${dimension} must be an array of exact strings`);
  }
  return value;
}

function exactRouteId(value: unknown, dimension: string): `D${number}` {
  const routeId = exactString(value, dimension);
  if (!/^D(?:[1-9]|1[0-7])$/.test(routeId))
    throw new Error(`${dimension} is invalid: ${routeId}`);
  return routeId as `D${number}`;
}

function exactAdoptionRef(
  value: unknown,
  routeId: string,
): `ESC-ADOPT-D${number}` {
  return exactLiteral(
    value,
    `ESC-ADOPT-${routeId}` as `ESC-ADOPT-D${number}`,
    "escalation adoption adoption_ref",
  );
}

function exactLiteral<const Value extends string>(
  value: unknown,
  expected: Value,
  dimension: string,
): Value {
  if (value !== expected)
    throw new Error(`${dimension} must be exactly: ${expected}`);
  return expected;
}

function exactOneOf<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
  dimension: string,
): Values[number] {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new Error(`${dimension} has invalid closed value: ${String(value)}`);
  return value as Values[number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
