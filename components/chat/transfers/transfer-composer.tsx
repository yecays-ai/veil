"use client";

import { useState, type FormEvent } from "react";
import { formatTransferAmount, normalizeTransferAmount, TRANSFER_NOTE_LIMIT } from "../../../lib/chat/transfer";

export function TransferComposer({ disabled, onClose, onSend }: { disabled: boolean; onClose: () => void; onSend: (amount: number, note: string) => void }) {
  const [amount, setAmount] = useState(""), [note, setNote] = useState(""), [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    try { onSend(normalizeTransferAmount(Number(amount)), note); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "请输入有效金额"); }
  }
  const preview = Number(amount);
  return <div className="chat-transfer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="chat-transfer-composer" role="dialog" aria-modal="true" aria-labelledby="chat-transfer-title" onSubmit={submit}>
      <h2 id="chat-transfer-title">虚拟转账</h2>
      <label>金额<input autoFocus type="number" inputMode="decimal" min="0" max="1000000000000" step="0.01" value={amount}
        onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
      <label>留言<textarea maxLength={TRANSFER_NOTE_LIMIT} rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="想对对方说的话（可选）" /></label>
      <p className="chat-transfer-preview">预览金额：{Number.isFinite(preview) ? formatTransferAmount(preview) : "¥0.00"} · 仅作聊天互动</p>
      {error && <p role="alert" className="chat-error">{error}</p>}
      <div className="chat-transfer-composer-actions"><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={disabled}>发送转账</button></div>
    </form>
  </div>;
}
