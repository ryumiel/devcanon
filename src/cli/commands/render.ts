import { loadConfig } from "../../config/load.js";
import { renderAll } from "../../render/pipeline.js";
import { UserError } from "../../utils/errors.js";
import { getLogger } from "../../utils/output.js";

interface RenderOptions {
  target?: string;
}

export async function renderAction(
  options: RenderOptions,
  command: { parent?: { opts(): Record<string, unknown> } },
): Promise<void> {
  const logger = getLogger();
  const globalOpts = command.parent?.opts() ?? {};
  if (options.target && !["claude", "codex"].includes(options.target)) {
    throw new UserError(
      `Invalid target "${options.target}". Must be "claude" or "codex".`,
    );
  }
  const strict = (globalOpts.strict as boolean) ?? false;
  const config = await loadConfig(
    globalOpts.config as string | undefined,
    strict,
  );

  const { outputs } = await renderAll(
    config,
    true,
    strict,
    options.target as "claude" | "codex" | undefined,
  );

  const agentOutputs = outputs.filter((o) => o.type === "agent");
  const skillOutputs = outputs.filter((o) => o.type === "skill");

  logger.info(
    `Rendered ${agentOutputs.length} agent(s) and tracked ${skillOutputs.length} skill(s).`,
  );

  for (const output of agentOutputs) {
    logger.info(
      `  ${output.target}/agents/${output.name} -> ${output.generatedPath}`,
    );
  }

  if (globalOpts.json) {
    logger.json({
      agents: agentOutputs.map((o) => ({
        target: o.target,
        name: o.name,
        generatedPath: o.generatedPath,
      })),
      skills: skillOutputs.map((o) => ({
        target: o.target,
        name: o.name,
      })),
    });
  }
}
