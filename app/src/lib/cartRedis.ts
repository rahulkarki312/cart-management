import redisClient from "./redis";
import { CartItem } from "../types/cart";
import { prisma } from "../lib/prisma";
import { inventory_product } from "../../generated/prisma";

// Key prefix for cart data in Redis
const CART_KEY_PREFIX = "cart:";

const CART_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Generates the base Redis key for a user's cart.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @returns The base Redis key.
 */
function _getCartBaseKey(identifier: string): string {
  return `${CART_KEY_PREFIX}${identifier}`;
}

/**
 * Generates the Redis key for a user's cart quantities.
 * Stores { productId: quantity }
 * @param identifier The unique identifier for the cart.
 * @returns The Redis key.
 */
function _getCartQtyKey(identifier: string): string {
  return `${_getCartBaseKey(identifier)}:qty`;
}

/**
 * Generates the Redis key for a user's cart item details.
 * Stores { productId: JSON.stringify({ name, price, ...other_details }) }
 * @param identifier The unique identifier for the cart.
 * @returns The Redis key.
 */
function _getCartDetailsKey(identifier: string): string {
  return `${_getCartBaseKey(identifier)}:details`;
}

/**
 * Generates the Redis key for a user's cart promo code.
 * @param identifier The unique identifier for the cart.
 * @returns The Redis key.
 */
function _getCartPromoKey(identifier: string): string {
  return `${_getCartBaseKey(identifier)}:promo`;
}

/**
 * Sets or resets the TTL for a user's cart and its associated promo code in Redis.
 * This extends the cart's lifespan from the last interaction.
 * @param identifier The unique identifier for the cart.
 * @param pipeline An optional Redis pipeline to add commands to.
 */
async function _refreshCartTTL(identifier: string, pipeline?: ReturnType<typeof redisClient.multi>): Promise<void> {
  const qtyKey = _getCartQtyKey(identifier);
  const detailsKey = _getCartDetailsKey(identifier);
  const promoKey = _getCartPromoKey(identifier);

  const client = pipeline || redisClient; // Use pipeline if provided, otherwise direct client

  // If not using a pipeline, execute directly with Promise.all for concurrency
  if (!pipeline) {
    await Promise.all([
      client.expire(qtyKey, CART_TTL_SECONDS),
      client.expire(detailsKey, CART_TTL_SECONDS),
      client.expire(promoKey, CART_TTL_SECONDS),
    ]);
  } else {
    // Add expire commands to the pipeline
    pipeline.expire(qtyKey, CART_TTL_SECONDS);
    pipeline.expire(detailsKey, CART_TTL_SECONDS);
    pipeline.expire(promoKey, CART_TTL_SECONDS);
  }
}

/**
 * Adds a product to the user's cart in Redis.
 * Stores quantity and product details in separate hashes.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @param item The CartItem to add.
 * @returns A promise that resolves when the operation is complete.
 */
export async function addProductToCart(
  identifier: string,
  item: CartItem
): Promise<void> {
  const qtyKey = _getCartQtyKey(identifier);
  const detailsKey = _getCartDetailsKey(identifier);
  const productId = item.productId;

  // Extract only necessary details for the 'details' hash to keep it lean
  const productDetails = {
    productId: item.productId,
    name: item.name,
    price: item.price,
    // Include other non-quantity specific details here if any
  };

  const pipeline = redisClient.multi(); // Start a transaction pipeline (atomic)

  // Increment quantity in the quantity hash
  pipeline.hincrby(qtyKey, productId, item.quantity);

  // Set product details (always update to ensure they're fresh)
  pipeline.hset(detailsKey, productId, JSON.stringify(productDetails));

  await _refreshCartTTL(identifier, pipeline); // Add TTL commands to the pipeline

  try {
    await pipeline.exec(); // Execute all commands in the pipeline
  } catch (error) {
    console.error(
      `Error adding product to cart for identifier ${identifier}:`,
      error
    );
    throw error;
  }
}

