// src/routes/cartRoutes.ts
import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import {
  addProductToCart,
  getCart,
  removeProductFromCart,
  clearCart,
  updateCartItemQuantity,
  applyPromoCodeToCart,
  validateAndSanitizeCart
} from "../lib/cartRedis";

const router = Router();

// Middleware to set the cart identifier (user's ID or session ID) for the session - will be ultimately be used as cart:{user-id}
const setCartIdentifier: RequestHandler = (req, res, next) => {
  if (!req.session || !req.sessionID) {
    res
      .status(500)
      .json({ message: "Session ID not available. Cannot identify cart." });
    return;
  }

  if (!req.session.userId) {
    req.session.isGuest = true;
  }

  req.cartIdentifier = req.session.userId || req.sessionID;
  next();
};

router.use(setCartIdentifier);

router.post("/add", (async (req: Request, res: Response) => {
  const { productId: productIdFromRequestBody, name, price, quantity } = req.body;
  const cartIdentifier = req.cartIdentifier;

  const productId: string = String(productIdFromRequestBody);

  if (
    !productId ||
    !name ||
    typeof price !== "number" ||
    typeof quantity !== "number" ||
    quantity <= 0
  ) {
    return res
      .status(400)
      .json({ message: "Invalid product data or quantity." });
  }

  try {
    await addProductToCart(cartIdentifier, {
      productId,
      name,
      price,
      quantity,
    });
    res.status(200).json({ message: "Product added to cart successfully!" });
  } catch (error) {
    console.error("Error in /cart/add endpoint:", error);
    res.status(500).json({ message: "Failed to add product to cart." });
  }
}) as RequestHandler);

router.get("/view", (async (req: Request, res: Response) => {
  const cartIdentifier = req.cartIdentifier;

  try {
    const cartItems = await getCart(cartIdentifier);
    res.status(200).json({ cart: cartItems });
  } catch (error) {
    console.error("Error fetching cart contents:", error);
    res.status(500).json({ message: "Failed to retrieve cart." });
  }
}) as RequestHandler);

// Assumes `setCartIdentifier` middleware is used before this route
router.delete("/item/:productId", (async (req: Request, res: Response) => {
  const { productId } = req.params;
  const cartIdentifier = req.cartIdentifier;

  if (!productId) {
    return res.status(400).json({ message: "Product ID is required." });
  }

  try {
    await removeProductFromCart(cartIdentifier, productId);
    res
      .status(200)
      .json({ message: `Product ${productId} removed from cart.` });
  } catch (error) {
    console.error(`Error removing product from cart:`, error);
    res.status(500).json({ message: "Failed to remove product from cart." });
  }
}) as RequestHandler);

router.delete("/clear", (async (req: Request, res: Response) => {
  const cartIdentifier = req.cartIdentifier;

  try {
    await clearCart(cartIdentifier);
    res.status(200).json({ message: "Cart cleared successfully." });
  } catch (error) {
    console.error(
      `Error clearing cart for identifier ${cartIdentifier}:`,
      error
    );
    res.status(500).json({ message: "Failed to clear cart." });
  }
}) as RequestHandler);

router.post("/update-quantity", (async (req: Request, res: Response) => {
  const { productId, quantity } = req.body;
  const cartIdentifier = req.cartIdentifier;

  if (!productId || typeof quantity !== "number" || quantity < 0) {
    return res.status(400).json({ message: "Invalid productId or quantity." });
  }

  try {
    await updateCartItemQuantity(cartIdentifier, productId, quantity);
    res
      .status(200)
      .json({ message: "Cart item quantity updated successfully." });
  } catch (error) {
    console.error("Error in /cart/update-quantity endpoint:", error);
    res.status(500).json({ message: "Failed to update cart item quantity." });
  }
}) as RequestHandler);

router.post("/apply-promo", (async (req: Request, res: Response) => {
  const { promoCode } = req.body;
  const cartIdentifier = req.cartIdentifier;

  if (!promoCode || typeof promoCode !== "string") {
    return res.status(400).json({ message: "Invalid promo code." });
  }

  try {
    await applyPromoCodeToCart(cartIdentifier, promoCode);
    res
      .status(200)
      .json({ message: `Promo code '${promoCode}' applied successfully.` });
  } catch (error) {
    console.error("Error applying promo code:", error);
    res.status(500).json({ message: "Failed to apply promo code." });
  }
}) as RequestHandler);

router.post("/validate", async (req: Request, res: Response) => {
  const identifier = req.cartIdentifier;

  try {
    const cleanedCart = await validateAndSanitizeCart(identifier);
    res.status(200).json(cleanedCart);
  } catch (error) {
    console.error("Error validating cart:", error);
    res.status(500).json({ message: "Failed to validate cart." });
  }
});

export default router;
