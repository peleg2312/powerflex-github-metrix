import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { IngestionService } from "@powerflex/ingestion";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 15);
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue("sync", { connection });
const ingestion = new IngestionService();

async function schedule() {
  await queue.add(
    "sync-all",
    {},
    {
      jobId: "sync-all-repeatable",
      repeat: { every: intervalMinutes * 60 * 1000 },
      removeOnComplete: 25,
      removeOnFail: 100
    }
  );
  await queue.add("sync-all", { reason: "startup" }, { jobId: `startup-${Date.now()}`, removeOnComplete: 10 });
}

new Worker(
  "sync",
  async (job) => {
    if (job.name === "github-webhook") {
      console.log(`Received GitHub webhook ${job.data.event}; running targeted sync fallback.`);
    }
    const result = await ingestion.syncAll();
    console.log(`Sync complete: seen=${result.recordsSeen} upserted=${result.recordsUpserted}`);
    return result;
  },
  { connection, concurrency: 1 }
);

schedule().catch((error) => {
  console.error("Unable to schedule sync worker", error);
  process.exit(1);
});

console.log(`PowerFlex ingestion worker running; polling every ${intervalMinutes} minutes.`);
