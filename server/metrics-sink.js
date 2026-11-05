import fs from 'node:fs';
import path from 'node:path';

/** One asynchronous writer per process. All files live in the configured metrics directory. */
export function createMetricsSink({ file, summaryFile, maxFileBytes, maxFiles, directoryBytes, io = fs.promises }) {
  const directory = path.dirname(file);
  let evictedFiles = 0;
  let evictedBytes = 0;
  const rotated = index => file.replace(/\.jsonl$/, `.${index}.jsonl`);
  const optional = async operation => {
    try { return await operation(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  const size = async name => (await optional(() => io.stat(name)))?.size || 0;

  async function rotate() {
    if (maxFiles === 1) {
      await optional(() => io.unlink(file));
      return;
    }
    await optional(() => io.unlink(rotated(maxFiles - 1)));
    for (let index = maxFiles - 2; index >= 1; index -= 1) {
      await optional(() => io.rename(rotated(index), rotated(index + 1)));
    }
    await optional(() => io.rename(file, rotated(1)));
  }

  async function makeRoom(incomingBytes) {
    const files = [];
    for (const name of await io.readdir(directory)) {
      if (!/^metrics-[a-zA-Z0-9_.-]+\.(?:jsonl|json)$/.test(name)) continue;
      const full = path.join(directory, name);
      const stat = await optional(() => io.stat(full));
      if (stat?.isFile()) files.push({ full, bytes: stat.size, time: stat.mtimeMs });
    }
    let total = files.reduce((sum, item) => sum + item.bytes, 0);
    // Current files are owned by this writer. Other streams reopen their raw file on
    // every append, so retention can reclaim their old files across container restarts.
    const candidates = files.filter(item => item.full !== file && item.full !== summaryFile)
      .sort((a, b) => a.time - b.time || a.full.localeCompare(b.full));
    for (const item of candidates) {
      if (total + incomingBytes <= directoryBytes) break;
      try {
        await io.unlink(item.full);
        evictedFiles += 1;
        evictedBytes += item.bytes;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      total -= item.bytes;
    }
    if (total + incomingBytes > directoryBytes) {
      const error = new Error('Metrics directory budget exhausted');
      error.code = 'METRICS_QUOTA';
      throw error;
    }
  }

  return {
    async append(text) {
      const bytes = Buffer.byteLength(text);
      if (bytes > maxFileBytes) throw Object.assign(new Error('Metrics batch too large'), { code: 'METRICS_BATCH_SIZE' });
      if (await size(file) + bytes > maxFileBytes) await rotate();
      await makeRoom(bytes);
      await io.appendFile(file, text, { encoding: 'utf8', mode: 0o600 });
    },
    async summary(snapshot) {
      const temporary = `${summaryFile}.tmp`;
      try {
        const text = JSON.stringify(snapshot, null, 2);
        await makeRoom(Buffer.byteLength(text));
        await io.writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
        await io.rename(temporary, summaryFile);
      } finally { await optional(() => io.unlink(temporary)); }
    },
    status() { return { evictedFiles, evictedBytes }; },
  };
}
