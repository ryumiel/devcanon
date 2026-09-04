import { loadConfig } from "../../config/load.js";
import {
  reconcileDevcanonRuntimeSource,
  reconcileDevcanonRuntimeSubtree,
} from "../../render/devcanon-runtime.js";
import {
  preflightGeneratedRender,
  renderAllWithValidatedRuntime,
} from "../../render/pipeline.js";
import type { AcceptedProvider } from "../../runtime-build/provider.js";
import { UserError } from "../../utils/errors.js";
import { getLogger } from "../../utils/output.js";
import {
  bundledDevcanonRuntimeDir,
  devcanonRuntimeDir,
  validateDevcanonRuntime,
} from "../../validate/devcanon-runtime.js";

interface RenderOptions {
  target?: string;
}

export async function renderAction(
  options: RenderOptions,
  command: { parent?: { opts(): Record<string, unknown> } },
  provider: AcceptedProvider | (() => Promise<AcceptedProvider>),
): Promise<void> {
  const logger = getLogger();
  const globalOpts = command.parent?.opts() ?? {};
  if (
    options.target !== undefined &&
    !["claude", "codex"].includes(options.target)
  ) {
    throw new UserError(
      `Invalid target "${options.target}". Must be "claude" or "codex".`,
    );
  }
  const strict = (globalOpts.strict as boolean) ?? false;
  const config = await loadConfig(
    globalOpts.config as string | undefined,
    strict,
  );
  const acceptedProvider =
    typeof provider === "function" ? await provider() : provider;

  const runtimeDir = devcanonRuntimeDir(config.library.skillsDir);
  let validatedRuntime = await validateDevcanonRuntime(runtimeDir, {
    adapterSourceDir: bundledDevcanonRuntimeDir(),
    operation: "compose",
    provider: acceptedProvider,
  });
  const projection = await renderAllWithValidatedRuntime(
    config,
    validatedRuntime,
    false,
    strict,
    options.target as "claude" | "codex" | undefined,
  );
  await preflightGeneratedRender(config, projection);
  if (validatedRuntime.sourceDisposition !== "current") {
    if (validatedRuntime.sourceDisposition === "repair-runtime") {
      await reconcileDevcanonRuntimeSubtree(runtimeDir, acceptedProvider);
    } else {
      await reconcileDevcanonRuntimeSource(
        runtimeDir,
        acceptedProvider,
        validatedRuntime,
      );
    }
    validatedRuntime = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: bundledDevcanonRuntimeDir(),
      provider: acceptedProvider,
    });
  }
  const { outputs } = await renderAllWithValidatedRuntime(
    config,
    validatedRuntime,
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
