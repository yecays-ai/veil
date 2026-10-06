"use client";
import { useEffect } from "react";
import { bootstrapCurrentProduct } from "../lib/bootstrap";

export function ProductBootstrap() {
  useEffect(() => { void bootstrapCurrentProduct().catch(() => {}); }, []);
  return null;
}
