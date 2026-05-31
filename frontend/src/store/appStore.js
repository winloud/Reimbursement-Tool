import { create } from "zustand";

export const useAppStore = create((set) => ({
  health: null,
  healthError: "",
  setHealth: (health) => set({ health, healthError: "" }),
  setHealthError: (healthError) => set({ health: null, healthError }),
}));
