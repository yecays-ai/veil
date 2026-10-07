import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { regressionContract } from "./regression-contract";

const workflow = readFileSync(".github/workflows/auto-merge.yml", "utf8").replace(/\r\n/g, "\n");
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
const workflowBody = script.join("\n");
const executeScript = new AsyncFunction("github", "context", "core", workflowBody);
const executeWorkflow = (github: unknown, context: unknown, warnings: string[] = []) => executeScript(github, context, {
  info: () => {}, warning: (message: string) => warnings.push(message),
});

const headSha = "head-sha";
const mergeSha = "merge-sha";
const baseSha = "base-sha";
const checkoutSha = "056807875f17f19b268906533c4763644290b5ba";
// The API run SHA may be the source head. Only the checkout log + Git parents
// establish what verify actually tested. Preserve this distinction in the fake.
const checkoutLogs = (sha = checkoutSha) => [
  "2026-10-07T11:35:47.5191188Z ##[group]Run actions/checkout@v5",
  "2026-10-07T11:35:48.4323088Z [command]/usr/bin/git log -1 --format=%H",
  `2026-10-07T11:35:48.4348853Z ${sha}`,
  "2026-10-07T11:35:48.4699336Z ##[group]Run actions/setup-node@v5",
  "",
].join("\n");
const pull = {
  number: 24,
  state: "open",
  base: { ref: "main" },
  draft: false,
  merge_commit_sha: mergeSha,
  head: { sha: headSha, repo: { full_name: "yecays-ai/veil", id: 1403122809 } },
  labels: [{ name: "automerge" }],
};

interface WorkflowRun {
  id?: number;
  run_attempt?: number;
  head_sha: string;
  conclusion: string | null;
  created_at: string;
  pull_requests: Array<{ number: number; head: { sha: string } }>;
}

interface MockOptions {
  ciConclusion?: string;
  workflowRuns?: WorkflowRun[];
  codeRabbitState?: string;
  codeRabbitCreator?: string;
  codeRabbitDescription?: string;
  unresolvedThreads?: boolean;
  reviewState?: string;
  reviewHeadSha?: string;
  humanReviewState?: string;
  humanReviewHeadSha?: string;
  label?: boolean;
  draft?: boolean;
  repository?: string;
  mergeSha?: string | null;
}

