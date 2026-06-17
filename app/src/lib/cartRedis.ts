// src/lib/cartRedis.ts
import redisClient from "./redis";
import { CartItem } from "../types/cart";
import { prisma } from '../lib/prisma';
import { inventory_product } from '../../generated/prisma';
// Key prefix for cart data in Redis
const CART_KEY_PREFIX = "cart:";

const CART_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

async function setCartTTL(identifier: string): Promise<void> {
  const cartKey = getUserCartKey(identifier);
  const promoKey = `${cartKey}:promo`;
  try{
    await redisClient.expire(cartKey, CART_TTL_SECONDS);
    await redisClient.expire(promoKey, CART_TTL_SECONDS);
  } catch (error) {
    console.error(`Error setting TTL for cart for identifier ${identifier}:`, error);
    throw error;
  }
}


/**
 * Generates the Redis key for a user's cart.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @returns The Redis key.
 */
function getUserCartKey(identifier: string): string {
  return `${CART_KEY_PREFIX}${identifier}`;
}

/**
 * Adds a product to the user's cart in Redis.
 * Uses a Redis Hash to store cart items.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @param item The CartItem to add.
 * @returns A promise that resolves when the operation is complete.
 */
export async function addProductToCart(
  identifier: string,
  item: CartItem
): Promise<void> {
  const cartKey = getUserCartKey(identifier);
  const itemKey = item.productId;

  try {
    // Store the item as a JSON string in a Redis Hash
    await redisClient.hset(cartKey, itemKey, JSON.stringify(item));
    await setCartTTL(identifier); // Reset TTL whenever the cart is modified
  } catch (error) {
    console.error(
      `Error adding product to cart for identifier ${identifier}:`,
      error
    );
    throw error;
  }
}

/**
 * Retrieves the entire cart for a user from Redis.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @returns An array of CartItem objects.
 */
export async function getCart(identifier: string): Promise<CartItem[]> {
  const cartKey = getUserCartKey(identifier);
  try {
    const cartData = await redisClient.hgetall(cartKey);
    if (Object.keys(cartData).length > 0) {
      await setCartTTL(identifier); // Reset TTL whenever the cart is accessed
      
    }
    return Object.values(cartData).map(item => JSON.parse(item) as CartItem);
  } catch (error) {
    console.error(`Error fetching cart for identifier ${identifier}:`, error);
    throw error;
  }
}

/**
 * Removes a product from the user's cart.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @param productId The ID of the product to remove.
 */
export async function removeProductFromCart(identifier: string, productId: string): Promise<void> {
  const cartKey = getUserCartKey(identifier);
  const itemKey = productId;
  try {

    const deletedCount = await redisClient.hdel(cartKey, itemKey);
    // if the cart still exists after deletion, reset the TTL
    if(deletedCount > 0 && await redisClient.exists(cartKey)) {
      await setCartTTL(identifier);
    }
    console.log(`Product ${productId} removed from cart for identifier ${identifier}`);
  } catch (error) {
    console.error(`Error removing product ${productId} from cart for identifier ${identifier}:`, error);
    throw error;
  }
}

/**
 * Clears the entire cart for a user.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 */
export async function clearCart(identifier: string): Promise<void> {
  const cartKey = getUserCartKey(identifier);
  try {
    await redisClient.del(cartKey);
    console.log(`Cart cleared for identifier ${identifier}`);
  } catch (error) {
    console.error(`Error clearing cart for identifier ${identifier}:`, error);
    throw error;
  }
}

/**
 * Updates the quantity of a product in the user's cart.
 * If quantity is 0 or less, the item is removed.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @param productId The ID of the product to update.
 * @param quantity The new quantity.
 */
export async function updateCartItemQuantity(identifier: string, productId: string, quantity: number): Promise<void> {
  const cartKey = getUserCartKey(identifier);
  const itemKey = productId;

  if (quantity <= 0) {
    const deletedCount = await redisClient.hdel(cartKey, itemKey);
    // if the cart still exists after deletion, reset the TTL
    if(deletedCount > 0 && await redisClient.exists(cartKey)) {
      await setCartTTL(identifier);
    }
    console.log(`Product ${productId} removed from cart for identifier ${identifier}`);
    return;
  }

  try {
    const itemString = await redisClient.hget(cartKey, itemKey);
    if (itemString) {
      const item: CartItem = JSON.parse(itemString);
      item.quantity = quantity;
      await redisClient.hset(cartKey, itemKey, JSON.stringify(item));
      console.log(`Quantity of product ${productId} updated to ${quantity} for identifier ${identifier}`);
      await setCartTTL(identifier); // Reset TTL whenever the cart is modified
    } else {
      console.warn(`Attempted to update non-existent product ${productId} in cart for identifier ${identifier}`);
    }
  } catch (error) {
    console.error(`Error updating quantity for product ${productId} in cart for identifier ${identifier}:`, error);
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
  const promoKey = `${getUserCartKey(identifier)}:promo`;

  try {
    await redisClient.set(promoKey, promoCode);
    console.log(`Promo code '${promoCode}' applied to cart for identifier ${identifier}`);
    await setCartTTL(identifier); // Reset TTL whenever the cart is modified
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
  const promoKey = `${getUserCartKey(identifier)}:promo`;

  try {
    return await redisClient.get(promoKey);
  } catch (error) {
    console.error(`Error retrieving promo code for identifier ${identifier}:`, error);
    throw error;
  }
}


/**
 * Updates an existing product item in the user's cart in Redis.
 * This function overwrites the entire CartItem object associated with the productId.
 * @param identifier The unique identifier for the cart (session ID or authenticated user ID).
 * @param item The complete CartItem object to update (its productId is used as the key).
 * @returns A promise that resolves when the operation is complete.
 */
export async function updateCartItem(identifier: string, item: CartItem): Promise<void> {
  const cartKey = getUserCartKey(identifier);
  const itemKey = item.productId;
  await redisClient.hset(cartKey, itemKey, JSON.stringify(item));
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

  const productIds = cartItems.map(item => parseInt(item.productId, 10)); // Added radix 10 for safety
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

  for (const item of cartItems) {
    console.log(`6. Processing cart item with productId: "${item.productId}" (type: ${typeof item.productId})`);
    const product: inventory_product | undefined = productMap.get(item.productId);

    if (!product) {
      console.warn(`7. Product "${item.productId}" NOT FOUND or INACTIVE in DB. Removing from cart.`);
      await removeProductFromCart(identifier, item.productId);
      continue; // Skip to next item
    } else {
      console.log(`7. Product "${item.productId}" FOUND in DB.`);
    }

    let updated = false;

    // Ensure product.price is converted to a Number for accurate comparison with item.price (which is number)
    // Remember product.price from Prisma is a Decimal type, so convert to number.
    const dbPrice = Number(product.price);
    if (item.name !== product.name || item.price !== dbPrice) {
      console.log(`8. Item "${item.productId}" needs update: Name changed from "${item.name}" to "${product.name}" or Price changed from ${item.price} to ${dbPrice}`);
      item.name = product.name;
      item.price = dbPrice;
      updated = true;
    }

    if (updated) {
       console.log(`9. Updating item "${item.productId}" in Redis due to data mismatch.`);
       await updateCartItem(identifier, item);
    }

    cleanedCart.push({
      ...item,
      valid: true,
      error: '',
    });
  }

  console.log('10. Cleaned Cart before returning:', JSON.stringify(cleanedCart));
  return cleanedCart;
}