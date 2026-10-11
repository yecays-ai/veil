"use client";
import {
  CLEANUP_STEP_LABEL, browserCleanupDeps, cleanupCharacterData, deleteCharacterWithData, previewCharacterDeletion,
  type CleanupReport, type DeletionImpact,
} from "../lib/character-deletion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { findLeftovers, hasLeftovers, reconcileInertReferences, removeLeftovers, type Leftovers } from "../lib/character-leftovers";
import { browserFoundationStorage } from "../lib/foundation-storage";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import { UI_COPY as U } from "../lib/ui-copy";
import { ensureRoutineAfterSave } from "../lib/presence/routine";
import { getRoutineIssue, subscribeRoutineIssue } from "../lib/presence/routine-issue";
import {
  createCharacter,
  saveUser,
  updateCharacter,
} from "../lib/foundation";
import {
  normalizeCharacterInput,
  type CharacterInput,
  type Character,
  type UserProfile,
} from "../lib/foundation-types";
import { useFoundation } from "./foundation-provider";
import { useTheme } from "./theme-provider";
import { ProfileForm } from "./profile-form";
import { Avatar, ProfileView } from "./profile-view";
import { PageShell } from "./page-shell";
import { useBackNavigation } from "./use-back-navigation";
import { PresenceBadge } from "./presence";
import { RootAppHeader } from "./root-app-header";

export function ProfileHub() {
  const { document, ready } = useFoundation();
  return <div className="social-root profile-hub">
    <RootAppHeader title="Profile" />
    {!ready ? <p>{C.common.loading}</p> : <>
      <Link className="profile-hub-identity" href="/profile/details">
        <Avatar avatar={document.user.avatar} name={document.user.name} large />
        <strong>{document.user.name}</strong>
        <span className="profile-presence"><PresenceBadge presence={document.user.presence} />
          {document.user.presence === "dnd" ? "Do Not Disturb" : document.user.presence}</span>
        {document.user.statusMessage && <small>{document.user.statusMessage}</small>}
      </Link>
      <nav className="social-list" aria-label="Profile">
        <Link className="social-row" href="/profile/details">Profile / Personal Details <span aria-hidden="true">›</span></Link>
        <Link className="social-row" href="/profile/settings">Settings <span aria-hidden="true">›</span></Link>
      </nav>
    </>}
  </div>;
}