/**
 * Retrieves the entire cart for a user from Redis by combining data from qty and details hashes.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @returns An array of CartItem objects.
 */
export async function getCart(identifier: string): Promise<CartItem[]> {
  const qtyKey = _getCartQtyKey(identifier);
  const detailsKey = _getCartDetailsKey(identifier);

  try {
    // Use a pipeline to fetch quantities and details concurrently
    const results = await redisClient.multi()
      .hgetall(qtyKey)
      .hgetall(detailsKey)
      .exec();

    if (!results) {
        // This usually means the transaction was aborted (e.g., if WATCH was used and a key changed)
        // For simple multi/exec without WATCH, this path is less likely to be hit on success.
        console.warn(`Redis transaction for cart ${identifier} aborted or returned null results.`);
        return [];
    }

    // Explicitly cast each result tuple and extract the actual data
    const [qtyResult, detailsResult] = results;

    if (qtyResult[0] || detailsResult[0]) {
        // Handle individual command errors within the transaction
        console.error("Error in Redis multi/exec for cart:", qtyResult[0] || detailsResult[0]);
        throw qtyResult[0] || detailsResult[0]; // Re-throw the first error found
    }

    const qtys = qtyResult[1] as Record<string, string>;
    const details = detailsResult[1] as Record<string, string>;

    const cartItems: CartItem[] = [];

    // Reset TTL only if cart is not empty after fetching
    if (Object.keys(qtys).length > 0) {
      await _refreshCartTTL(identifier); // No pipeline here, as it's a read operation
    }

    // Combine quantities and details
    for (const productId in qtys) {
      if (qtys.hasOwnProperty(productId)) {
        const quantity = parseInt(qtys[productId], 10);
        const detailJson = details[productId];

        if (detailJson) {
          const productData = JSON.parse(detailJson);
          cartItems.push({
            productId: productId,
            name: productData.name,
            price: productData.price,
            quantity: quantity,
            // Include other details if present in productData
          } as CartItem); // Cast to CartItem
        }
      }
    }
    return cartItems;
  } catch (error) {
    console.error(`Error fetching cart for identifier ${identifier}:`, error);
    throw error;
  }
}

/**
 * Removes a product from the user's cart.
 * Removes from both quantity and details hashes.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @param productId The ID of the product to remove.
 */
export async function removeProductFromCart(
  identifier: string,
  productId: string
): Promise<void> {
  const qtyKey = _getCartQtyKey(identifier);
  const detailsKey = _getCartDetailsKey(identifier);
  const promoKey = _getCartPromoKey(identifier);

  const pipeline = redisClient.multi();

  pipeline.hdel(qtyKey, productId);
  pipeline.hdel(detailsKey, productId);

  await _refreshCartTTL(identifier, pipeline); // Add TTL commands to the pipeline

  try {
    await pipeline.exec();
    // After deletion, check if the cart (qtyKey) is now empty
    if (await redisClient.hlen(qtyKey) === 0) {
      await redisClient.del(promoKey); // Delete promo code if cart is empty
      console.log(`Cart ${identifier} is now empty. Promo code ${promoKey} deleted.`);
    }
  } catch (error) {
    console.error(
      `Error removing product ${productId} from cart for identifier ${identifier}:`,
      error
    );
    throw error;
  }
}

/**
 * Clears the entire cart for a user.
 * Deletes all related keys (qty, details, promo).
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 */
export async function clearCart(identifier: string): Promise<void> {
  const qtyKey = _getCartQtyKey(identifier);
  const detailsKey = _getCartDetailsKey(identifier);
  const promoKey = _getCartPromoKey(identifier);

  try {
    await redisClient.del(qtyKey, detailsKey, promoKey);
    console.log(`Cart cleared for identifier ${identifier}`);
  } catch (error) {
    console.error(`Error clearing cart for identifier ${identifier}:`, error);
    throw error;
  }
}

/**
 * Updates the quantity of a product in the user's cart.
 * If quantity is 0 or less, the item is removed from both hashes.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @param productId The ID of the product to update.
 * @param quantity The new quantity.
 */
