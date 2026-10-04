import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

// Scoped adaptations of the reference Input and Select primitives.
export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`settings-input ${className}`} {...props} />;
}
export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`settings-input ${className}`} {...props} />;
}