export function UserProfilePage() {
  const { document, ready, commit } = useFoundation();
  const [editing, setEditing] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  return (
    <PageShell
      title={C.profile.title}
      backHref="/profile"
      backLabel="Back to Profile"
      bodyClassName="foundation-page"
      guardLeave={editing && formDirty}
    >
      {!ready ? (
        <p>{C.common.loading}</p>
      ) : editing ? (
        <>
          <h1>{U.editProfile}</h1>
          <ProfileForm
            initial={document.user}
            kind="user"
            onDirtyChange={setFormDirty}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              await commit((d) => saveUser(d, input as UserProfile));
              setEditing(false);
            }}
          />
        </>
      ) : (
        <ProfileView profile={document.user} kind="user">
          <button onClick={() => setEditing(true)}>{C.common.edit}</button>
        </ProfileView>
      )}
    </PageShell>
  );
}
export function CharactersPage() {
  const { document, ready } = useFoundation();
  const { commit: commitTheme } = useTheme();
  return (
    <PageShell
      title={C.characters.title}
      backHref="/"
      backLabel="Back to Home"
      bodyClassName="foundation-page"
      rightAction={<Link href="/characters/new">{C.characters.new}</Link>}
    >
      <nav>
        <Link href="/universe">{C.characters.universe}</Link>
      </nav>
      {ready && <LeftoverData commitTheme={commitTheme} />}
      {!ready ? (
        <p>{C.common.loading}</p>
      ) : !document.characters.length ? (
        <p className="empty-copy subtle">{C.characters.empty}</p>
      ) : (
        <ul className="character-list">
          {document.characters.map((c) => (
            <li key={c.characterId}>
              <Link
                className="character-link"
                href={`/characters/${c.characterId}`}
              >
                <Avatar avatar={c.avatar} name={c.name} />
                <span className="contact-details">
                  <strong>{c.name}</strong>
                  {c.statusMessage && (
                    <small className="subtle">{c.statusMessage}</small>
                  )}
                </span>
                <span className="subtle" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
export function CharacterPage({ characterId }: { characterId?: string }) {
  return <CharacterEditor key={characterId ?? "new"} characterId={characterId} />;
}

function CharacterEditor({ characterId }: { characterId?: string }) {
  const { document, ready, commit } = useFoundation();
  const { commit: commitTheme } = useTheme();
  const back = useBackNavigation();
  const router = useRouter();
  const [editing, setEditing] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [impact, setImpact] = useState<DeletionImpact | null>(null),
    [unfinished, setUnfinished] = useState<CleanupReport["failed"]>([]);
  const [baseline, setBaseline] = useState<Character | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  // Why the last life-rhythm generation failed, if it did. It arrives after the save, possibly after a new page
  // instance has mounted (a created Character moves to its own page), so it lives outside this component.
  const routineIssue = useSyncExternalStore(subscribeRoutineIssue, () => getRoutineIssue(characterId), () => null);
  const routineNote = routineIssue ? C.characters.routineFailed[routineIssue] : "";
  const character = document.characters.find(
    (c) => c.characterId === characterId,
  );
  const deps = () => browserCleanupDeps(commitTheme);
  async function retryCleanup() {
    setBusy(true);
    setNotice("");
    try {
      const report = await cleanupCharacterData(characterId!, deps());
      setUnfinished(report.failed);
      if (!report.failed.length) router.push("/characters");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : C.profile.saveError);
    } finally {
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <PageShell
        title={C.characters.title}
        backHref="/characters"
        {...back}
        backLabel="Back to Characters"
        bodyClassName="foundation-page"
      >
        {C.common.loading}
      </PageShell>
    );
  if (characterId && !character && !(editing && baseline))
    return (
      <PageShell
        title={C.characters.title}
        backHref="/characters"
        {...back}
        backLabel="Back to Characters"
        bodyClassName="foundation-page"
      >
        {unfinished.length ? <UnfinishedCleanup failed={unfinished} busy={busy} onRetry={() => void retryCleanup()} /> : <p>{C.characters.notFound}</p>}
        {notice && <p role="alert">{notice}</p>}
      </PageShell>
    );
  const isNew = !characterId;
  async function action(operation: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    try {
      await operation();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : C.profile.saveError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageShell
      title={
        isNew
          ? C.characters.create
          : editing
            ? C.characters.edit
            : character!.name
      }
      backHref="/characters"
        {...back}
      backLabel="Back to Characters"
      bodyClassName="foundation-page"
      guardLeave={(isNew || editing) && formDirty}
    >
      {isNew || editing ? (
        <>
          <h1>{isNew ? C.characters.create : C.characters.edit}</h1>
          <ProfileForm
            key={characterId ?? "new"}
            kind="character"
            onDirtyChange={setFormDirty}
            initial={
              baseline ?? character ?? { ...normalizeCharacterInput(null), name: "" }
            }
            saveLabel={isNew ? C.characters.create : C.common.save}
            onCancel={() =>
              isNew ? router.push("/characters") : setEditing(false)
            }
            onSave={async (input) => {
              const saved = await commit((d) =>
                characterId
                  ? updateCharacter(d, characterId, input as CharacterInput, baseline ?? undefined)
                  : createCharacter(d, input as CharacterInput),
              );
              // Drafts a life rhythm in the background when the settings behind it are new or changed; no-op otherwise.
              const savedId = characterId ?? saved.characters.at(-1)?.characterId;
              // Silent on success; a failure is recorded for this Character's page (see `routineNote`).
              if (savedId) void ensureRoutineAfterSave(savedId);
              if (isNew) {
                const created = saved.characters.at(-1);
                if (!created) throw new Error(C.characters.notFound);
                router.push(`/characters/${encodeURIComponent(created.characterId)}`);
              }
              else setEditing(false);
            }}
          />
        </>
      ) : (
        <>
          {routineNote && <p role="status">{routineNote}</p>}
          <ProfileView profile={character!} kind="character">
            <button onClick={() => { setBaseline(structuredClone(character!)); setEditing(true); }}>{C.common.edit}</button>
          </ProfileView>
          <footer className="danger-area">
            {confirmDelete ? (
              <>
                <p>{C.characters.deleteQuestion}</p>
                {impact ? <DeletionImpactList impact={impact} /> : <p>{C.characters.impactLoading}</p>}
                <div className="foundation-actions">
                  <button
                    className="danger-button"
                    disabled={busy || !impact}
                    onClick={() =>
                      void action(async () => {
                        const report = await deleteCharacterWithData({
                          characterId: characterId!, baseline: baseline ?? undefined, commitFoundation: commit, deps: deps(),
                        });
                        if (report.failed.length) setUnfinished(report.failed);
                        else router.push("/characters");
                      })
                    }
                  >
                    {C.characters.confirmDelete}
                  </button>
                  <button onClick={() => setConfirmDelete(false)}>
                    {C.common.cancel}
                  </button>
                </div>
              </>
            ) : (
              <button
                className="text-button danger-button"
                onClick={() => {
                  setBaseline(structuredClone(character!)); setConfirmDelete(true); setImpact(null);
                  void previewCharacterDeletion(document, characterId!, deps()).then(setImpact, (error) => {
                    setConfirmDelete(false);
                    setNotice(error instanceof Error ? error.message : C.profile.saveError);
                  });
                }}
              >
                {U.deleteCharacter}
              </button>
            )}
          </footer>
        </>
      )}
      {notice && <p role="alert">{notice}</p>}
    </PageShell>
  );
}

function DeletionImpactList({ impact }: { impact: DeletionImpact }) {
  const items = [
    impact.conversation && C.characters.impact.conversation(impact.conversation.messages, impact.conversation.hasBackground),
    impact.groups.length && C.characters.impact.groups(impact.groups.map((g) => g.title)),
    impact.contact && C.characters.impact.contact,
    (impact.widgets.layout + impact.widgets.presets) && C.characters.impact.widgets(impact.widgets.layout, impact.widgets.presets),
    impact.bindings && C.characters.impact.bindings,
    impact.relations && C.characters.impact.relations(impact.relations),
  ].filter(Boolean) as string[];
  return <ul aria-label={C.characters.impact.title}>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function UnfinishedCleanup({ failed, busy, onRetry }: { failed: CleanupReport["failed"]; busy: boolean; onRetry: () => void }) {
  return <div role="alert">
    <p>{C.characters.cleanupUnfinished}</p>
    <ul>{failed.map((item) => <li key={item.step}>{CLEANUP_STEP_LABEL[item.step]}: {item.message}</li>)}</ul>
    <button disabled={busy} onClick={onRetry}>{C.characters.retryCleanup}</button>
  </div>;
}

/**
 * Once per visit: clears content-free references to Characters that no longer exist, then offers
 * the user's own leftover conversations and contact records for removal. Nothing user-written is
 * deleted without the explicit confirmation below. Failures are silent: the next visit tries again.
 */
function LeftoverData({ commitTheme }: { commitTheme: Parameters<typeof browserCleanupDeps>[0] }) {
  const [leftovers, setLeftovers] = useState<Leftovers | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    const deps = browserCleanupDeps(commitTheme);
    void (async () => {
      try {
        await reconcileInertReferences(browserFoundationStorage, deps);
        const found = await findLeftovers(browserFoundationStorage, deps);
        if (active && hasLeftovers(found)) setLeftovers(found);
      } catch { /* retried on the next visit */ }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one pass per mount; the ThemeProvider commit is stable for its lifetime
  }, []);
  if (!leftovers) return notice ? <p role="status">{notice}</p> : null;
  const messages = leftovers.conversations.reduce((sum, item) => sum + item.messages, 0);
  return <section className="danger-area" aria-label={C.characters.leftovers.title}>
    <p>{C.characters.leftovers.summary(leftovers.conversations.length, messages, leftovers.contacts.length)}</p>
    <button className="danger-button" disabled={busy} onClick={() => {
      setBusy(true);
      void removeLeftovers(leftovers, browserFoundationStorage, browserCleanupDeps(commitTheme)).then((result) => {
        setLeftovers(null);
        setNotice(result.failed ? C.characters.leftovers.partial(result.failed) : C.characters.leftovers.done);
      }, () => setNotice(C.characters.leftovers.partial(1))).finally(() => setBusy(false));
    }}>{C.characters.leftovers.remove}</button>
    <button disabled={busy} onClick={() => setLeftovers(null)}>{C.characters.leftovers.keep}</button>
  </section>;
}
