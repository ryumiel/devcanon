import path from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const unitProjectName = "unit";
const runtimeBuildTest = path.join(
  "src",
  "runtime",
  "check-runtime-build.test.ts",
);

/** Keeps the runtime build check out of the unit shard with the other hot files. */
export class UnitCriticalPathSequencer extends BaseSequencer {
  override async shard(
    files: TestSpecification[],
  ): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (
      shard?.count !== 2 ||
      !files.every((file) => file.project.name === unitProjectName)
    )
      return super.shard(files);

    const pinned = files.filter((file) =>
      isRuntimeBuildTest(file, this.ctx.config.root),
    );
    if (pinned.length === 0) return super.shard(files);

    const selected = await super.shard(files);
    const withoutPinned = selected.filter(
      (file) => !isRuntimeBuildTest(file, this.ctx.config.root),
    );
    return shard.index === 2 ? [...withoutPinned, ...pinned] : withoutPinned;
  }
}

function isRuntimeBuildTest(file: TestSpecification, root: string): boolean {
  return (
    path.normalize(path.relative(root, file.moduleId)) === runtimeBuildTest
  );
}
