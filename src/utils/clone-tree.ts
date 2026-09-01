import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";

const maxConcurrentIo = 32;

/** Copy a tree with copy-on-write cloning when the filesystem supports it. */
export async function cloneTree(
  source: string,
  destination: string,
): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  const limit = createIoLimit(maxConcurrentIo);
  const sourceStat = await limit(() => lstat(source));
  await cloneDirectoryEntry(source, destination, sourceStat.mode, limit);
}

async function cloneDirectoryEntry(
  source: string,
  destination: string,
  sourceMode: number,
  limit: IoLimit,
): Promise<void> {
  await limit(() => mkdir(destination, { recursive: true }));
  const entries = await limit(() => readdir(source, { withFileTypes: true }));
  await Promise.all(
    entries.map(async (entry) => {
      const sourceEntry = path.join(source, entry.name);
      const destinationEntry = path.join(destination, entry.name);
      if (entry.isFile()) {
        await limit(() =>
          copyFile(sourceEntry, destinationEntry, constants.COPYFILE_FICLONE),
        );
        return;
      }
      if (entry.isDirectory()) {
        const stat = await limit(() => lstat(sourceEntry));
        await cloneDirectoryEntry(
          sourceEntry,
          destinationEntry,
          stat.mode,
          limit,
        );
        return;
      }
      if (entry.isSymbolicLink()) {
        const target = await limit(() => readlink(sourceEntry));
        await limit(() => symlink(target, destinationEntry));
        return;
      }
      throw new Error(`Unsupported tree entry: ${sourceEntry}`);
    }),
  );
  await limit(() => chmod(destination, sourceMode & 0o7777));
}

type IoLimit = <T>(operation: () => Promise<T>) => Promise<T>;

function createIoLimit(concurrency: number): IoLimit {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  };
}
