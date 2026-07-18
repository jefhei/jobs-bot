import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { prisma } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WatchBody {
  keyword: string;
  location?: string;
  jobType?: string;
  minSalary?: number;
  experienceLevel?: string;
  sources?: string[];
  intervalMinutes?: number;
  notifyVia?: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

// ─── Server instance (held for stopApiServer) ─────────────────────────────────

let server: FastifyInstance | null = null;

// ─── Auth hook ────────────────────────────────────────────────────────────────

function setupAuth(instance: FastifyInstance): void {
  instance.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Only apply auth to /api routes
    if (!request.url.startsWith("/api")) {
      return;
    }

    const apiKey = request.headers["x-api-key"] as string | undefined;

    if (!apiKey) {
      reply.status(401).send({ success: false, error: "unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { apiKey },
    });

    if (!user) {
      reply.status(401).send({ success: false, error: "unauthorized" });
      return;
    }

    request.userId = user.id;
  });
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function createWatchHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const body = request.body as WatchBody;
  const userId = request.userId!;

  if (!body.keyword || typeof body.keyword !== "string") {
    reply.status(400).send({
      success: false,
      error: "keyword is required and must be a string",
    });
    return;
  }

  const watch = await prisma.watchConfig.create({
    data: {
      userId,
      keyword: body.keyword,
      location: body.location || null,
      jobType: body.jobType || null,
      minSalary: body.minSalary || null,
      experienceLevel: body.experienceLevel || null,
      sources: body.sources || [
        "linkedin",
        "indeed",
        "greenhouse",
        "lever",
      ],
      intervalMinutes: body.intervalMinutes ?? 30,
      notifyVia: body.notifyVia || ["telegram"],
    },
  });

  reply.send({
    success: true,
    watch: {
      id: watch.id,
      keyword: watch.keyword,
      location: watch.location,
      jobType: watch.jobType,
      minSalary: watch.minSalary,
      experienceLevel: watch.experienceLevel,
      sources: watch.sources,
      intervalMinutes: watch.intervalMinutes,
      notifyVia: watch.notifyVia,
      active: watch.active,
      createdAt: watch.createdAt,
    },
  });
}

async function listWatchesHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = request.userId!;

  const watches = await prisma.watchConfig.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  reply.send({
    success: true,
    watches: watches.map((w) => ({
      id: w.id,
      keyword: w.keyword,
      location: w.location,
      jobType: w.jobType,
      minSalary: w.minSalary,
      experienceLevel: w.experienceLevel,
      sources: w.sources,
      intervalMinutes: w.intervalMinutes,
      notifyVia: w.notifyVia,
      active: w.active,
      createdAt: w.createdAt,
    })),
  });
}

async function removeWatchHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = request.userId!;
  const { id } = request.params as { id: string };

  try {
    await prisma.watchConfig.update({
      where: { id, userId },
      data: { active: false },
    });

    reply.send({ success: true });
  } catch {
    reply.status(404).send({ success: false, error: "watch not found" });
  }
}

function registerRoutes(instance: FastifyInstance): void {
  instance.post("/api/watch", createWatchHandler);
  instance.get("/api/watch", listWatchesHandler);
  instance.delete("/api/watch/:id", removeWatchHandler);
}

// ─── createApp (for testing) ──────────────────────────────────────────────────

export function createApp(): FastifyInstance {
  const instance = Fastify({ logger: false });
  instance.register(cors, { origin: true });
  setupAuth(instance);
  registerRoutes(instance);
  return instance;
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

export async function startApiServer(port?: number): Promise<FastifyInstance> {
  const resolvedPort = port ?? parseInt(process.env.API_PORT || "3001", 10);

  const instance = Fastify({ logger: true });
  await instance.register(cors, { origin: true });
  setupAuth(instance);
  registerRoutes(instance);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    instance.log.info(`Received ${signal}, shutting down...`);
    await instance.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await instance.listen({ port: resolvedPort, host: "0.0.0.0" });
  server = instance;

  return instance;
}

export async function stopApiServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
  }
}
