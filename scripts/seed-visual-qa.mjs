import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const VISUAL_QA_KEY = "visual-qa";
const fixtureDir = new URL("../public/visual-qa/", import.meta.url);
const fixtureBase = process.env.VISUAL_QA_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
const seedProcessedKeys = process.argv.includes("--processed");
const shopArg = process.argv.find((arg) => arg.endsWith(".myshopify.com"));

if (seedProcessedKeys && !process.env.STORAGE_PUBLIC_BASE_URL) {
    console.error([
        "--processed requires STORAGE_PUBLIC_BASE_URL in this shell and in the running app server.",
        "Set it to the app origin that serves /visual-qa fixtures, usually the Shopify dev tunnel URL.",
    ].join("\n"));
    process.exit(1);
}

function usage() {
    console.error([
        "Usage: npm run seed:visual-qa -- <shop.myshopify.com> [--processed]",
        "",
        "Creates representative dev-only Jobs dashboard states for embedded visual QA.",
        "Use --processed only when STORAGE_PUBLIC_BASE_URL points at the running app origin in both this shell and the app server.",
    ].join("\n"));
    process.exit(1);
}

async function resolveShop() {
    if (shopArg) return shopArg;
    const sessions = await prisma.session.findMany({ select: { shop: true }, distinct: ["shop"] });
    if (sessions.length === 1) return sessions[0].shop;
    usage();
}

function writeFixtureImages() {
    mkdirSync(fixtureDir, { recursive: true });
    for (let index = 1; index <= 10; index += 1) {
        writeFileSync(new URL(`original-${index}.svg`, fixtureDir), svgFixture({ index, processed: false }));
        writeFileSync(new URL(`processed-${index}.svg`, fixtureDir), svgFixture({ index, processed: true }));
    }
}

function svgFixture({ index, processed }) {
    const base = processed ? "#f7f3ea" : "#ded8cd";
    const accent = processed ? "#11110f" : "#6f6a62";
    const label = processed ? "Studio Ready" : "Original";
    const shapeOffset = 22 + (index % 4) * 14;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100" viewBox="0 0 900 1100" role="img" aria-label="${label} product image ${index}">
  <rect width="900" height="1100" fill="${base}"/>
  <rect x="90" y="96" width="720" height="908" rx="10" fill="#fffdf7" opacity="0.72"/>
  <ellipse cx="450" cy="816" rx="250" ry="46" fill="#11110f" opacity="0.08"/>
  <rect x="${300 + shapeOffset}" y="264" width="220" height="470" rx="46" fill="${accent}" opacity="${processed ? "0.92" : "0.62"}"/>
  <rect x="${342 + shapeOffset}" y="210" width="136" height="92" rx="32" fill="${accent}" opacity="${processed ? "0.78" : "0.45"}"/>
  <path d="M${318 + shapeOffset} 690c62 36 202 36 264 0" fill="none" stroke="#fffdf7" stroke-width="18" stroke-linecap="round" opacity="0.42"/>
  <text x="450" y="970" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="600" fill="#191815">${label}</text>
  <text x="450" y="1018" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="22" fill="#6f6a62">Visual QA ${index}</text>
</svg>`;
}

function fixtureUrl(name) {
    return `${fixtureBase}/visual-qa/${name}`;
}

function imageRows(shop, statuses, startIndex = 1) {
    return statuses.map((status, offset) => {
        const index = startIndex + offset;
        const processedKey = seedProcessedKeys && isReviewableStatus(status)
            ? `visual-qa/processed-${index}.svg`
            : null;

        return {
            shopifyMediaId: `gid://shopify/MediaImage/visual-qa-${index}-${status}`,
            shopifyProductId: `gid://shopify/Product/visual-qa-${index}`,
            shopifyAltText: `Unoir visual QA product ${index}`,
            originalUrl: fixtureUrl(`original-${index}.svg`),
            originalBackupKey: `visual-qa/original-backup-${index}.svg`,
            processedKey,
            status,
            errorMessage: status === "failed"
                ? "Visual QA simulated processing failure"
                : status === "failed_publish"
                    ? "Visual QA simulated Shopify publish failure"
                    : null,
            recoveryAttempts: status === "processed" && index % 3 === 0 ? 1 : 0,
            recoveryReason: status === "processed" && index % 3 === 0 ? "worker-recovered-stale-processing" : null,
            publishedMediaId: status === "published" || status === "failed_publish"
                ? `gid://shopify/MediaImage/visual-qa-published-${index}`
                : null,
            publishMode: status === "published" || status === "failed_publish" ? "append" : null,
        };
    });
}

function isReviewableStatus(status) {
    return ["processed", "approved", "rejected", "publishing", "failed_publish", "published"].includes(status);
}

async function createJob(shop, input) {
    const images = imageRows(shop, input.statuses, input.startIndex);
    return prisma.processingJob.create({
        data: {
            shop,
            status: input.status,
            background: input.background,
            totalImages: images.length,
            idempotencyKey: `${VISUAL_QA_KEY}:${input.slug}`,
            completedAt: input.completed ? new Date(Date.now() - input.completedMinutesAgo * 60_000) : null,
            createdAt: new Date(Date.now() - input.createdMinutesAgo * 60_000),
            images: { create: images },
        },
    });
}

async function main() {
    const shop = await resolveShop();
    writeFixtureImages();

    await prisma.processingJob.deleteMany({
        where: { shop, idempotencyKey: { startsWith: `${VISUAL_QA_KEY}:` } },
    });

    const jobs = await Promise.all([
        createJob(shop, {
            slug: "review-ready",
            status: "completed",
            background: "white",
            statuses: ["processed", "processed", "approved", "rejected", "processed", "approved", "processed", "rejected"],
            startIndex: 1,
            createdMinutesAgo: 38,
            completedMinutesAgo: 28,
            completed: true,
        }),
        createJob(shop, {
            slug: "publish-recovery",
            status: "partially_published",
            background: "atelier",
            statuses: ["published", "published", "failed_publish", "approved", "rejected", "failed"],
            startIndex: 3,
            createdMinutesAgo: 96,
            completedMinutesAgo: 74,
            completed: true,
        }),
        createJob(shop, {
            slug: "processing",
            status: "processing",
            background: "porcelain",
            statuses: ["processing", "processing", "pending", "processed", "pending"],
            startIndex: 5,
            createdMinutesAgo: 8,
            completedMinutesAgo: 0,
            completed: false,
        }),
        createJob(shop, {
            slug: "published-rollback",
            status: "published",
            background: "noir",
            statuses: ["published", "published", "published", "publishing"],
            startIndex: 7,
            createdMinutesAgo: 150,
            completedMinutesAgo: 128,
            completed: true,
        }),
    ]);

    console.log(`Seeded ${jobs.length} visual QA jobs for ${shop}.`);
    console.log("Open /app/jobs inside the embedded Shopify app to inspect Jobs hierarchy and action states.");
    if (!seedProcessedKeys) {
        console.log("Preview compare fixtures were not enabled. Rerun with --processed only when STORAGE_PUBLIC_BASE_URL points at the same app origin in this shell and the running app server.");
    }
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });