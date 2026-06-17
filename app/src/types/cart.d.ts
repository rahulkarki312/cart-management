// src/types/cart.d.ts
export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  valid?: boolean;
  error?: string;
}