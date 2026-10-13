import { MemoryStorage } from "./storage";

/** Shared lazy handle; importing it never opens a database or enables maintenance. */
export const browserMemoryStorage = new MemoryStorage();