function mockGitHub(options: MockOptions = {}) {
  const merges: number[] = [];
  const workflowRunRequests: Array<Record<string, unknown>> = [];
  const currentPull = {
    ...pull,
    draft: options.draft ?? false,
    head: { ...pull.head, repo: { ...pull.head.repo, full_name: options.repository ?? pull.head.repo.full_name } },
    merge_commit_sha: options.mergeSha === undefined ? mergeSha : options.mergeSha,
    labels: options.label === false ? [] : pull.labels,
  };
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: structuredClone(currentPull) }),
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
            commit_id: options.humanReviewHeadSha ?? headSha,
            state: options.humanReviewState,
            submitted_at: "2026-10-07T10:00:00Z",
          }] : []),
        ] }),
        merge: async ({ pull_number, sha }: { pull_number: number; sha: string }) => {
          assert.equal(sha, currentPull.head.sha, "merge keeps the final current-head SHA guard");
          merges.push(pull_number);
          return { data: { merged: true, message: "merged" } };
        },
      },
      actions: {
        listJobsForWorkflowRun: async () => ({ data: { jobs: [{
          id: 101, name: "verify", run_attempt: 1, conclusion: "success",
          steps: [
            { name: "Set up job", conclusion: "success" },
            { name: "Run actions/checkout@v5", conclusion: "success" },
            { name: "Run actions/setup-node@v5", conclusion: "success" },
          ],
        }] } }),
        downloadJobLogsForWorkflowRun: async () => ({ data: checkoutLogs() }),
        listWorkflowRuns: async (params: Record<string, unknown>) => {
          workflowRunRequests.push(params);
          const workflowRuns = options.workflowRuns ?? [{
          head_sha: mergeSha,
          conclusion: options.ciConclusion ?? "success",
          created_at: "2026-10-07T10:00:00Z",
          pull_requests: [{ number: pull.number, head: { sha: headSha } }],
          }];
          // GitHub applies filters before pagination and caps workflow-run searches at 1,000 results.
          const filtered = workflowRuns.filter((run) => !params.head_sha || run.head_sha === params.head_sha).slice(0, 1000);
          const page = Number(params.page ?? 1), perPage = Number(params.per_page ?? 30);
          return { data: { workflow_runs: filtered.slice((page - 1) * perPage, page * perPage) } };
        },
      },
      git: {
        getRef: async () => ({ data: { object: { sha: baseSha } } }),
        getCommit: async ({ commit_sha }: { commit_sha: string }) => {
          assert.equal(commit_sha, checkoutSha, "inspect the SHA recorded by checkout, not the run association");
          return { data: { parents: [{ sha: baseSha }, { sha: currentPull.head.sha }] } };
        },
      },
      repos: {
        listCommitStatusesForRef: async () => ({ data: options.codeRabbitState ? [{
          context: "CodeRabbit",
          state: options.codeRabbitState,
          creator: { login: options.codeRabbitCreator ?? "coderabbitai[bot]" },
          description: options.codeRabbitDescription ?? "Review completed",
          created_at: "2026-10-07T10:00:00Z",
        }] : [] }),
        listPullRequestsAssociatedWithCommit: async () => ({ data: [currentPull] }),
      },
    },
    paginate: async (endpoint: unknown, params: Record<string, unknown>) => {
      if (endpoint === github.rest.pulls.list) return [currentPull];
      if (endpoint === github.rest.actions.listJobsForWorkflowRun)
        return (await github.rest.actions.listJobsForWorkflowRun()).data.jobs;
      if (endpoint === github.rest.actions.listWorkflowRuns) {
        const runs: WorkflowRun[] = [];
        for (let page = 1; ; page++) {
          const { data } = await github.rest.actions.listWorkflowRuns({ ...params, page });
          runs.push(...data.workflow_runs.map((run, index) => ({ id: index + 1, run_attempt: 1, ...run })));
          if (data.workflow_runs.length < Number(params.per_page ?? 30)) return runs;
        }
      }
      return (await github.rest.pulls.listReviews()).data;
    },
    graphql: async () => ({ repository: { pullRequest: { reviewThreads: {
      nodes: [{ isResolved: !options.unresolvedThreads }],
      pageInfo: { hasNextPage: false, endCursor: null as string | null },
    } } } }),
  };
  return { github, merges, workflowRunRequests, currentPull };
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

