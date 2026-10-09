import { Queue, type ConnectionOptions, type JobState } from "bullmq";
import type { JobInspector, JobPublisher } from "../application/JobQueue.ts";
import type { BackgroundJob } from "../domain/BackgroundJob.ts";
import {
  JOB_LANES,
  type JobDefinition,
  type JobLane,
} from "../domain/JobDefinitions.ts";

interface BullMqJobQueueOptions {
  queueNames: Record<JobLane, string>;
  connection: ConnectionOptions;
  prefix?: string;
}

const LIVE_STATES: ReadonlySet<JobState | "unknown"> = new Set([
  "waiting",
  "prioritized",
  "delayed",
  "active",
  "waiting-children",
]);

export class BullMqJobQueue implements JobPublisher, JobInspector {
  private readonly queues: Map<JobLane, Queue<Record<string, unknown>>>;

  constructor(options: BullMqJobQueueOptions) {
    this.queues = new Map(
      JOB_LANES.map((lane) => {
        const queue = new Queue<Record<string, unknown>>(options.queueNames[lane], {
          connection: options.connection,
          prefix: options.prefix,
        });
        queue.on("error", (error) => {
          console.error(`[BullMQ:${lane}] Lỗi kết nối producer:`, error.message);
        });
        return [lane, queue];
      })
    );
  }

  async enqueue(job: BackgroundJob): Promise<void> {
    await this.enqueueMany([job]);
  }

  async enqueueMany(jobs: BackgroundJob[]): Promise<void> {
    const byLane = new Map<JobLane, BackgroundJob[]>();
    for (const job of jobs) {
      const laneJobs = byLane.get(job.lane) ?? [];
      laneJobs.push(job);
      byLane.set(job.lane, laneJobs);
    }
    for (const [lane, laneJobs] of byLane) {
      const replaced = laneJobs.filter((job) => job.replaceFinished).map((job) => job.id);
      if (replaced.length > 0) await this.removeFinishedJobs(replaced, [lane]);
      await this.queue(lane).addBulk(laneJobs.map(toBullMqEntry));
    }
  }

  async findLiveJobIds(
    jobIds: string[],
    lanes: readonly JobLane[]
  ): Promise<Set<string>> {
    const live = new Set<string>();
    await this.forEachJobState(jobIds, lanes, (_lane, jobId, state) => {
      if (LIVE_STATES.has(state)) live.add(jobId);
    });
    return live;
  }

  async removeFinishedJobs(
    jobIds: string[],
    lanes: readonly JobLane[]
  ): Promise<void> {
    await this.forEachJobState(jobIds, lanes, async (lane, jobId, state) => {
      if (state === "completed" || state === "failed") {
        await this.queue(lane).remove(jobId);
      }
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }

  async upsertDailyJob(
    definition: JobDefinition,
    pattern: string,
    timezone: string
  ): Promise<void> {
    await this.upsertScheduler(definition, { pattern, tz: timezone });
  }

  async upsertRepeatingJob(
    definition: JobDefinition,
    everyMs: number
  ): Promise<void> {
    await this.upsertScheduler(definition, { every: everyMs });
  }

  private async upsertScheduler(
    definition: JobDefinition,
    repeat: { pattern: string; tz: string } | { every: number }
  ): Promise<void> {
    await this.queue(definition.lane).upsertJobScheduler(
      definition.jobName,
      repeat,
      {
        name: definition.jobName,
        data: {
          payloadVersion: definition.payloadVersion,
          processorVersion: definition.processorVersion,
        },
        opts: {
          priority: definition.priority,
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { age: 7 * 24 * 60 * 60, count: 30 },
          removeOnFail: { age: 30 * 24 * 60 * 60, count: 100 },
        },
      }
    );
  }

  private async forEachJobState(
    jobIds: string[],
    lanes: readonly JobLane[],
    visit: (lane: JobLane, jobId: string, state: JobState | "unknown") => void | Promise<void>
  ): Promise<void> {
    await Promise.all(
      lanes.flatMap((lane) =>
        jobIds.map(async (jobId) => {
          await visit(lane, jobId, await this.queue(lane).getJobState(jobId));
        })
      )
    );
  }

  private queue(lane: JobLane): Queue<Record<string, unknown>> {
    const queue = this.queues.get(lane);
    if (!queue) throw new Error(`Không có queue cho lane ${lane}`);
    return queue;
  }
}

function toBullMqEntry(job: BackgroundJob) {
  return {
    name: job.jobName,
    data: {
      ...job.payload,
      payloadVersion: job.payloadVersion,
      processorVersion: job.processorVersion,
    },
    opts: {
      jobId: job.id,
      priority: job.priority,
      delay: job.delayMs,
      attempts: job.maxAttempts,
      backoff: {
        type: "exponential" as const,
        delay: 1_000,
      },
      removeOnComplete: job.removeOnComplete
        ? true
        : {
            age: 60 * 60,
            count: 1_000,
          },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 5_000,
      },
    },
  };
}
