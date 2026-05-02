import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    if (topic !== "APP_SCOPES_UPDATE") {
        console.warn(`Unexpected topic ${topic} on app/scopes_update handler—ignoring`);
        return new Response();
    }
    console.log(`Received ${topic} webhook for ${shop}`);

    const current = payload.current as string[];
    if (session) {
        await db.session.update({
            where: {
                id: session.id
            },
            data: {
                scope: current.toString(),
            },
        });
    }
    return new Response();
};
