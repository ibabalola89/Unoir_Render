import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, shop } = await authenticate.webhook(request);
    if (topic !== "CUSTOMERS_DATA_REQUEST") {
        console.warn(`Unexpected topic ${topic} on customers/data_request handler—ignoring`);
        return new Response();
    }
    console.log(`Received ${topic} webhook for ${shop}`);

    // Unoir stores shop/job/image processing data, not customer records.
    return new Response();
};
