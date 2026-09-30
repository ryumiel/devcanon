import path from "node:path";
import { describe, expect, it } from "vitest";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import { UnitCriticalPathSequencer } from "./ci-sequencer.js";

const repositoryRoot = path.resolve();
const runtimeBuildTest = path.join(
  repositoryRoot,
  "src/runtime/check-runtime-build.test.ts",
);

function specification(
  moduleId: string,
  projectName = "unit",
): TestSpecification {
  return {
    moduleId,
    project: { name: projectName },
  } as TestSpecification;
}

function context(index: number, count: number) {
  return {
    config: {
      root: repositoryRoot,
      shard: { index, count },
    },
  };
}

async function baseShard(
  files: TestSpecification[],
  index: number,
  count: number,
): Promise<TestSpecification[]> {
  return new BaseSequencer(context(index, count) as never).shard(files);
}

async function optimizedShard(
  files: TestSpecification[],
  index: number,
  count: number,
): Promise<TestSpecification[]> {
  return new UnitCriticalPathSequencer(context(index, count) as never).shard(
    files,
  );
}

describe("unit critical-path sequencer", () => {
  it("partitions a unit-only two-shard selection completely and pins the runtime build check once", async () => {
    const files = [
      specification(runtimeBuildTest),
      specification(
        path.join(repositoryRoot, "src/__test-helpers__/ci-sequencer.test.ts"),
      ),
      specification(path.join(repositoryRoot, "src/runtime/bash.test.ts")),
      specification(path.join(repositoryRoot, "src/runtime/command.test.ts")),
      specification(path.join(repositoryRoot, "src/render/claude.test.ts")),
      specification(path.join(repositoryRoot, "src/utils/hash.test.ts")),
    ];

    const first = await optimizedShard(files, 1, 2);
    const second = await optimizedShard(files, 2, 2);
    const selected = [...first, ...second].map((file) => file.moduleId);

    expect(new Set(selected)).toEqual(
      new Set(files.map((file) => file.moduleId)),
    );
    expect(selected).toHaveLength(files.length);
    expect(first.map((file) => file.moduleId)).not.toContain(runtimeBuildTest);
    expect(second.map((file) => file.moduleId)).toContain(runtimeBuildTest);
    expect(selected).toContain(
      path.join(repositoryRoot, "src/__test-helpers__/ci-sequencer.test.ts"),
    );
    for (const shard of [1, 2]) {
      const baseline = await baseShard(files, shard, 2);
      const optimized = await optimizedShard(files, shard, 2);
      expect(
        optimized.filter((file) => file.moduleId !== runtimeBuildTest),
      ).toEqual(baseline.filter((file) => file.moduleId !== runtimeBuildTest));
    }
  });

  it("uses Vitest hashing when the pinned file is absent", async () => {
    const files = [
      specification(path.join(repositoryRoot, "src/runtime/bash.test.ts")),
      specification(path.join(repositoryRoot, "src/runtime/command.test.ts")),
      specification(path.join(repositoryRoot, "src/render/claude.test.ts")),
    ];

    await expect(optimizedShard(files, 1, 2)).resolves.toEqual(
      await baseShard(files, 1, 2),
    );
    await expect(optimizedShard(files, 2, 2)).resolves.toEqual(
      await baseShard(files, 2, 2),
    );
  });

  it("uses Vitest hashing for POSIX and mixed-project selections", async () => {
    const files = [
      specification(runtimeBuildTest),
      specification(
        path.join(
          repositoryRoot,
          "src/skill-scripts/devcanon-runtime-conformance.integration.test.ts",
        ),
        "integration-posix",
      ),
    ];

    await expect(optimizedShard(files, 1, 2)).resolves.toEqual(
      await baseShard(files, 1, 2),
    );
  });

  it("uses Vitest hashing for other shard counts", async () => {
    const files = [
      specification(runtimeBuildTest),
      specification(path.join(repositoryRoot, "src/runtime/bash.test.ts")),
      specification(path.join(repositoryRoot, "src/runtime/command.test.ts")),
    ];

    await expect(optimizedShard(files, 1, 3)).resolves.toEqual(
      await baseShard(files, 1, 3),
    );
  });
});
