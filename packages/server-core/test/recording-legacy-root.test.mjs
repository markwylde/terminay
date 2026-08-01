import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RecordingService } from "../dist/index.js";

test("legacy recording roots are referenced metadata-only and survive an unavailable volume", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-recording-legacy-root-"));
  const currentRoot = join(home, "current");
  const legacyRoot = join(home, "legacy-volume");
  const recordingId = "legacy-recording-01";
  const legacyDate = join(legacyRoot, "2025-02-03");
  const castPath = join(legacyDate, `${recordingId}.cast`);
  const metadataPath = join(legacyDate, `${recordingId}.json`);
  try {
    await mkdir(legacyDate, { recursive: true });
    await writeFile(castPath, `${JSON.stringify({ version: 3, term: { cols: 80, rows: 24 }, timestamp: 1_738_588_800, title: "Imported legacy" })}\n[0,"o","legacy output\\n"]\n`);
    await writeFile(metadataPath, JSON.stringify({
      version: 2,
      recordingId,
      sessionId: "legacy-session",
      recordingState: "completed",
      startedAt: "2025-02-03T00:00:00.000Z",
      endedAt: "2025-02-03T00:01:00.000Z",
      relativeCastPath: "2025-02-03/legacy-recording-01.cast",
      title: "Imported legacy",
    }));
    const service = new RecordingService({ homeDirectory: home, recordingRoot: currentRoot, serverId: "server-a" });
    const imported = service.importLegacyRoot(legacyRoot);
    assert.equal(imported.available, true);
    assert.equal(imported.recordingCount, 1);
    assert.match(imported.rootId, /^root-[0-9a-f]{8}$/);
    assert.equal(JSON.stringify(imported).includes(home), false);
    const [item] = service.listRecordings({ search: "Imported legacy" });
    assert.equal(item.recordingId, recordingId);
    assert.equal(item.recordingState, "completed");
    assert.equal((await stat(castPath)).isFile(), true);
    assert.equal((await stat(metadataPath)).isFile(), true);

    const unavailablePath = join(home, "legacy-unmounted");
    await rename(legacyRoot, unavailablePath);
    const restarted = new RecordingService({ homeDirectory: home, recordingRoot: currentRoot, serverId: "server-a" });
    const unavailable = restarted.importRecordingRoot(legacyRoot);
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.recordingCount, 0);
    assert.equal(JSON.stringify(unavailable).includes(home), false);
    await rename(unavailablePath, legacyRoot);
    const remounted = new RecordingService({ homeDirectory: home, recordingRoot: currentRoot, serverId: "server-a" });
    const availableAgain = remounted.importRecordingRoot(legacyRoot);
    assert.equal(availableAgain.rootId, imported.rootId);
    assert.equal(availableAgain.available, true);
    assert.equal(remounted.listRecordings().some((entry) => entry.recordingId === recordingId), true);
    const index = JSON.parse(await readFile(join(home, ".terminay", "recording-roots.json"), "utf8"));
    assert.equal(index.roots.some((root) => root.endsWith("/legacy-volume")), true);
  } finally { await rm(home, { recursive: true, force: true }); }
});
