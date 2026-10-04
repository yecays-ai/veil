import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync("components/settings/presets/preset-detail.tsx", "utf8");
const css = readFileSync("app/settings/presets/presets.css", "utf8");

test("Preset Detail renders one ordered inline Prompt pipeline", () => {
  assert.match(detail, /buildDisplayedPrompts\(draft\)/);
  assert.match(detail, /editingPromptId/);
  assert.match(detail, /displayedPrompts\.map/);
  assert.doesNotMatch(detail, /<h2>Prompt Order<\/h2>/);
  assert.doesNotMatch(detail, /entryHref|\/prompts\/\$\{/);
  assert.equal((detail.match(/<h2>Prompt Entries<\/h2>/g) ?? []).length, 1);
});

test("ordinary Prompts expose their actual fields inline without duplicate Response Directive state", () => {
  assert.match(detail, /entry\.source === "prompt"/);
  assert.match(detail, /value=\{entry\.content\}/);
  assert.match(detail, /updatePrompt\(entry\.identifier, \{ \.\.\.entry, content:/);
  assert.match(detail, /value=\{entry\.name\}/);
  assert.match(detail, /value=\{entry\.role\}/);
  assert.doesNotMatch(detail, /<h2>Response Directive<\/h2>|Edit Response Directive|responseDirectiveText/);
  assert.doesNotMatch(detail, /identifier === "response-directive"/);
  assert.doesNotMatch(detail, /identifier === "chat_output_format"/);
});

test("markers explain runtime content without exposing a fake textarea", () => {
  assert.match(detail, /Runtime marker · \{entry\.marker\}/);
  assert.match(detail, /Content is supplied dynamically by VEIL\./);
  assert.match(detail, /entry\.source === "prompt" \? <fieldset/);
  assert.match(detail, /: <div className="preset-marker-note">/);
});

test("inline controls synchronize enable and order while built-in controls stay disabled", () => {
  assert.match(detail, /checked=\{enabled\}/);
  assert.match(detail, /togglePrompt\(entry\.identifier, event\.target\.checked\)/);
  assert.match(detail, /prompts: current\.prompts\.map/);
  assert.match(detail, /promptOrder: current\.promptOrder\.map/);
  assert.match(detail, /setDraft\(movePrompt\(draft, entry\.identifier, -1\)\)/);
  assert.match(detail, /disabled=\{readOnly \|\| busy/);
  assert.match(detail, /fieldset disabled=\{readOnly \|\| busy\}/);
});

test("Generation Parameters are collapsed by default and expose only supported fields", () => {
  assert.match(detail, /<details className="preset-section preset-generation">/);
  assert.doesNotMatch(detail, /<details[^>]*\sopen/);
  assert.match(detail, /\["temperature", "maxTokens"\]/);
  for (const unsupported of ["topP", "topK", "minP", "frequencyPenalty", "presencePenalty"])
    assert(!detail.includes(unsupported));
});

test("collapsed Prompt rows remain compact and only expanded content grows", () => {
  assert.match(css, /\.preset-prompt-summary\s*\{[^}]*min-height:\s*58px/);
  assert.match(css, /\.preset-prompt-editor\s*\{/);
  assert.doesNotMatch(css, /\.preset-prompt-summary\s*\{[^}]*min-height:\s*(?:1[0-9]{2}|[2-9][0-9]{2})px/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)/);
});
