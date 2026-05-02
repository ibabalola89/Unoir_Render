import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, shop } = await authenticate.webhook(request);
    if (topic !== "CUSTOMERS_REDACT") {
        console.warn(`Unexpected topic ${topic} on customers/redact handler—ignoring`);
        return new Response();
    }
    console.log(`Received ${topic} webhook for ${shop}`);

    // Unoir does not persist customer personal data.
    return new Response();
};
