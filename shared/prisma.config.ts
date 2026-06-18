import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "src/schemas/schema.prisma",
  migrations: {
    path: "src/schemas/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
