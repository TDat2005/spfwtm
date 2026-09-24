import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { BackgroundJob } from "../domain/BackgroundJob.ts";
import type { JobQueue } from "../application/JobQueue.ts";

export class DatabaseJobQueue implements JobQueue {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueue(job: BackgroundJob): Promise<void> {
    await this.prisma.backgroundJob.create({
      data: {
        id: job.id,
        jobType: job.jobName,
        payload: JSON.stringify(job.payload),
        payloadVersion: job.payloadVersion,
        processorVersion: job.processorVersion,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    });
  }

  async acquireNext(jobTypes: string[]): Promise<BackgroundJob | null> {
    const candidate = await this.prisma.backgroundJob.findFirst({
      where: {
        status: "PENDING",
        jobType: { in: jobTypes },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!candidate) return null;

    await this.prisma.backgroundJob.update({
      where: { id: candidate.id },
      data: {
        status: "PROCESSING",
        attempts: candidate.attempts + 1,
        updatedAt: new Date(),
      },
    });

    return new BackgroundJob({
      id: candidate.id,
      jobName: candidate.jobType,
      payload: JSON.parse(candidate.payload) as Record<string, unknown>,
      payloadVersion: candidate.payloadVersion,
      processorVersion: candidate.processorVersion,
      status: "PROCESSING",
      attempts: candidate.attempts + 1,
      maxAttempts: candidate.maxAttempts,
      lastError: candidate.lastError,
      createdAt: candidate.createdAt,
      updatedAt: new Date(),
    });
  }

  async save(job: BackgroundJob): Promise<void> {
    await this.prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: job.status,
        attempts: job.attempts,
        lastError: job.lastError,
        updatedAt: job.updatedAt,
      },
    });
  }

  async findById(id: string): Promise<BackgroundJob | null> {
    const row = await this.prisma.backgroundJob.findUnique({
      where: { id },
    });
    if (!row) return null;

    return new BackgroundJob({
      id: row.id,
      jobName: row.jobType,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      payloadVersion: row.payloadVersion,
      processorVersion: row.processorVersion,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
