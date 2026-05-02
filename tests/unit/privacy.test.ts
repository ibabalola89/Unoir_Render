import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
    processingJob: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
    },
    session: {
        deleteMany: vi.fn(),
    },
};

const deleteStoredObjects = vi.fn();

vi.mock("../../app/db.server", () => ({
    default: db,
}));

vi.mock("../../lib/storage", () => ({
    deleteStoredObjects,
}));

async function loadPrivacy() {
    return import("../../lib/shopify/privacy");
}

describe("deleteShopData", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        db.processingJob.findMany.mockResolvedValue([
            {
                images: [
                    { originalBackupKey: "originals/job_1/img_1", processedKey: "processed/job_1/img_1.jpg" },
                    { originalBackupKey: null, processedKey: "processed/job_1/img_2.png" },
                ],
            },
        ]);
        db.processingJob.deleteMany.mockResolvedValue({ count: 1 });
        db.session.deleteMany.mockResolvedValue({ count: 1 });
        deleteStoredObjects.mockResolvedValue(undefined);
    });

    it("deletes job and session rows before best-effort storage cleanup", async () => {
        const { deleteShopData } = await loadPrivacy();

        await deleteShopData("unoir.myshopify.com");

        expect(db.processingJob.findMany).toHaveBeenCalledWith({
            where: { shop: "unoir.myshopify.com" },
            include: {
                images: {
                    select: {
                        originalBackupKey: true,
                        processedKey: true,
                    },
                },
            },
        });
        expect(db.processingJob.deleteMany).toHaveBeenCalledWith({
            where: { shop: "unoir.myshopify.com" },
        });
        expect(db.session.deleteMany).toHaveBeenCalledWith({
            where: { shop: "unoir.myshopify.com" },
        });
        expect(deleteStoredObjects).toHaveBeenCalledWith([
            "originals/job_1/img_1",
            "processed/job_1/img_1.jpg",
            "processed/job_1/img_2.png",
        ]);

        expect(db.processingJob.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
            deleteStoredObjects.mock.invocationCallOrder[0],
        );
        expect(db.session.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
            deleteStoredObjects.mock.invocationCallOrder[0],
        );
    });

    it("does not fail privacy deletion when storage cleanup fails", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        deleteStoredObjects.mockRejectedValue(new Error("storage down"));
        const { deleteShopData } = await loadPrivacy();

        await expect(deleteShopData("unoir.myshopify.com")).resolves.toBeUndefined();

        expect(db.processingJob.deleteMany).toHaveBeenCalledWith({
            where: { shop: "unoir.myshopify.com" },
        });
        expect(db.session.deleteMany).toHaveBeenCalledWith({
            where: { shop: "unoir.myshopify.com" },
        });
        expect(consoleError).toHaveBeenCalledWith(
            "[privacy] storage cleanup failed for shop=unoir.myshopify.com (3 keys):",
            "storage down",
        );

        consoleError.mockRestore();
    });
});