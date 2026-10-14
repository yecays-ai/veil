"use client";
import { useEffect, useState } from "react";
import { bootstrapCurrentProduct } from "../lib/bootstrap";
import { resumeBrowserClears } from "../lib/memory/browser";
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
  // Once per page load; a failure only means the saved clear intents are tried again at the next start.
  useEffect(() => {
    const controller = new AbortController();
    void resumeBrowserClears(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (status !== "error") return null;
  return (
    <div className="product-bootstrap-error" role="alert" aria-live="assertive">
      <span>VEIL could not finish startup initialization.</span>
      <button type="button" onClick={() => void controller.retry()}>Retry</button>
    </div>
  );
}
