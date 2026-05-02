import { spawnSync } from "node:child_process";

const fallbackDatabaseUrl = "postgresql://prisma-generate:prisma-generate@localhost:5432/unoir_generate";
const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || fallbackDatabaseUrl,
};

const result = spawnSync(
    "npx",
    ["prisma", "generate", "--schema", "prisma/production/schema.prisma"],
    { stdio: "inherit", env },
);

process.exit(result.status ?? 1);
