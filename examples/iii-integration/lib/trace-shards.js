import fsSync from "node:fs";
import path from "node:path";

export function shardPath(shardsDir, sessionId) {
  return path.join(shardsDir, `${sessionId}.jsonl`);
}

export function appendShardRecord(shardsDir, sessionId, record) {
  fsSync.mkdirSync(shardsDir, { recursive: true });
  const line = JSON.stringify({ session_id: sessionId, seq: record.seq, ...record.payload });
  fsSync.appendFileSync(shardPath(shardsDir, sessionId), `${line}\n`, "utf8");
}

export function readShardsAboveWatermark(shardsDir, watermark) {
  const records = [];
  if (!fsSync.existsSync(shardsDir)) return records;
  for (const file of fsSync.readdirSync(shardsDir)) {
    if (!file.endsWith(".jsonl")) continue;
    const content = fsSync.readFileSync(path.join(shardsDir, file), "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row.seq > watermark) records.push(row);
    }
  }
  return records.sort((a, b) => a.seq - b.seq);
}

export function mergeShardsToExecutorLog(executorLogPath, shardsDir, watermark) {
  const newRecords = readShardsAboveWatermark(shardsDir, watermark);
  if (newRecords.length === 0) return watermark;
  const lines = newRecords.map((r) => `- ${r.msn_id ?? "MSN"}: ${r.message ?? "trace"}`);
  fsSync.appendFileSync(executorLogPath, `${lines.join("\n")}\n`, "utf8");
  const maxSeq = Math.max(...newRecords.map((r) => r.seq));
  return maxSeq;
}
