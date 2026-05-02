import { json } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async () => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return json({ ok: true, checks: { app: { ok: true }, db: { ok: true } } });
    } catch (err) {
        return json(
            {
                ok: false,
                checks: {
                    app: { ok: true },
                    db: {
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    },
                },
            },
            { status: 503 },
        );
    }
};
