import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type {
  LoadedAgent,
  LoadedSkill,
  RenderedOutput,
} from "../models/types.js";
import { sha256 } from "../utils/hash.js";
import { makeTomlHeader } from "../utils/managed-header.js";

function tomlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderCodexAgent(
  agent: LoadedAgent,
  skills: Map<string, LoadedSkill>,
  config: ResolvedConfig,
): RenderedOutput {
  const sourcePath = `agents/${agent.name}.yaml`;
  const lines: string[] = [];

  // Managed header
  lines.push(makeTomlHeader(sourcePath));
  lines.push("");

  // Required fields
  lines.push(`name = ${tomlQuote(agent.source.name)}`);
  lines.push(`description = ${tomlQuote(agent.source.description)}`);

  // Optional codex-specific fields
  const codex = agent.source.codex;
  if (codex) {
    if (codex.model) lines.push(`model = ${tomlQuote(codex.model)}`);
    if (codex.model_reasoning_effort)
      lines.push(
        `model_reasoning_effort = ${tomlQuote(codex.model_reasoning_effort)}`,
      );
    if (codex.sandbox_mode)
      lines.push(`sandbox_mode = ${tomlQuote(codex.sandbox_mode)}`);
    if (codex.nickname_candidates?.length) {
      const items = codex.nickname_candidates.map(tomlQuote).join(", ");
      lines.push(`nickname_candidates = [${items}]`);
    }
    if (codex.approval_policy)
      lines.push(`approval_policy = ${tomlQuote(codex.approval_policy)}`);
  }

  // Build developer_instructions
  let instrContent = agent.source.instructions.trimEnd();

  const agentSkills = agent.source.skills;
  if (agentSkills.length > 0) {
    instrContent += "\n\n## Skills\n";
    for (const skillName of agentSkills) {
      const installPath = path.join(config.targets.codex.skillsHome, skillName);
      instrContent += `\n- **${skillName}** (\`${installPath}\`)`;
    }
  }

  // Use TOML multi-line literal strings (''') to avoid backslash escape interpretation
  const escapedContent = instrContent.replace(/'''/g, "'''\"'''\"'''");

  lines.push("");
  lines.push(`developer_instructions = '''\n${escapedContent}\n'''`);
  lines.push("");

  const content = lines.join("\n");
  return {
    target: "codex",
    type: "agent",
    name: agent.name,
    sourcePath: agent.filePath,
    generatedPath: path.join(
      config.library.generatedDir,
      "codex",
      "agents",
      `${agent.name}.toml`,
    ),
    installedPath: path.join(
      config.targets.codex.agentsHome,
      `${agent.name}.toml`,
    ),
    content,
    contentHash: sha256(content),
  };
}
