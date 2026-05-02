import prisma from "../../app/db.server";
import { deleteStoredObjects } from "../storage";

/**
 * Delete all data for a shop (GDPR / shop redact / app uninstall).
 *
 * DB rows are deleted FIRST so compliance is satisfied even if storage
 * cleanup fails. Storage cleanup is best-effort: any failure is logged but
 * does not propagate, because retaining orphaned R2 objects is far less bad
 * than failing the redact handler and leaving DB rows behind.
 */
export async function deleteShopData(shop: string): Promise<void> {
    const jobs = await prisma.processingJob.findMany({
        where: { shop },
        include: {
            images: {
                select: {
                    originalBackupKey: true,
                    processedKey: true,
                },
            },
        },
    });

    const storageKeys = jobs.flatMap((job) =>
        job.images.flatMap((image) => [image.originalBackupKey, image.processedKey]),
    ).filter((key): key is string => Boolean(key));

    // 1. DB first — this is the compliance-critical step.
    await prisma.processingJob.deleteMany({ where: { shop } });
    await prisma.session.deleteMany({ where: { shop } });

    // 2. Storage cleanup is best-effort. Failure here leaves orphaned
    // objects but does not violate redact: the link to the shop is gone.
    try {
        await deleteStoredObjects(storageKeys);
    } catch (err) {
        console.error(
            `[privacy] storage cleanup failed for shop=${shop} (${storageKeys.length} keys):`,
            err instanceof Error ? err.message : String(err),
        );
    }
}
