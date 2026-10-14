import type { ChatMessage } from "./types";

export type TransferActor = "user" | "assistant";
export type TransferStatus = "pending" | "received" | "declined" | "returned";
export type TransferAction = "receive" | "decline" | "return";
export type VirtualTransfer = {
  amount: number;
  note: string;
  sender: TransferActor;
  recipient: TransferActor;
  status: TransferStatus;
};
export type TransferEvent = { transferId: string; action: TransferAction; actor: TransferActor; amount: number; note: string };

export const TRANSFER_AMOUNT_LIMIT = 1_000_000_000_000;
export const TRANSFER_NOTE_LIMIT = 240;

export function normalizeTransferAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > TRANSFER_AMOUNT_LIMIT)
    throw new Error("Enter an amount greater than 0 and no more than 1,000,000,000,000.");
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeTransferNote(value: unknown): string {
  if (typeof value !== "string") throw new Error("Transfer note must be text.");
  return value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, TRANSFER_NOTE_LIMIT);
}

export function formatTransferAmount(amount: number): string {
  return `¥${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const actorName = (actor: TransferActor, characterName: string) => actor === "user" ? "You" : characterName;
const statusName: Record<TransferStatus, string> = {
  pending: "pending receipt", received: "received", declined: "declined", returned: "returned",
};

export function transferMessageContent(transfer: VirtualTransfer, id: string, characterName: string): string {
  return `[VEIL virtual transfer ${id}] ${actorName(transfer.sender, characterName)} sent ${formatTransferAmount(transfer.amount)} to ` +
    `${actorName(transfer.recipient, characterName)}; status: ${statusName[transfer.status]}; note: ${transfer.note || "No message"}.`;
}

export function transferEventContent(event: TransferEvent, characterName: string): string {
  const action = event.action === "receive" ? "received" : event.action === "decline" ? "declined" : "returned";
  return `[VEIL transfer event for ${event.transferId}] ${actorName(event.actor, characterName)} ${action} ` +
    `${formatTransferAmount(event.amount)}; note: ${event.note || "No message"}.`;
}

export function transferPromptContent(message: ChatMessage, characterName: string): string | null {
  if (message.transfer) return transferMessageContent(message.transfer, message.id, characterName);
  const event = message.transferEvent;
  if (event) return transferEventContent(event, characterName);
  return null;
}

export function transferQuotePreview(message: ChatMessage): string | null {
  if (message.transfer) return `Virtual transfer ${formatTransferAmount(message.transfer.amount)} · ${statusName[message.transfer.status]}`;
  if (message.transferEvent) {
    const action = message.transferEvent.action === "receive" ? "received" : message.transferEvent.action === "decline" ? "declined" : "returned";
    return `Transfer ${action} · ${formatTransferAmount(message.transferEvent.amount)}`;
  }
  return null;
}

export function isTransferActor(value: unknown): value is TransferActor {
  return value === "user" || value === "assistant";
}

export function canApplyTransferAction(transfer: VirtualTransfer, actor: TransferActor, action: TransferAction): boolean {
  if (actor !== transfer.recipient) return false;
  return transfer.status === "pending" ? action === "receive" || action === "decline"
    : transfer.status === "received" && action === "return";
}
