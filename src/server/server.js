import "dotenv/config";

import { createServer } from "node:http";

import { PrismaClient } from "@prisma/client";

import { createRequestHandler } from "./app.js";

const prisma = new PrismaClient();
const port = Number(process.env.PORT || 3000);
const server = createServer(createRequestHandler({ prisma }));

server.listen(port, () => {
  console.log(`ZeroSlip HedgeMesh API listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