test("a successful CodeRabbit status without a submitted review cannot auto-merge", async () => {
  const { github, merges } = mockGitHub({ codeRabbitState: "success" });
  github.rest.pulls.listReviews = async () => ({ data: [] });
  await executeWorkflow(github, context("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }));
  assert.deepEqual(merges, []);
});

test("an older formal review alone cannot authorize auto-merge without current-head completion", async () => {
  const merges = await run("status", {
    context: "CodeRabbit", state: "success", sha: headSha,
  }, { codeRabbitState: "pending", reviewHeadSha: "older-head" });
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

test("the mock filters API head_sha against the run SHA, not the PR association", async () => {
  const { github } = mockGitHub();
  const sourceLookup = await github.rest.actions.listWorkflowRuns({ head_sha: headSha, per_page: 100 });
  assert.deepEqual(sourceLookup.data.workflow_runs, []);
  const mergeLookup = await github.rest.actions.listWorkflowRuns({ head_sha: mergeSha, per_page: 100 });
  assert.equal(mergeLookup.data.workflow_runs.length, 1);
  assert.equal(mergeLookup.data.workflow_runs[0].pull_requests[0].head.sha, headSha);
});

test("current CI is accepted with either the source SHA or the distinct current merge SHA", async () => {
  for (const runSha of [headSha, mergeSha]) {
    const merges = await run("schedule", {}, {
      codeRabbitState: "success",
      workflowRuns: [{ head_sha: runSha, conclusion: "success", created_at: "2026-10-07T10:00:00Z",
        pull_requests: [{ number: pull.number, head: { sha: headSha } }] }],
    });
    assert.deepEqual(merges, [pull.number]);
  }
});

test("stale, wrong-PR and wrong-code-state CI cannot authorize a merge", async () => {
  const cases = [
    { head_sha: "older-source", number: pull.number, source: "older-source" },
    { head_sha: mergeSha, number: 999, source: headSha },
    { head_sha: headSha, number: 999, source: headSha },
    { head_sha: mergeSha, number: pull.number, source: "older-source" },
    // GitHub can update the PR association on an old run to the PR's current head.
    { head_sha: "older-source", number: pull.number, source: headSha },
    { head_sha: "older-merge", number: pull.number, source: headSha },
    { head_sha: "unrelated-code", number: pull.number, source: headSha },
  ];
  for (const candidate of cases) {
    const merges = await run("schedule", {}, {
      codeRabbitState: "success",
      workflowRuns: [{ head_sha: candidate.head_sha, conclusion: "success", created_at: "2026-10-07T10:00:00Z",
        pull_requests: [{ number: candidate.number, head: { sha: candidate.source } }] }],
    });
    assert.deepEqual(merges, [], JSON.stringify(candidate));
  }
});

test("a newer failed or unfinished CI run blocks an older success across source and merge SHA queries", async () => {
  for (const conclusion of ["failure", "cancelled", null]) {
    for (const newerSha of [headSha, mergeSha]) {
      const merges = await run("schedule", {}, {
        codeRabbitState: "success",
        workflowRuns: [
          { head_sha: newerSha === headSha ? mergeSha : headSha, conclusion: "success", created_at: "2026-10-07T10:00:00Z",
            pull_requests: [{ number: pull.number, head: { sha: headSha } }] },
          { head_sha: newerSha, conclusion, created_at: "2026-10-07T11:00:00Z",
            pull_requests: [{ number: pull.number, head: { sha: headSha } }] },
        ],
      });
      assert.deepEqual(merges, []);
    }
  }
});

test("targeted SHA lookups find current CI behind more than 1,000 newer unrelated runs", async () => {
  const unrelatedRuns = Array.from({ length: 1001 }, (_, index) => ({
    head_sha: `other-merge-${index}`,
    conclusion: "success",
    created_at: new Date(Date.parse("2026-10-07T11:00:00Z") + index * 1000).toISOString(),
    pull_requests: [{ number: 1000 + index, head: { sha: `other-${index}` } }],
  }));
  const { github, merges, workflowRunRequests } = mockGitHub({
    codeRabbitState: "success",
    workflowRuns: [...unrelatedRuns, {
      head_sha: mergeSha,
      conclusion: "success",
      created_at: "2026-10-07T10:00:00Z",
      pull_requests: [{ number: pull.number, head: { sha: headSha } }],
    }],
  });

  const broad = await github.rest.actions.listWorkflowRuns({ event: "pull_request", per_page: 100, page: 11 });
  assert.deepEqual(broad.data.workflow_runs, [], "broad pagination cannot reach the candidate past GitHub's cap");
  workflowRunRequests.length = 0;
  await executeWorkflow(github, context("schedule", {}));

  assert.deepEqual(merges, [pull.number]);
  assert.equal(workflowRunRequests.length, 4, "both evaluations use only targeted lookup pages");
  assert.deepEqual(workflowRunRequests.map((request) => request.head_sha), [headSha, mergeSha, headSha, mergeSha]);
  assert.deepEqual(workflowRunRequests.map((request) => request.page), [1, 1, 1, 1]);
  assert.ok(workflowRunRequests.every((request) => request.workflow_id === "ci.yml" && request.event === "pull_request"));
});

test("a missing or identical merge SHA produces only one targeted source lookup", async () => {
  for (const candidateMergeSha of [null, headSha]) {
    const { github, merges, workflowRunRequests } = mockGitHub({ codeRabbitState: "success", mergeSha: candidateMergeSha,
      workflowRuns: [{ head_sha: headSha, conclusion: "success", created_at: "2026-10-07T10:00:00Z",
        pull_requests: [{ number: pull.number, head: { sha: headSha } }] }],
    });
    await executeWorkflow(github, context("schedule", {}));
    assert.deepEqual(merges, [pull.number]);
    assert.deepEqual(workflowRunRequests.map((request) => request.head_sha), [headSha, headSha]);
  }
});

test("targeted discovery still independently rejects an unexpected stale run SHA", async () => {
  const { github, merges } = mockGitHub({ codeRabbitState: "success" });
  // Exercise the validation independently of the API's normal SHA filtering.
  github.rest.actions.listWorkflowRuns = async () => ({ data: { workflow_runs: [{
    head_sha: "older-merge", conclusion: "success", created_at: "2026-10-07T10:00:00Z",
    pull_requests: [{ number: pull.number, head: { sha: headSha } }],
  }] } });
  await executeWorkflow(github, context("schedule", {}));
  assert.deepEqual(merges, []);
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

test("PR #17 policy preserves incremental fixes after final-head completion without a second formal review", async () => {
  const originalHead = "325c8539c90965fa20ad4512b724db5a89e177ef";
  const finalHead = "55c854afa50d4b7dbc63f3b8447bc0404d8e4696";
  const { github, merges } = mockGitHub({ codeRabbitState: "pending", reviewHeadSha: originalHead });
  const candidate = { ...pull, number: 16, head: { ...pull.head, sha: finalHead } };
  github.rest.pulls.get = async () => ({ data: candidate });
  github.rest.pulls.list = async () => ({ data: [candidate] });
  const paginate = github.paginate;
  github.paginate = async (endpoint, params) => endpoint === github.rest.pulls.list
    ? [candidate] : paginate(endpoint, params);
  github.rest.repos.listPullRequestsAssociatedWithCommit = async () => ({ data: [candidate] });
  let ci: string | null = null;
  let resolved = false;
  let completed = false;
  github.rest.actions.listWorkflowRuns = async () => ({ data: { workflow_runs: [{
    head_sha: finalHead, conclusion: ci, created_at: "2026-10-07T11:01:30Z",
    pull_requests: [{ number: 16, head: { sha: finalHead } }],
  }] } });
  github.rest.repos.listCommitStatusesForRef = async () => ({ data: [{
    context: "CodeRabbit", state: completed ? "success" : "pending",
    creator: { login: "coderabbitai[bot]" },
    description: completed ? "Review completed" : "Review in progress",
    created_at: completed ? "2026-10-07T11:14:39Z" : "2026-10-07T11:01:33Z",
  }] });
  github.graphql = async () => ({ repository: { pullRequest: { reviewThreads: {
    nodes: [{ isResolved: resolved }, { isResolved: resolved }],
    pageInfo: { hasNextPage: false, endCursor: null },
  } } } });
  github.rest.pulls.merge = async ({ pull_number, sha }) => {
    assert.equal(sha, finalHead);
    merges.push(pull_number);
    return { data: { merged: true, message: "merged" } };
  };
  github.rest.git.getCommit = async () => ({ data: { parents: [{ sha: baseSha }, { sha: finalHead }] } });
  // An earlier formal review exists throughout; no new review event is emitted.
  await executeWorkflow(github, context("schedule", {}));
  assert.deepEqual(merges, []);
  ci = "success";
  await executeWorkflow(github, context("schedule", {}));
  assert.deepEqual(merges, []);
  resolved = true;
  await executeWorkflow(github, context("schedule", {}));
  assert.deepEqual(merges, [], "11:14:01 scheduled recheck still waits for CodeRabbit completion");
  completed = true;
  // Reproduce the removed gate: even now it could never find a final-head review.
  assert.equal((await github.rest.pulls.listReviews()).data.some((review) => review.commit_id === finalHead), false);
  const oldGate = workflowBody.replace(
    'review.user?.login === "coderabbitai[bot]" && review.submitted_at',
    'review.user?.login === "coderabbitai[bot]" && review.commit_id === pull.head.sha',
  );
  assert.notEqual(oldGate, workflowBody);
  await new AsyncFunction("github", "context", "core", oldGate)(github,
    context("status", { context: "CodeRabbit", state: "success", sha: finalHead }), { info: () => {} });
  assert.deepEqual(merges, [], "restoring the old gate reproduces #16's eligible-state failure");
  const logs: string[] = [];
  await executeScript(github, context("status", {
    context: "CodeRabbit", state: "success", sha: finalHead,
  }), { info: (message: string) => logs.push(message) });
  assert.deepEqual(merges, [16], "11:14:41 completion event requests merge without manual intervention");
  assert.ok(logs.some((message) => message.includes("all gates passed")));
  merges.length = 0;
  await executeWorkflow(github, context("schedule", {}));
  assert.deepEqual(merges, [16], "scheduled recheck also handles incremental review completion");
});

test("incremental review support rejects skipped, spoofed, failed or unfinished completion", async () => {
  for (const options of [
    { codeRabbitState: "pending" }, { codeRabbitState: "failure" },
    { codeRabbitState: "success", codeRabbitDescription: "Review skipped" },
    { codeRabbitState: "success", codeRabbitCreator: "another-user" },
    { codeRabbitState: "success", reviewState: "PENDING" },
    { codeRabbitState: "success", reviewState: "DISMISSED" },
    { codeRabbitState: "success", unresolvedThreads: true },
    { codeRabbitState: "success", reviewState: "CHANGES_REQUESTED" },
    { codeRabbitState: "success", humanReviewState: "CHANGES_REQUESTED", humanReviewHeadSha: "older-head" },
    { codeRabbitState: "success", draft: true },
    { codeRabbitState: "success", repository: "other/veil" },
  ]) {
    assert.deepEqual(await run("schedule", {}, { reviewHeadSha: "older-head", ...options }), [], JSON.stringify(options));
  }
});

test("a stale completion event cannot authorize a newer head", async () => {
  assert.deepEqual(await run("status", {
    context: "CodeRabbit", state: "success", sha: "older-head",
  }, { codeRabbitState: "success", reviewHeadSha: "older-head" }), []);
});

regressionContract("repository.automerge-current-base", "async-race-safety",
  "successful source-head CI cannot merge after main advances until the actual checkout tests the new base", async () => {
    const { github, merges } = mockGitHub({ codeRabbitState: "success", workflowRuns: [{
      head_sha: headSha, conclusion: "success", created_at: "2026-10-07T10:00:00Z",
      // Deliberately look current even though the immutable checkout still has old parents.
      pull_requests: [{ number: pull.number, head: { sha: headSha } }],
    }] });
    const newBase = "new-main-sha";
    github.rest.git.getRef = async () => ({ data: { object: { sha: newBase } } });
    await executeWorkflow(github, context("schedule", {}));
    assert.deepEqual(merges, [], "old-base checkout evidence cannot authorize current main");
    github.rest.git.getCommit = async () => ({ data: { parents: [{ sha: newBase }, { sha: headSha }] } });
    await executeWorkflow(github, context("schedule", {}));
    assert.deepEqual(merges, [pull.number], "current-base validation restores eligibility");
  });

test("main advancing during the final scan blocks merge even after both CI checks pass", async () => {
  const { github, merges } = mockGitHub({ codeRabbitState: "success" });
  let baseReads = 0;
  github.rest.git.getRef = async () => ({ data: { object: {
    sha: ++baseReads >= 3 ? "advanced-main" : baseSha,
  } } });
  await executeWorkflow(github, context("schedule", {}));
  assert.deepEqual(merges, []);
  assert.equal(baseReads, 3, "base is read again immediately before merge");
});

regressionContract("repository.automerge-label-revocation", "async-race-safety",
  "label removal after initial evaluation prevents any merge request", async () => {
    const { github, merges, currentPull } = mockGitHub({ codeRabbitState: "success" });
    const readThreads = github.graphql;
    github.graphql = async () => {
      const result = await readThreads();
      currentPull.labels = [];
      return result;
    };
    await executeWorkflow(github, context("schedule", {}));
    assert.deepEqual(merges, []);
  });

regressionContract("repository.automerge-review-revocation", "async-race-safety",
  "a blocking review arriving after initial reviews prevents any merge request", async () => {
    const { github, merges } = mockGitHub({ codeRabbitState: "success" });
    let reviewsRead = 0;
    const readReviews = github.rest.pulls.listReviews;
    github.rest.pulls.listReviews = async () => {
      const result = await readReviews();
      if (++reviewsRead > 1) result.data.push({
        user: { login: "new-reviewer" }, commit_id: headSha, state: "CHANGES_REQUESTED",
        submitted_at: "2026-10-07T11:00:00Z",
      });
      return result;
    };
    await executeWorkflow(github, context("schedule", {}));
    assert.deepEqual(merges, []);
    assert.equal(reviewsRead, 2, "reviews are authoritative fresh reads, not cached snapshots");
  });

test("every eligibility gate is rechecked after initial success", async () => {
  for (const gate of ["closed", "draft", "head", "repository", "base-ref", "ci", "status", "authentication",
    "completion", "bot-review", "threads"]) {
    const { github, merges, currentPull } = mockGitHub({ codeRabbitState: "success" });
    const readThreads = github.graphql;
    let initialDone = false;
    github.graphql = async () => {
      const result = await readThreads();
      if (initialDone && gate === "threads") result.repository.pullRequest.reviewThreads.nodes[0].isResolved = false;
      if (!initialDone) {
        initialDone = true;
        if (gate === "closed") currentPull.state = "closed";
        if (gate === "draft") currentPull.draft = true;
        if (gate === "head") currentPull.head = { ...currentPull.head, sha: "changed-head" };
        if (gate === "repository") currentPull.head.repo = { ...currentPull.head.repo, full_name: "other/veil" };
        if (gate === "base-ref") currentPull.base = { ref: "other" };
        if (gate === "ci") {
          const readRuns = github.rest.actions.listWorkflowRuns;
          github.rest.actions.listWorkflowRuns = async (params) => {
            const response = await readRuns(params);
            response.data.workflow_runs.forEach((run) => { run.conclusion = "failure"; });
            return response;
          };
        }
        if (["status", "authentication", "completion"].includes(gate)) {
          const readStatuses = github.rest.repos.listCommitStatusesForRef;
          github.rest.repos.listCommitStatusesForRef = async () => {
            const response = await readStatuses();
            if (gate === "status") response.data[0].state = "pending";
            if (gate === "authentication") response.data[0].creator.login = "spoofed-bot";
            if (gate === "completion") response.data[0].description = "Review skipped";
            return response;
          };
        }
        if (gate === "bot-review") github.rest.pulls.listReviews = async () => ({ data: [] });
      }
      return result;
    };
    await executeWorkflow(github, context("schedule", {}));
    assert.deepEqual(merges, [], `revoked gate: ${gate}`);
  }
});

test("label removal during the final scan is caught by the last PR read", async () => {
  const { github, merges, currentPull } = mockGitHub({ codeRabbitState: "success" });
  const readThreads = github.graphql;
  let threadReads = 0;
  github.graphql = async () => {
    const result = await readThreads();
    if (++threadReads === 2) currentPull.labels = [];
    return result;
  };
  await executeWorkflow(github, context("schedule", {}));
  assert.deepEqual(merges, []);
  assert.equal(threadReads, 2);
});

regressionContract("repository.automerge-candidate-isolation", "async-race-safety",
  "API, merge and unperformed-merge failures on the first PR do not starve the next candidate", async () => {
    for (const failure of ["api", "merge", "unperformed"]) {
      const { github, merges, currentPull } = mockGitHub({ codeRabbitState: "success" });
      const second = { ...currentPull, number: 25 };
      const visited: number[] = [];
      const warnings: string[] = [];
      // Read responses are snapshots, as with the real REST API; no shared object is
      // implicitly refreshed by changing the fake's authoritative state.
      github.rest.pulls.get = async (params?: { pull_number: number }) => {
        const number = params?.pull_number ?? pull.number;
        visited.push(number);
        if (number === pull.number && failure === "api") throw new Error("API unavailable");
        return { data: structuredClone(number === second.number ? second : currentPull) };
      };
      const paginate = github.paginate;
      github.paginate = async (endpoint, params) => endpoint === github.rest.pulls.list
        ? [currentPull, second] : paginate(endpoint, params);
      github.rest.actions.listWorkflowRuns = async () => ({ data: { workflow_runs: [{
        head_sha: headSha, conclusion: "success", created_at: "2026-10-07T10:00:00Z",
        pull_requests: [currentPull, second].map((candidate) => ({ number: candidate.number, head: { sha: headSha } })),
      }] } });
      github.rest.pulls.merge = async ({ pull_number, sha }) => {
        assert.equal(sha, headSha);
        if (pull_number === pull.number) {
          if (failure === "merge") throw new Error("405 merge refused");
          if (failure === "unperformed") return { data: { merged: false, message: "merge refused" } };
        }
        merges.push(pull_number);
        return { data: { merged: true, message: "merged" } };
      };
      await executeWorkflow(github, context("schedule", {}), warnings);
      assert.ok(visited.includes(second.number), failure);
      assert.deepEqual(merges, [second.number], failure);
      assert.ok(warnings.some((warning) => warning.includes("PR #24") && warning.includes("continuing scan")), failure);
    }
  });

test("missing, ambiguous, stale or malformed checkout evidence fails closed", async () => {
  for (const evidence of ["missing", "ambiguous", "later-spoof", "wrong-parent-order", "wrong-head", "not-merge", "attempt"]) {
    const { github, merges } = mockGitHub({ codeRabbitState: "success" });
    if (evidence === "missing") github.rest.actions.downloadJobLogsForWorkflowRun = async () => ({ data: "logs expired" });
    if (evidence === "ambiguous") github.rest.actions.downloadJobLogsForWorkflowRun = async () => ({ data:
      checkoutLogs().replace("##[group]Run actions/setup-node@v5", "[command]/usr/bin/git log -1 --format=%H\n2026-10-07T11:35:48Z " + checkoutSha + "\n2026-10-07T11:35:49Z ##[group]Run actions/setup-node@v5"),
    });
    if (evidence === "later-spoof") github.rest.actions.downloadJobLogsForWorkflowRun = async () => ({ data:
      checkoutLogs().replace("git log -1 --format=%H", "unrecognized checkout") + checkoutLogs(),
    });
    if (evidence === "wrong-parent-order") github.rest.git.getCommit = async () => ({ data: { parents: [{ sha: headSha }, { sha: baseSha }] } });
    if (evidence === "wrong-head") github.rest.git.getCommit = async () => ({ data: { parents: [{ sha: baseSha }, { sha: "stale-head" }] } });
    if (evidence === "not-merge") github.rest.git.getCommit = async () => ({ data: { parents: [{ sha: baseSha }] } });
    if (evidence === "attempt") {
      const readJobs = github.rest.actions.listJobsForWorkflowRun;
      github.rest.actions.listJobsForWorkflowRun = async () => {
        const result = await readJobs();
        result.data.jobs[0].run_attempt = 2;
        return result;
      };
    }
    await executeWorkflow(github, context("schedule", {}));
    assert.deepEqual(merges, [], evidence);
  }
});

test("both evaluation passes paginate review threads and block an unresolved second page", async () => {
  for (const blockFinal of [false, true]) {
    const { github, merges } = mockGitHub({ codeRabbitState: "success" });
    let scans = 0;
    const cursors: unknown[] = [];
    github.graphql = async (_query?: unknown, params?: { cursor: string | null }) => {
      const cursor = params?.cursor ?? null;
      cursors.push(cursor);
      if (!cursor) scans++;
      return { repository: { pullRequest: { reviewThreads: {
        nodes: [{ isResolved: !(blockFinal && scans === 2 && cursor === "page-2") }],
        pageInfo: { hasNextPage: !cursor, endCursor: cursor ? null : "page-2" },
      } } } };
    };
    await executeWorkflow(github, context("schedule", {}));
    assert.deepEqual(cursors, [null, "page-2", null, "page-2"]);
    assert.deepEqual(merges, blockFinal ? [] : [pull.number]);
  }
});

