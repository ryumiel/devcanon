import { open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
export async function writeTextAtomically(targetPath, content) {
    const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tempPath, content, "utf-8");
    try {
        const handle = await open(tempPath, "r");
        try {
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
