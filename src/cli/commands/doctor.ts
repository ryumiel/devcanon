import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { findConfigPath, loadConfig } from "../../config/load.js";
import { loadManifest } from "../../install/manifest.js";
import { isWritable, pathExists } from "../../utils/fs.js";
import { getLogger } from "../../utils/output.js";
import { loadAndValidateAgents } from "../../validate/agents.js";
import { loadAndValidateSkills } from "../../validate/skills.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export async function doctorAction(
  _options: unknown,
  command: { parent?: { opts(): Record<string, unknown> } },
): Promise<void> {
  const logger = getLogger();
  const globalOpts = command.parent?.opts() ?? {};
  const results: CheckResult[] = [];

  // 1. Node version
  const [major] = process.versions.node.split(".").map(Number);
  results.push({
    name: "node-version",
    status: major >= 18 ? "ok" : "error",
    message: `Node ${process.versions.node}${major < 18 ? " (requires >= 18)" : ""}`,
  });

  // 2. Config found
  let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
  try {
    await findConfigPath(globalOpts.config as string | undefined);
    results.push({
      name: "config-found",
      status: "ok",
      message: "Config file found",
    });
  } catch {
    results.push({
      name: "config-found",
      status: "error",
      message: "No config file found. Run 'agents-manager init'.",
    });
  }

  // 3. Config valid
  try {
    config = await loadConfig(globalOpts.config as string | undefined);
    results.push({
      name: "config-valid",
      status: "ok",
      message: "Config is valid",
    });
  } catch (err) {
    results.push({
      name: "config-valid",
      status: "error",
      message: `Config invalid: ${(err as Error).message}`,
    });
  }

  if (config) {
    // 4. Source dirs
    const skillsExists = await pathExists(config.library.skillsDir);
    const agentsExists = await pathExists(config.library.agentsDir);
    results.push({
      name: "source-dirs",
      status: skillsExists && agentsExists ? "ok" : "warn",
      message: `skills: ${skillsExists ? "exists" : "missing"}, agents: ${agentsExists ? "exists" : "missing"}`,
    });

    // 5. Target dirs
    for (const target of ["claude", "codex"] as const) {
      if (!config.targets[target].enabled) continue;
      const skillsHome = await pathExists(config.targets[target].skillsHome);
      const agentsHome = await pathExists(config.targets[target].agentsHome);
      results.push({
        name: `${target}-target-dirs`,
        status: skillsHome && agentsHome ? "ok" : "warn",
        message: `${target}: skillsHome ${skillsHome ? "exists" : "missing"}, agentsHome ${agentsHome ? "exists" : "missing"}`,
      });

      // 6. Writable
      if (skillsHome) {
        const writable = await isWritable(config.targets[target].skillsHome);
        if (!writable)
          results.push({
            name: `${target}-writable`,
            status: "error",
            message: `${target} skillsHome not writable`,
          });
      }
      if (agentsHome) {
        const writable = await isWritable(config.targets[target].agentsHome);
        if (!writable)
          results.push({
            name: `${target}-writable`,
            status: "error",
            message: `${target} agentsHome not writable`,
          });
      }
    }

    // 7. Symlink support
    try {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "am-doctor-"));
      const target = path.join(tmpDir, "target");
      const link = path.join(tmpDir, "link");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(target, "test");
      await symlink(target, link);
      await rm(tmpDir, { recursive: true });
      results.push({
        name: "symlink-support",
        status: "ok",
        message: "Symlinks are supported",
      });
    } catch {
      results.push({
        name: "symlink-support",
        status: "warn",
        message: "Symlink creation failed. Use copy install mode.",
      });
    }

    // 8. Manifest
    try {
      const manifest = await loadManifest(config.manifest.path);
      results.push({
        name: "manifest",
        status: "ok",
        message: `Manifest: ${manifest.records.length} records`,
      });
    } catch {
      results.push({
        name: "manifest",
        status: "warn",
        message: "Manifest not accessible",
      });
    }

    // 9. Skills valid
    try {
      const skills = await loadAndValidateSkills(config.library.skillsDir);
      results.push({
        name: "skills-valid",
        status: "ok",
        message: `${skills.length} skill(s) valid`,
      });

      // 10. Agents valid
      try {
        const agents = await loadAndValidateAgents(
          config.library.agentsDir,
          skills,
        );
        results.push({
          name: "agents-valid",
          status: "ok",
          message: `${agents.length} agent(s) valid`,
        });
      } catch (err) {
        results.push({
          name: "agents-valid",
          status: "error",
          message: (err as Error).message,
        });
      }
    } catch (err) {
      results.push({
        name: "skills-valid",
        status: "error",
        message: (err as Error).message,
      });
    }
  }

  // Print results
  for (const result of results) {
    const icon =
      result.status === "ok"
        ? pc.green("✓")
        : result.status === "warn"
          ? pc.yellow("!")
          : pc.red("✗");
    logger.info(`  ${icon} ${result.name}: ${result.message}`);
  }

  const hasError = results.some((r) => r.status === "error");
  if (hasError) process.exitCode = 1;

  if (globalOpts.json) {
    logger.json(results);
  }
}
