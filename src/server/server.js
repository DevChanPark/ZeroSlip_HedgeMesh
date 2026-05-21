import "dotenv/config";

import { createServer } from "node:http";

import { PrismaClient } from "@prisma/client";

import { createRequestHandler } from "./app.js";

const prisma = new PrismaClient();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const server = createServer(createRequestHandler({ prisma }));

server.listen(port, host, () => {
  console.log(`ZeroSlip HedgeMesh API listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
