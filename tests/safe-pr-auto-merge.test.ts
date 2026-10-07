import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/auto-merge.yml", "utf8");
const scriptMarker = "          script: |\n";
const scriptStart = workflow.indexOf(scriptMarker);
assert.notEqual(scriptStart, -1, "auto-merge workflow script is present");
const scriptLines = workflow.slice(scriptStart + scriptMarker.length).split(/\r?\n/);
const script: string[] = [];
for (const line of scriptLines) {
  if (line.trim() && !line.startsWith("            ")) break;
  script.push(line.trim() ? line.slice(12) : "");
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) =>
  (...args: unknown[]) => Promise<void>;
const executeWorkflow = new AsyncFunction("github", "context", script.join("\n"));

const headSha = "head-sha";
const pull = {
  number: 24,
  state: "open",
  base: { ref: "main" },
  draft: false,
  head: { sha: headSha, repo: { full_name: "yecays-ai/veil", id: 1403122809 } },
  labels: [{ name: "automerge" }],
};

interface MockOptions {
  ciConclusion?: string;
  codeRabbitState?: string;
  unresolvedThreads?: boolean;
  reviewState?: string;
  reviewHeadSha?: string;
  humanReviewState?: string;
  label?: boolean;
}

function mockGitHub(options: MockOptions = {}) {
  const merges: number[] = [];
  const currentPull = {
    ...pull,
    labels: options.label === false ? [] : pull.labels,
  };
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: currentPull }),
        list: async () => ({ data: [currentPull] }),
        listReviews: async () => ({ data: [
          {
            user: { login: "coderabbitai[bot]" },
            commit_id: options.reviewHeadSha ?? headSha,
            state: options.reviewState ?? "COMMENTED",
            submitted_at: "2026-10-07T10:00:00Z",
          },
          ...(options.humanReviewState ? [{
            user: { login: "reviewer" },
            commit_id: headSha,
            state: options.humanReviewState,
            submitted_at: "2026-10-07T10:00:00Z",
          }] : []),
        ] }),
        merge: async ({ pull_number }: { pull_number: number }) => { merges.push(pull_number); },
      },
      actions: {
        listWorkflowRuns: async () => ({ data: { workflow_runs: [{
          conclusion: options.ciConclusion ?? "success",
          created_at: "2026-10-07T10:00:00Z",
          pull_requests: [{ number: pull.number, head: { sha: headSha } }],
        }] } }),
      },
      repos: {
        listCommitStatusesForRef: async () => ({ data: options.codeRabbitState ? [{
          context: "CodeRabbit",
          state: options.codeRabbitState,
          created_at: "2026-10-07T10:00:00Z",
        }] : [] }),
        listPullRequestsAssociatedWithCommit: async () => ({ data: [currentPull] }),
      },
    },
    paginate: async (endpoint: unknown) => endpoint === github.rest.pulls.list
      ? [currentPull]
      : (await github.rest.pulls.listReviews()).data,
    graphql: async () => ({ repository: { pullRequest: { reviewThreads: {
      nodes: [{ isResolved: !options.unresolvedThreads }],
      pageInfo: { hasNextPage: false, endCursor: null },
    } } } }),
  };
  return { github, merges };
}

function context(eventName: string, payload: Record<string, unknown>) {
  return { eventName, payload, repo: { owner: "yecays-ai", repo: "veil" } };
}

async function run(eventName: string, payload: Record<string, unknown>, options: MockOptions = {}) {
  const { github, merges } = mockGitHub(options);
  await executeWorkflow(github, context(eventName, payload));
  return merges;
}

test("auto-merge stays label gated and has scheduled review-resolution rechecks", async () => {
  assert.match(workflow, /issues:\s*\n\s+types:\s*\[labeled\]/);
  assert.match(workflow, /status:\s*\n/);
  assert.match(workflow, /schedule:\s*\n\s+- cron:\s*"\*\/5 \* \* \* \*"/);
  assert.doesNotMatch(workflow, /^\s{2}pull_request_review_thread:/m);
  assert.doesNotMatch(workflow, /^\s{2}workflow_run:/m);

  const ciOnly = await run("schedule", {}, { codeRabbitState: undefined });
  assert.deepEqual(ciOnly, [], "CI alone must never merge before CodeRabbit completes");

  const unlabeled = await run("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }, { codeRabbitState: "success", label: false });
  assert.deepEqual(unlabeled, [], "the explicit automerge label remains required");
});

test("a completed review with unresolved findings cannot auto-merge", async () => {
  const merges = await run("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }, { codeRabbitState: "success", unresolvedThreads: true });
  assert.deepEqual(merges, []);
});

test("a successful CodeRabbit status without a current-head review cannot auto-merge", async () => {
  const { github, merges } = mockGitHub({ codeRabbitState: "success" });
  github.rest.pulls.listReviews = async () => ({ data: [] });
  await executeWorkflow(github, context("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }));
  assert.deepEqual(merges, []);
});

test("a CodeRabbit review for an older head cannot authorize auto-merge", async () => {
  const merges = await run("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }, { codeRabbitState: "success", reviewHeadSha: "older-head" });
  assert.deepEqual(merges, []);
});

test("a changes-requested review blocks auto-merge even when its threads are resolved", async () => {
  const merges = await run("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }, { codeRabbitState: "success", reviewState: "CHANGES_REQUESTED" });
  assert.deepEqual(merges, []);

  const humanRequest = await run("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }, { codeRabbitState: "success", humanReviewState: "CHANGES_REQUESTED" });
  assert.deepEqual(humanRequest, []);
});

test("clean CodeRabbit review and resolved threads still require successful CI", async () => {
  const ciFailure = await run("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }, { codeRabbitState: "success", ciConclusion: "failure" });
  assert.deepEqual(ciFailure, []);

  const merges = await run("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }, { codeRabbitState: "success" });
  assert.deepEqual(merges, [pull.number]);
});

test("scheduled recheck waits until review findings are resolved", async () => {
  const unresolved = await run("schedule", {}, {
    codeRabbitState: "success",
    unresolvedThreads: true,
  });
  assert.deepEqual(unresolved, []);

  const merges = await run("schedule", {}, { codeRabbitState: "success" });
  assert.deepEqual(merges, [pull.number]);
});

