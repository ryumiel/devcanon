import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type {
  LoadedAgent,
  LoadedSkill,
  RenderedOutput,
} from "../models/types.js";
import { sha256 } from "../utils/hash.js";
import { makeMdHeader } from "../utils/managed-header.js";

export function renderClaudeAgent(
  agent: LoadedAgent,
  skills: Map<string, LoadedSkill>,
  config: ResolvedConfig,
): RenderedOutput {
  const sourcePath = `agents/${agent.name}.yaml`;
  const lines: string[] = [];

  // Managed header
  lines.push(makeMdHeader(sourcePath));

  // Frontmatter - explicit ordering for determinism
  lines.push("---");
  lines.push(`name: ${agent.source.name}`);
  lines.push(`description: ${JSON.stringify(agent.source.description)}`);

  if (agent.source.claude?.tools?.length) {
    lines.push(`tools: ${agent.source.claude.tools.join(", ")}`);
  }
  if (agent.source.claude?.model) {
    lines.push(`model: ${agent.source.claude.model}`);
  }

  lines.push("---");
  lines.push("");

  // Instructions body directly (no ## Instructions wrapper)
  lines.push(agent.source.instructions.trimEnd());

  // Skills section
  const agentSkills = agent.source.skills;
  if (agentSkills.length > 0) {
    lines.push("");
    lines.push("## Skills");
    lines.push("");
    for (const skillName of agentSkills) {
      const installPath = path.join(
        config.targets.claude.skillsHome,
        skillName,
      );
      lines.push(`- **${skillName}** (\`${installPath}\`)`);
    }
  }

  lines.push("");

  const content = lines.join("\n");
  return {
    target: "claude",
    type: "agent",
    name: agent.name,
    sourcePath: agent.filePath,
    generatedPath: path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agent.name}.md`,
    ),
    installedPath: path.join(
      config.targets.claude.agentsHome,
      `${agent.name}.md`,
    ),
    content,
    contentHash: sha256(content),
  };
}
