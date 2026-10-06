"use client";
import { useEffect, useState } from "react";
import { bootstrapCurrentProduct } from "../lib/bootstrap";
import { createProductBootstrapController, type ProductBootstrapStatus } from "../lib/product-bootstrap-state";

export function ProductBootstrap() {
  const [status, setStatus] = useState<ProductBootstrapStatus>("initializing");
  const [controller] = useState(() =>
    createProductBootstrapController(bootstrapCurrentProduct, setStatus),
  );
  useEffect(() => {
    controller.mount();
    return () => controller.unmount();
  }, [controller]);
  if (status !== "error") return null;
  return (
    <div className="product-bootstrap-error" role="alert" aria-live="assertive">
      <span>VEIL could not finish startup initialization.</span>
      <button type="button" onClick={() => void controller.retry()}>Retry</button>
    </div>
  );
}