export async function updateCartItemQuantity(
  identifier: string,
  productId: string,
  quantity: number
): Promise<void> {
  const qtyKey = _getCartQtyKey(identifier);
  const detailsKey = _getCartDetailsKey(identifier);
  const promoKey = _getCartPromoKey(identifier);

  const pipeline = redisClient.multi();

  if (quantity <= 0) {
    pipeline.hdel(qtyKey, productId);
    pipeline.hdel(detailsKey, productId);
    await _refreshCartTTL(identifier, pipeline); // Refresh TTL for remaining cart items if any
    await pipeline.exec(); // Execute deletion
    // After deletion, check if the cart (qtyKey) is now empty
    if (await redisClient.hlen(qtyKey) === 0) {
      await redisClient.del(promoKey); // Delete promo code if cart is empty
      console.log(`Cart ${identifier} is now empty. Promo code ${promoKey} deleted.`);
    }
    console.log(`Product ${productId} removed from cart for identifier ${identifier} due to quantity <= 0`);
    return;
  }

  // Update quantity in the quantity hash
  pipeline.hset(qtyKey, productId, quantity.toString()); // HSET stores string

  await _refreshCartTTL(identifier, pipeline); // Refresh TTL for cart

  try {
    await pipeline.exec();
    console.log(`Quantity of product ${productId} updated to ${quantity} for identifier ${identifier}`);
  } catch (error) {
    console.error(
      `Error updating quantity for product ${productId} in cart for identifier ${identifier}:`,
      error
    );
    throw error;
  }
}

/**
 * Applies a promotion code to the user's cart.
 * Stored as a simple string or JSON object under a related Redis key.
 * @param identifier The cart/session identifier.
 * @param promoCode The promotion code to apply.
 */
export async function applyPromoCodeToCart(identifier: string, promoCode: string): Promise<void> {
  const promoKey = _getCartPromoKey(identifier);
  const pipeline = redisClient.pipeline();

  pipeline.set(promoKey, promoCode);
  await _refreshCartTTL(identifier, pipeline); // Refresh TTL for cart

  try {
    await pipeline.exec();
    console.log(`Promo code '${promoCode}' applied to cart for identifier ${identifier}`);
  } catch (error) {
    console.error(`Error applying promo code for identifier ${identifier}:`, error);
    throw error;
  }
}

/**
 * Retrieves the applied promotion code for a user's cart.
 * @param identifier The cart/session identifier.
 * @returns The promo code or null.
 */
export async function getAppliedPromoCode(identifier: string): Promise<string | null> {
  const promoKey = _getCartPromoKey(identifier);
  try {
    return await redisClient.get(promoKey);
  } catch (error) {
    console.error(`Error retrieving promo code for identifier ${identifier}:`, error);
    throw error;
  }
}

/**
 * Updates an existing product item's details in the user's cart in Redis.
 * This function overwrites the entire CartItem object's details associated with the productId.
 * Quantity is handled separately.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @param item The complete CartItem object with updated details (its productId is used as the key).
 * @returns A promise that resolves when the operation is complete.
 */
export async function updateCartItem(identifier: string, item: CartItem): Promise<void> {
  const detailsKey = _getCartDetailsKey(identifier);
  const productId = item.productId;

  // Extract only necessary details for the 'details' hash
  const productDetails = {
    productId: item.productId,
    name: item.name,
    price: item.price,
    // ... other non-quantity specific details here if any
  };

  const pipeline = redisClient.pipeline();
  pipeline.hset(detailsKey, productId, JSON.stringify(productDetails));
  await _refreshCartTTL(identifier, pipeline); // Refresh TTL for cart
  try {
    await pipeline.exec();
  } catch (error) {
    console.error(`Error updating cart item details for product ${productId} in cart for identifier ${identifier}:`, error);
    throw error;
  }
}

