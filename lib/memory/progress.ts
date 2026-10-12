import type { BackupLockManager, BackupLockOptions } from "../backup/coordination";
import type { PersistenceWriteScope } from "../backup/persistence-write-gate";
import type { ChatMessage, ChatSession } from "../chat/types";
import { memoryFingerprint } from "./fingerprint";
import { memoryMessageEligible } from "./sequence";
import { finishMemoryRange, validMemoryProgress, type MemoryBatch, type MemoryProgress } from "./progress-types";
import { cursorId, MemoryConflictError, MemoryProtectedError, normalizeSources, request, type MemoryStorage, type MemoryTx } from "./storage";
import type { Memory, MemoryCursor, MemoryDraft, Suppression } from "./types";

export type MemorySourceAuthority = {
  /** Raw saved Foundation authority; null/malformed/deleted Character must fail closed. */
  readFoundation(scope: PersistenceWriteScope): Promise<string | null>;
  readChat(sessionId: string, scope: PersistenceWriteScope): Promise<{ session?: ChatSession; messages: ChatMessage[] }>;
};
declare const ownerBrand: unique symbol, ticketBrand: unique symbol;
export type MemoryOwner = { readonly [ownerBrand]: true };
export type MemoryBatchTicket = { readonly [ticketBrand]: true };
type OwnerState = { characterId: string; id: string; active: boolean; closing: boolean; pending: Set<Promise<unknown>> };
type TicketState = { owner: MemoryOwner; sessionId: string; epoch: string; incarnation: string; batchId: string; attemptId?: string; completed?: boolean };
const digest = async (value: unknown): Promise<string> => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const sourceDigest = (message: ChatMessage) => digest({ id: message.id, sessionId: message.sessionId, role: message.role,
  content: message.content, status: message.status, confirmed: message.confirmed, outcome: message.outcome,
  attemptFor: message.attemptFor, turnId: message.turnId, memorySequence: message.memorySequence });
const fail = (): never => { throw new MemoryConflictError(); };

/** Passive M5a protocol. No production instance, scheduler, provider or automatic recovery is installed. */
export class MemoryProgressProtocol {
  private owners = new WeakMap<MemoryOwner, OwnerState>();
  private tickets = new WeakMap<MemoryBatchTicket, TicketState>();
  constructor(private memory: MemoryStorage, private source: MemorySourceAuthority, private locks: BackupLockManager | undefined) {}

