import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";
export async function writeTextAtomically(targetPath, content) {
    const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
    const handle = await open(tempPath, "wx");
    try {
        try {
            await handle.writeFile(content, "utf-8");
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await rename(tempPath, targetPath);
        return { path: targetPath, tempPath };
    }
    catch (err) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw err;
    }
}
