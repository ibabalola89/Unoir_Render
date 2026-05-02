import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "@lib/shopify/privacy";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic !== "APP_UNINSTALLED") {
    console.warn(`Unexpected topic ${topic} on app/uninstalled handler—ignoring`);
    return new Response();
  }

  console.log(`Received ${topic} webhook for ${shop}`);
  await deleteShopData(shop);

  return new Response();
};
