"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

const CartContext = createContext(null);
const STORAGE_KEY = "sound-coffee-cart";

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Load once on mount — not during SSR, localStorage doesn't exist there.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setItems(JSON.parse(saved));
    } catch {
      // Corrupted or unavailable — just start with an empty cart.
    }
    setLoaded(true);
  }, []);

  // Persist on every change, but only after the initial load — otherwise
  // the empty initial state would overwrite a real saved cart for a
  // split second before it loads.
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // best-effort
    }
  }, [items, loaded]);

  const addItem = useCallback((item, { openDrawer = true } = {}) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.coordinate === item.coordinate);
      if (existing) {
        return prev.map((i) =>
          i.coordinate === item.coordinate ? { ...i, quantity: i.quantity + item.quantity } : i
        );
      }
      return [...prev, item];
    });
    if (openDrawer) setDrawerOpen(true);
  }, []);

  const removeItem = useCallback((coordinate) => {
    setItems((prev) => prev.filter((i) => i.coordinate !== coordinate));
  }, []);

  const updateQuantity = useCallback((coordinate, quantity) => {
    setItems((prev) => {
      if (quantity <= 0) return prev.filter((i) => i.coordinate !== coordinate);
      return prev.map((i) => (i.coordinate === coordinate ? { ...i, quantity } : i));
    });
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        itemCount,
        drawerOpen,
        setDrawerOpen,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
