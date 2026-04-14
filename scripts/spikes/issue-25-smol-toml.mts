// Spike for issue #25: validate smol-toml as a dev-dependency for
// round-trip testing of Codex TOML rendering. Phase 0 gate.
// Run: pnpm tsx scripts/spikes/issue-25-smol-toml.mts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import type { ResolvedConfig } from "../../src/config/schema.ts";
import type { LoadedAgent, LoadedSkill } from "../../src/models/types.ts";
import { renderCodexAgent } from "../../src/render/codex.ts";

const smolTomlPkgUrl = new URL(
  "../../node_modules/smol-toml/package.json",
  import.meta.url,
);
const smolTomlVersion = (
  JSON.parse(readFileSync(fileURLToPath(smolTomlPkgUrl), "utf8")) as {
    version: string;
  }
).version;

const baseAgent: LoadedAgent = {
  name: "test-agent",
  filePath: "/test/agents/test-agent.yaml",
  source: {
    name: "test-agent",
    description: "A test agent.",
    instructions: "Follow these steps:\n\n## Step One\n\nDo the first thing.",
    skills: [],
    claude: undefined,
    codex: { sandbox_mode: "read-only" },
    tags: undefined,
    notes: undefined,
  },
};

const config = {
  configDir: "/test",
  library: {
    skillsDir: "/test/skills",
    agentsDir: "/test/agents",
    generatedDir: "/test/generated",
  },
  targets: {
    claude: {
      enabled: true,
      skillsHome: "~/.claude/skills",
      agentsHome: "~/.claude/agents",
      installMode: "symlink" as const,
    },
    codex: {
      enabled: true,
      skillsHome: "~/.agents/skills",
      agentsHome: "~/.codex/agents",
      installMode: "symlink" as const,
    },
  },
  defaults: {
    installMode: "symlink" as const,
    overwritePolicy: "overwrite-managed" as const,
    cleanManagedOutputs: true,
  },
  platform: { windowsSymlinkFallback: "copy" as const },
  manifest: { path: "~/.agents-manager/manifest.json" },
} satisfies ResolvedConfig;

const emptySkills = new Map<string, LoadedSkill>();

type Outcome = "PASS" | "FAIL";
const results: Record<string, Outcome> = {};

function cloneWith(patch: Partial<LoadedAgent["source"]>): LoadedAgent {
  return { ...baseAgent, source: { ...baseAgent.source, ...patch } };
}

function render(a: LoadedAgent): string {
  return renderCodexAgent(a, emptySkills, config).content as string;
}

// Probe 1 — vanilla
try {
  const parsed = parse(render(baseAgent)) as Record<string, unknown>;
  const ok =
    parsed.name === "test-agent" &&
    parsed.description === "A test agent." &&
    parsed.sandbox_mode === "read-only";
  results["1"] = ok ? "PASS" : "FAIL";
  console.log(
    `Probe 1 — vanilla: ${results["1"]} name=${JSON.stringify(parsed.name)} description=${JSON.stringify(parsed.description)} sandbox_mode=${JSON.stringify(parsed.sandbox_mode)}`,
  );
} catch (err) {
  results["1"] = "FAIL";
  console.log(`Probe 1 — vanilla: FAIL threw=${(err as Error).message}`);
}

// Probe 2 — triple-single-quote literal variant
try {
  const agent2 = cloneWith({ instructions: "pre\n'''\nmid\n'''\npost" });
  const rendered = render(agent2);
  const parsed = parse(rendered) as Record<string, unknown>;
  const di = String(parsed.developer_instructions ?? "");
  const ok = di.includes("pre") && di.includes("mid") && di.includes("post");
  results["2"] = ok ? "PASS" : "FAIL";
  console.log(
    `Probe 2 — ''' literal: ${results["2"]} developer_instructions_len=${di.length} has_pre=${di.includes("pre")} has_mid=${di.includes("mid")} has_post=${di.includes("post")}`,
  );
} catch (err) {
  results["2"] = "FAIL";
  console.log(
    `Probe 2 — ''' literal: FAIL threw=${(err as Error).message.slice(0, 200)}`,
  );
}

// Probe 3 — U+0080 pass-through (CURRENT buggy tomlQuote)
try {
  const agent3 = cloneWith({ description: "hi\u0080there" });
  const rendered = render(agent3);
  const parsed = parse(rendered) as Record<string, unknown>;
  const desc = parsed.description;
  const exact = desc === "hi\u0080there";
  results["3"] = exact ? "PASS" : "FAIL";
  console.log(
    `Probe 3 — U+0080 pass-through: ${results["3"]} returned=${JSON.stringify(desc)} exact_match=${exact}`,
  );
} catch (err) {
  results["3"] = "FAIL";
  console.log(
    `Probe 3 — U+0080 pass-through: FAIL threw=${(err as Error).message.slice(0, 200)}`,
  );
}

// Probe 4 — lone high surrogate (informational)
let probe4: Outcome | "THREW" = "THREW";
try {
  const agent4 = cloneWith({ description: "oops\uD83Dend" });
  const rendered = render(agent4);
  const parsed = parse(rendered) as Record<string, unknown>;
  const desc = parsed.description;
  probe4 = desc === "oops\uD83Dend" ? "PASS" : "FAIL";
  console.log(
    `Probe 4 — lone high surrogate (info): ${probe4} returned=${JSON.stringify(desc)}`,
  );
} catch (err) {
  console.log(
    `Probe 4 — lone high surrogate (info): THREW message=${(err as Error).message.slice(0, 200)}`,
  );
}

const gate =
  results["1"] === "PASS" && results["2"] === "PASS" && results["3"] === "PASS"
    ? "A"
    : "C";
console.log(`GATE: ${gate}`);
console.log(
  JSON.stringify({
    gate,
    node: process.version,
    smolToml: smolTomlVersion,
    probes: {
      "1": results["1"] ?? "FAIL",
      "2": results["2"] ?? "FAIL",
      "3": results["3"] ?? "FAIL",
      "4": probe4,
    },
  }),
);
