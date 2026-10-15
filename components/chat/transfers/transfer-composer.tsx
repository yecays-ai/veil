"use client";

import { useState, type FormEvent } from "react";
import { formatTransferAmount, normalizeTransferAmount, TRANSFER_NOTE_LIMIT } from "../../../lib/chat/transfer";

export function TransferComposer({ disabled, onClose, onSend }: { disabled: boolean; onClose: () => void; onSend: (amount: number, note: string) => void }) {
  const [amount, setAmount] = useState(""), [note, setNote] = useState(""), [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    try { onSend(normalizeTransferAmount(Number(amount)), note); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Enter a valid amount."); }
  }
  const preview = Number(amount);
  return <div className="chat-transfer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="chat-transfer-composer" role="dialog" aria-modal="true" aria-labelledby="chat-transfer-title" onSubmit={submit}>
      <h2 id="chat-transfer-title">Virtual transfer</h2>
      <label>Amount<input autoFocus type="number" inputMode="decimal" min="0" max="1000000000000" step="0.01" value={amount}
        onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
      <label>Message<textarea maxLength={TRANSFER_NOTE_LIMIT} rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a message (optional)" /></label>
      <p className="chat-transfer-preview">Preview: {Number.isFinite(preview) ? formatTransferAmount(preview) : "¥0.00"} · Virtual chat gesture</p>
      {error && <p role="alert" className="chat-error">{error}</p>}
      <div className="chat-transfer-composer-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={disabled}>Send transfer</button></div>
    </form>
  </div>;
}