/**
 * Validates and sanitizes the items in a user's cart against the active products in the database.
 * This function performs the following actions:
 * - Fetches all items currently in the user's Redis cart.
 * - Queries the database for active products matching the IDs found in the cart.
 * - Removes any cart items whose `productId` no longer exists or is inactive in the database.
 * - Updates product `name` and `price` for existing cart items if they differ from the database's current values.
 * - Returns a cleaned and validated list of cart items, with `valid` and `error` flags indicating status.
 *
 * @param identifier The unique identifier for the cart (session ID for guests, or authenticated user ID).
 * @returns A promise that resolves to an array of validated and sanitized `CartItem` objects.
 * An empty array is returned if the cart is empty or all items are invalid.
 */
export async function validateAndSanitizeCart(identifier: string): Promise<CartItem[]> {
  const cartItems = await getCart(identifier);
  console.log('1. Cart Items Retrieved from Redis:', JSON.stringify(cartItems));

  if (!cartItems.length) {
    console.log('2. Cart is empty after retrieval.');
    return [];
  }

  const productIds = cartItems.map(item => parseInt(item.productId, 10));
  console.log('3. Product IDs parsed from cart items (for DB query):', productIds);

  const products: inventory_product[] = await prisma.inventory_product.findMany({
    where: {
      id: { in: productIds },
      is_active: true,
    },
  });

  console.log('4. Products fetched from DB:', products.map(p => ({
    id: p.id,
    name: p.name,
    is_active: p.is_active,
    price: p.price,
  })));

  const productMap = new Map<string, inventory_product>(
    products.map(product => [product.id.toString(), product])
  );
  console.log('5. Product Map Keys (from DB products):', Array.from(productMap.keys()));

  const cleanedCart: CartItem[] = [];
  const pipeline = redisClient.multi(); // Initialize a Redis pipeline for batching operations

  for (const item of cartItems) {
    console.log(`6. Processing cart item with productId: "${item.productId}" (type: ${typeof item.productId})`);
    const product: inventory_product | undefined = productMap.get(item.productId);

    if (!product) {
      console.warn(`7. Product "${item.productId}" NOT FOUND or INACTIVE in DB. Removing from cart.`);
      // Add deletion commands to the pipeline
      pipeline.hdel(_getCartQtyKey(identifier), item.productId);
      pipeline.hdel(_getCartDetailsKey(identifier), item.productId);
      continue; // Skip to next item
    } else {
      console.log(`7. Product "${item.productId}" FOUND in DB.`);
    }

    let updated = false;
    const dbPrice = Number(product.price);

    // Only update details if they've actually changed
    if (item.name !== product.name || item.price !== dbPrice) {
      console.log(`8. Item "${item.productId}" needs update: Name changed from "${item.name}" to "${product.name}" or Price changed from ${item.price} to ${dbPrice}`);
      item.name = product.name;
      item.price = dbPrice;
      updated = true;
    }

    if (updated) {
       console.log(`9. Updating item "${item.productId}" in Redis due to data mismatch.`);
       // Add update command to the pipeline
       pipeline.hset(_getCartDetailsKey(identifier), item.productId, JSON.stringify({
           productId: item.productId,
           name: item.name,
           price: item.price,
           // ... other details if any
       }));
    }

    cleanedCart.push({
      ...item,
      valid: true,
      error: '',
    });
  }

  // Execute all accumulated pipeline commands for deletions and updates
  if (pipeline.length > 0) { // Check if there are any commands to execute
      console.log(`10. Executing Redis pipeline for cart validation updates/deletions for identifier: ${identifier}`);
      // Add TTL commands to the same pipeline to ensure they are part of the atomic transaction
      await _refreshCartTTL(identifier, pipeline);
      await pipeline.exec();
  }

  // Final check to see if the cart became empty and delete promo code if so
  // This check relies on the result of the pipeline, so it must be done afterwards.
  if (await redisClient.hlen(_getCartQtyKey(identifier)) === 0) {
      await redisClient.del(_getCartPromoKey(identifier));
      console.log(`Cart ${identifier} is now empty after validation. Promo code deleted.`);
  }

  console.log('11. Cleaned Cart before returning:', JSON.stringify(cleanedCart));
  return cleanedCart;
}