  /** Approved Character maintenance ownership is outside the short backup lease; never upgraded from shared. */
  async withOwner<T>(characterId: string, work: (owner: MemoryOwner) => Promise<T>): Promise<T | undefined> {
    if (!this.locks) throw new Error("Memory maintenance coordination unavailable.");
    return this.locks.request(`veil-memory:${characterId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) return undefined;
      const owner = Object.freeze({}) as MemoryOwner, state: OwnerState = { characterId, id: crypto.randomUUID(), active: true, closing: false, pending: new Set() };
      this.owners.set(owner, state);
      try { return await work(owner); } finally {
        state.closing = true;
        await Promise.allSettled(state.pending);
        state.active = false;
      }
    });
  }
  private owner(owner: MemoryOwner): OwnerState {
    const state = this.owners.get(owner);
    if (!state?.active) return fail();
    return state;
  }
  private ticket(ticket: MemoryBatchTicket): TicketState {
    const state = this.tickets.get(ticket);
    if (!state) return fail();
    this.owner(state.owner);
    return state;
  }
  private exclusive<T>(owner: MemoryOwner, work: (scope: PersistenceWriteScope) => Promise<T>, options?: BackupLockOptions): Promise<T> {
    const state = this.owner(owner);
    if (state.closing) return fail();
    const operation = this.memory.withExclusive(work, options);
    state.pending.add(operation);
    void operation.then(() => state.pending.delete(operation), () => state.pending.delete(operation));
    return operation;
  }
  private async authority(owner: MemoryOwner, sessionId: string, scope: PersistenceWriteScope) {
    this.memory.assertExclusive(scope);
    const { characterId } = this.owner(owner), raw = await this.source.readFoundation(scope);
    if (!raw) return fail();
    const foundation: unknown = JSON.parse(raw);
    if (!foundation || typeof foundation !== "object" || !("version" in foundation) || foundation.version !== 1
      || !("characters" in foundation) || !Array.isArray(foundation.characters)
      || foundation.characters.some((row: unknown) => !row || typeof row !== "object" || !("characterId" in row) || typeof row.characterId !== "string" || !row.characterId)
      || !foundation.characters.some((row: unknown) => !!row && typeof row === "object" && "characterId" in row && row.characterId === characterId)) return fail();
    const chat = await this.source.readChat(sessionId, scope);
    if (!chat.session || chat.session.id !== sessionId || chat.session.characterId !== characterId || chat.session.type === "group"
      || chat.session.generation || !chat.session.memorySequence) return fail();
    const { epoch, nextSeq } = chat.session.memorySequence;
    if (!epoch || !Number.isSafeInteger(nextSeq) || nextSeq < 1) return fail();
    const seqs = new Set<number>();
    for (const message of chat.messages) if (message.memorySequence?.seq !== undefined) {
      const seq = message.memorySequence.seq;
      if (message.sessionId !== sessionId || message.memorySequence.epoch !== epoch || !Number.isSafeInteger(seq)
        || seq < 1 || seq >= nextSeq || seqs.has(seq) || !memoryMessageEligible(message)) return fail();
      seqs.add(seq);
    }
    this.owner(owner);
    return { ...chat, epoch, nextSeq };
  }
  private async cursor(tx: MemoryTx, characterId: string, state: TicketState): Promise<MemoryCursor> {
    const row = await request<MemoryCursor | undefined>(tx.store("cursors").get(cursorId(characterId, state.sessionId)));
    if (!row?.extraction || row.clearRequestedAt !== undefined || !validMemoryProgress(row.extraction)
      || row.extraction.epoch !== state.epoch || row.extraction.incarnation !== state.incarnation) return fail();
    return row;
  }
  private async capture(owner: MemoryOwner, chat: Awaited<ReturnType<MemoryProgressProtocol["authority"]>>,
    fromSeq: number, toSeq: number, candidateIds: readonly string[], scope: PersistenceWriteScope) {
    const messages = chat.messages.filter((message) => message.memorySequence?.seq !== undefined
      && message.memorySequence.seq >= fromSeq && message.memorySequence.seq <= toSeq).sort((a, b) => a.memorySequence!.seq! - b.memorySequence!.seq!);
    const sources = await Promise.all(messages.map(async (message) => ({ messageId: message.id, seq: message.memorySequence!.seq!, hash: await sourceDigest(message) })));
    const rows = await this.memory.listMemories(this.owner(owner).characterId, scope);
    if (new Set(candidateIds).size !== candidateIds.length) return fail();
    const candidates = await Promise.all(candidateIds.map(async (id) => {
      const row = rows.find((row) => row.id === id);
      if (!row || row.origin === "manual") throw new MemoryProtectedError(id);
      return { id, updatedAt: row.updatedAt, hash: await digest(row) };
    }));
    return { sources, candidates };
  }

  /** Evidence snapshots contain hashes and IDs only. Missing seqs remain genuine deleted-message holes. */
  async prepare(owner: MemoryOwner, sessionId: string, fromSeq: number, toSeq: number,
    candidateIds: readonly string[] = [], tooLarge = false): Promise<MemoryBatchTicket> {
    return this.exclusive(owner, async (scope) => {
      const { characterId } = this.owner(owner), chat = await this.authority(owner, sessionId, scope);
      if (!Number.isSafeInteger(fromSeq) || !Number.isSafeInteger(toSeq) || fromSeq < 1 || toSeq < fromSeq || toSeq >= chat.nextSeq) return fail();
      const { sources, candidates } = await this.capture(owner, chat, fromSeq, toSeq, candidateIds, scope);
      const batch: MemoryBatch = { id: crypto.randomUUID(), fromSeq, toSeq, state: tooLarge ? "too-large" : "ready", attempts: 0, sources, candidates };
      const state = await this.memory.transaction("readwrite", async (tx) => {
        const store = tx.store("cursors"), id = cursorId(characterId, sessionId);
        const previous = await request<MemoryCursor | undefined>(store.get(id));
        if (previous?.clearRequestedAt !== undefined) return fail();
        if (previous?.extraction && (!validMemoryProgress(previous.extraction) || previous.extraction.epoch !== chat.epoch)) return fail();
        const progress: MemoryProgress = previous?.extraction ?? { epoch: chat.epoch, incarnation: crypto.randomUUID(), throughSeq: 0, completed: [], batches: [] };
        if (fromSeq <= progress.throughSeq || [...progress.completed, ...progress.batches.map((b) => [b.fromSeq, b.toSeq])]
          .some(([from, to]) => fromSeq <= to && toSeq >= from)) return fail();
        progress.batches.push(batch);
        await request(store.put({ failureCount: 0, ...previous, id, characterId, sessionId, extraction: progress, updatedAt: this.memory.now() } satisfies MemoryCursor));
        return { owner, sessionId, epoch: chat.epoch, incarnation: progress.incarnation, batchId: batch.id };
      }, scope);
      const ticket = Object.freeze({}) as MemoryBatchTicket; this.tickets.set(ticket, state); return ticket;
    });
  }

  /** Re-snapshot edited/deleted evidence only before dispatch or after a proven failure. Retry counts survive. */
  async refresh(ticket: MemoryBatchTicket, candidateIds?: readonly string[], tooLarge?: boolean): Promise<MemoryBatchTicket> {
    const state = this.ticket(ticket);
    return this.exclusive(state.owner, async (scope) => {
      const { characterId } = this.owner(state.owner), chat = await this.authority(state.owner, state.sessionId, scope);
      const row = await this.memory.transaction("readonly", (tx) => this.cursor(tx, characterId, state), scope);
      const batch = row.extraction!.batches.find((b) => b.id === state.batchId);
      if (!batch || !["ready", "failed", "too-large"].includes(batch.state) || chat.epoch !== state.epoch || batch.toSeq >= chat.nextSeq) return fail();
      const captured = await this.capture(state.owner, chat, batch.fromSeq, batch.toSeq, candidateIds ?? batch.candidates.map((c) => c.id), scope);
      const next: MemoryBatch = { id: crypto.randomUUID(), fromSeq: batch.fromSeq, toSeq: batch.toSeq, attempts: batch.attempts,
        state: (tooLarge ?? batch.state === "too-large") ? "too-large" : "ready", ...captured };
      await this.memory.transaction("readwrite", async (tx) => {
        const current = await this.cursor(tx, characterId, state), index = current.extraction!.batches.findIndex((b) => b.id === batch.id);
        if (index < 0 || current.extraction!.batches[index].state !== batch.state) return fail();
        current.extraction!.batches[index] = next;
        await request(tx.store("cursors").put({ ...current, updatedAt: this.memory.now() }));
      }, scope);
      const fresh = Object.freeze({}) as MemoryBatchTicket;
      this.tickets.set(fresh, { owner: state.owner, sessionId: state.sessionId, epoch: state.epoch, incarnation: state.incarnation, batchId: next.id });
      return fresh;
    });
  }

  /** A new owner may resume only never-dispatched work; unknown results are retained, never resent. */
  async recover(owner: MemoryOwner, sessionId: string): Promise<MemoryBatchTicket[]> {
    return this.exclusive(owner, async (scope) => {
      const { characterId } = this.owner(owner), chat = await this.authority(owner, sessionId, scope);
      const states = await this.memory.transaction("readwrite", async (tx) => {
        const store = tx.store("cursors"), row = await request<MemoryCursor | undefined>(store.get(cursorId(characterId, sessionId)));
        if (!row?.extraction || row.clearRequestedAt !== undefined || !validMemoryProgress(row.extraction) || row.extraction.epoch !== chat.epoch) return [];
        for (const batch of row.extraction.batches) {
          if (batch.ownerId === this.owner(owner).id) continue;
          if (batch.state === "claimed") { batch.state = "ready"; delete batch.ownerId; delete batch.attemptId; }
          else if (batch.state === "in-flight" || batch.state === "commit-pending") { batch.state = "uncertain"; batch.errorCode = "owner-lost"; }
        }
        await request(store.put({ ...row, updatedAt: this.memory.now() }));
        return row.extraction.batches.filter((batch) => batch.state === "ready" || batch.state === "failed").map((batch) => ({ owner, sessionId,
          epoch: row.extraction!.epoch, incarnation: row.extraction!.incarnation, batchId: batch.id }));
      }, scope);
      return states.map((state) => { const ticket = Object.freeze({}) as MemoryBatchTicket; this.tickets.set(ticket, state); return ticket; });
    });
  }

  private async evidence(owner: MemoryOwner, state: TicketState, batch: MemoryBatch, scope: PersistenceWriteScope): Promise<Memory[]> {
    const chat = await this.authority(owner, state.sessionId, scope);
    if (chat.epoch !== state.epoch || chat.nextSeq <= batch.toSeq) return fail();
    const current = chat.messages.filter((m) => m.memorySequence?.seq !== undefined && m.memorySequence.seq >= batch.fromSeq && m.memorySequence.seq <= batch.toSeq);
    if (current.length !== batch.sources.length) return fail();
    for (const saved of batch.sources) {
      const message = current.find((m) => m.id === saved.messageId && m.memorySequence!.seq === saved.seq);
      if (!message || await sourceDigest(message) !== saved.hash) return fail();
    }
    const memories = await this.memory.listMemories(this.owner(owner).characterId, scope);
    const chats = new Map([[state.sessionId, chat]]);
    for (const candidate of batch.candidates) {
      const row = memories.find((m) => m.id === candidate.id);
      if (!row || row.origin === "manual" || row.updatedAt !== candidate.updatedAt || await digest(row) !== candidate.hash) return fail();
      for (const source of row.sources) {
        let origin = chats.get(source.sessionId);
        if (!origin) {
          const view = await this.source.readChat(source.sessionId, scope);
          origin = { ...view, epoch: "", nextSeq: 0 }; chats.set(source.sessionId, origin);
        }
        const session = origin.session, characterId = this.owner(owner).characterId;
        if (!session || (session.type === "group" ? !session.participantIds?.includes(characterId) : session.characterId !== characterId)
          || !origin.messages.some((message) => message.id === source.messageId && message.sessionId === source.sessionId)) return fail();
      }
    }
    return memories;
  }

  async claim(ticket: MemoryBatchTicket, maxAttempts: number): Promise<void> {
    const state = this.ticket(ticket);
    // One capability belongs to one attempt forever. Recovery issues a fresh capability for a known retry.
    if (state.attemptId || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) return fail();
    await this.exclusive(state.owner, async (scope) => {
      const { characterId, id } = this.owner(state.owner);
      const row = await this.memory.transaction("readonly", (tx) => this.cursor(tx, characterId, state), scope);
      const batch = row.extraction!.batches.find((b) => b.id === state.batchId);
      if (!batch || !["ready", "failed"].includes(batch.state) || batch.attempts >= maxAttempts) return fail();
      await this.evidence(state.owner, state, batch, scope);
      const attemptId = crypto.randomUUID();
      await this.memory.transaction("readwrite", async (tx) => {
        const current = await this.cursor(tx, characterId, state), target = current.extraction!.batches.find((b) => b.id === batch.id);
        if (!target || target.state !== batch.state || target.attempts !== batch.attempts) return fail();
        Object.assign(target, { state: "claimed", ownerId: id, attemptId, attempts: target.attempts + 1 }); delete target.errorCode;
        await request(tx.store("cursors").put({ ...current, updatedAt: this.memory.now() }));
      }, scope);
      state.attemptId = attemptId;
    });
  }

  /** Persist in-flight BEFORE provider dispatch; commit-pending BEFORE attempting the result commit. */
  transition(ticket: MemoryBatchTicket, to: "in-flight" | "commit-pending" | "failed" | "uncertain"): Promise<void> {
    const state = this.ticket(ticket), owner = this.owner(state.owner);
    return this.exclusive(state.owner, async (scope) => {
      await this.authority(state.owner, state.sessionId, scope);
      if (to === "in-flight") {
        const current = await this.memory.transaction("readonly", (tx) => this.cursor(tx, owner.characterId, state), scope);
        const target = current.extraction!.batches.find((b) => b.id === state.batchId);
        if (!target) return fail();
        await this.evidence(state.owner, state, target, scope);
      }
      await this.memory.transaction("readwrite", async (tx) => {
        this.owner(state.owner);
        const row = await this.cursor(tx, owner.characterId, state), batch = row.extraction!.batches.find((b) => b.id === state.batchId);
        if (!batch || batch.ownerId !== owner.id || batch.attemptId !== state.attemptId || !state.attemptId) return fail();
        const allowed = to === "in-flight" ? batch.state === "claimed" : to === "commit-pending" ? batch.state === "in-flight"
          : to === "failed" ? batch.state === "claimed" || batch.state === "in-flight" : batch.state === "in-flight" || batch.state === "commit-pending";
        if (!allowed) return fail();
        batch.state = to;
        if (to === "failed") batch.errorCode = "known-failed";
        await request(tx.store("cursors").put({ ...row, updatedAt: this.memory.now() }));
      }, scope);
    });
  }

  /** Return the verified input snapshot under the same ticket authority. Never call a provider in this lease. */
  async readInput(ticket: MemoryBatchTicket) {
    const state = this.ticket(ticket);
    return this.exclusive(state.owner, async (scope) => {
      const { characterId } = this.owner(state.owner);
      const cursor = await this.memory.transaction("readonly", (tx) => this.cursor(tx, characterId, state), scope);
      const batch = cursor.extraction!.batches.find((b) => b.id === state.batchId);
      if (!batch || !["ready", "failed", "claimed"].includes(batch.state)) return fail();
      const memories = await this.evidence(state.owner, state, batch, scope);
      const chat = await this.authority(state.owner, state.sessionId, scope);
      return { characterId, sessionId: state.sessionId,
        messages: chat.messages.filter((m) => batch.sources.some((s) => s.messageId === m.id))
          .sort((a, b) => a.memorySequence!.seq! - b.memorySequence!.seq!),
        candidates: memories.filter((m) => batch.candidates.some((c) => c.id === m.id)),
        manual: memories.filter((m) => m.origin === "manual"),
        suppressions: await this.memory.listSuppressions(characterId, scope) };
    });
  }

  /** Only genuine deleted-message holes may finish without dispatch. Not a general IGNORE shortcut. */
  async completeEmpty(ticket: MemoryBatchTicket): Promise<void> {
    const state = this.ticket(ticket);
    return this.exclusive(state.owner, async (scope) => {
      const { characterId } = this.owner(state.owner);
      const cursor = await this.memory.transaction("readonly", (tx) => this.cursor(tx, characterId, state), scope);
      if (state.completed) return;
      const batch = cursor.extraction!.batches.find((b) => b.id === state.batchId);
      if (!batch || batch.state !== "ready" || batch.attempts !== 0 || batch.sources.length || batch.candidates.length) return fail();
      await this.evidence(state.owner, state, batch, scope);
      await this.memory.transaction("readwrite", async (tx) => {
        const current = await this.cursor(tx, characterId, state);
        const target = current.extraction!.batches.find((b) => b.id === batch.id);
        if (!target || target.state !== "ready" || target.attempts || target.sources.length || target.candidates.length) return fail();
        finishMemoryRange(current.extraction!, target);
        await request(tx.store("cursors").put({ ...current, updatedAt: this.memory.now() }));
      }, scope);
      state.completed = true;
    });
  }

  /** Unique automatic write route: no removals, suppression writes or user undo records. */
  async commitAutomatic(ticket: MemoryBatchTicket, change: { put: readonly MemoryDraft[] }, signal?: AbortSignal): Promise<"committed" | "already-committed"> {
    const state = this.ticket(ticket);
    if (Object.keys(change).some((key) => key !== "put") || !Array.isArray(change.put)) return fail();
    return this.exclusive(state.owner, async (scope) => {
      signal?.throwIfAborted();
      const { characterId, id } = this.owner(state.owner);
      const row = await this.memory.transaction("readonly", (tx) => this.cursor(tx, characterId, state), scope);
      if (state.completed) return "already-committed";
      const batch = row.extraction!.batches.find((b) => b.id === state.batchId);
      if (!batch || batch.state !== "commit-pending" || batch.ownerId !== id || batch.attemptId !== state.attemptId || !state.attemptId) return fail();
      await this.evidence(state.owner, state, batch, scope);
      signal?.throwIfAborted();
      await this.memory.transaction("readwrite", async (tx) => {
        this.owner(state.owner);
        signal?.throwIfAborted();
        const current = await this.cursor(tx, characterId, state), target = current.extraction!.batches.find((b) => b.id === batch.id);
        if (!target || target.state !== "commit-pending" || target.ownerId !== id || target.attemptId !== state.attemptId) return fail();
        await applyAutomaticPlan(tx, characterId, state.sessionId, target, change.put, this.memory.now());
        signal?.throwIfAborted();
        finishMemoryRange(current.extraction!, target);
        await request(tx.store("cursors").put({ ...current, updatedAt: this.memory.now() }));
      }, scope, signal);
      state.completed = true;
      return "committed";
    }, { signal });
  }
}

async function applyAutomaticPlan(tx: MemoryTx, characterId: string, sessionId: string, batch: MemoryBatch, drafts: readonly MemoryDraft[], now: number): Promise<void> {
  const store = tx.store("memories"), existing = await request<Memory[]>(store.index("characterId").getAll(characterId));
  const suppressions = await request<Suppression[]>(tx.store("suppressions").index("characterId").getAll(characterId));
  const rows = new Map(existing.map((row) => [row.id, row])), plan = new Map<string, Memory>();
  const candidates = new Map(batch.candidates.map((row) => [row.id, row]));
  const sourceKeys = new Set(batch.sources.map((s) => `${s.messageId}`));
  const allowedSource = new Set(existing.filter((row) => candidates.has(row.id)).flatMap((row) => row.sources.map((s) => `${s.sessionId}\0${s.messageId}`)));
  for (const draft of drafts) {
    if (Object.keys(draft).some((key) => !["id", "characterId", "kind", "text", "subject", "status", "origin", "sources", "lineage"].includes(key))
      || !draft.id || draft.characterId !== characterId || draft.origin !== "auto" || plan.has(draft.id)
      || !["fact", "event", "ongoing", "relationship", "continuity"].includes(draft.kind) || !["character", "user", "other"].includes(draft.subject)
      || !["active", "flagged", "archived", "superseded"].includes(draft.status) || !draft.lineage
      || Object.keys(draft.lineage).some((key) => !["mergedFrom", "supersededBy"].includes(key))) return fail();
    if (draft.lineage.mergedFrom !== undefined && (!Array.isArray(draft.lineage.mergedFrom)
      || new Set(draft.lineage.mergedFrom).size !== draft.lineage.mergedFrom.length || draft.lineage.mergedFrom.includes(draft.id))) return fail();
    if (draft.lineage.supersededBy !== undefined && (typeof draft.lineage.supersededBy !== "string" || !draft.lineage.supersededBy
      || draft.lineage.supersededBy === draft.id)) return fail();
    const before = await request<Memory | undefined>(store.get(draft.id));
    if (before?.origin === "manual") throw new MemoryProtectedError(draft.id);
    if (before && (before.characterId !== characterId || !candidates.has(before.id) || before.updatedAt !== candidates.get(before.id)!.updatedAt)) return fail();
    const sources = normalizeSources(draft.sources), fingerprint = memoryFingerprint(draft.text);
    // Session comes from the validated ticket/cursor, not a caller's invented pointer.
    if (!fingerprint || !sessionId || sources.some((s) => !(s.sessionId === sessionId && sourceKeys.has(s.messageId)) && !allowedSource.has(`${s.sessionId}\0${s.messageId}`))) return fail();
    if (suppressions.some((s) => s.fingerprint === fingerprint || s.sources.some((old) => sources.some((n) => n.sessionId === old.sessionId && n.messageId === old.messageId)))
      || existing.some((r) => r.origin === "manual" && r.fingerprint === fingerprint)) throw new MemoryProtectedError(draft.id);
    if (!before && (!sources.some((s) => s.sessionId === sessionId && sourceKeys.has(s.messageId)) || draft.status === "superseded")) return fail();
    if (before && (draft.text !== before.text || draft.kind !== before.kind || draft.subject !== before.subject
      || before.sources.some((s) => !sources.some((n) => s.sessionId === n.sessionId && s.messageId === n.messageId))
      || JSON.stringify(draft.lineage.mergedFrom) !== JSON.stringify(before.lineage.mergedFrom)
      || (draft.status !== before.status && (before.status === "superseded"
        || !["superseded", "archived", "flagged"].includes(draft.status)))
      || (draft.status === "superseded" && !draft.lineage.supersededBy)
      || (draft.status === before.status && draft.lineage.supersededBy !== before.lineage.supersededBy))) return fail();
    const lineage = { ...draft.lineage };
    if (before?.status === "superseded") lineage.previousStatus = before.lineage.previousStatus;
    else if (before && draft.status === "superseded") lineage.previousStatus = before.status;
    plan.set(draft.id, { ...draft, sources, lineage, fingerprint, createdAt: before?.createdAt ?? now, updatedAt: before ? Math.max(now, before.updatedAt + 1) : now });
  }
  const all = new Map([...rows, ...plan]);
  const permitted = (id: string) => candidates.has(id) || plan.has(id);
  for (const row of plan.values()) {
    if ((row.status === "active" || row.status === "flagged") && [...all.values()].some((r) => r.id !== row.id
      && ["active", "flagged"].includes(r.status) && r.fingerprint === row.fingerprint)) return fail();
    if (row.lineage.supersededBy && (!permitted(row.lineage.supersededBy) || !all.has(row.lineage.supersededBy) || row.status !== "superseded")) return fail();
    for (const id of row.lineage.mergedFrom ?? []) {
      const original = all.get(id);
      if (!permitted(id) || original?.origin !== "auto" || original.lineage.supersededBy !== row.id
        || original.sources.some((s) => !row.sources.some((n) => n.sessionId === s.sessionId && n.messageId === s.messageId))) return fail();
    }
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) return fail();
    if (visited.has(id)) return;
    visiting.add(id);
    const next = all.get(id)?.lineage.supersededBy;
    if (next) visit(next);
    visiting.delete(id); visited.add(id);
  };
  for (const id of plan.keys()) visit(id);
  for (const row of plan.values()) await request(store.put(row));
}
