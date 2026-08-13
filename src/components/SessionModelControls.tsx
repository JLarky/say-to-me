import React, { useDeferredValue, useEffect, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";

import { controls } from "../styles/controls.stylex.ts";
import { badge } from "../styles/feed.stylex.ts";
import type { OpenCodeModel, Session } from "../types.ts";
import { ModelSelectionPayload, OpenCodeModelsPayload, SessionPayload } from "../types.ts";
import {
  JsonUnknownArray,
  safeJsonParse,
  UnknownJson,
  safeResponseJson,
} from "@say-to-me/runtime-validation";
import { ReasoningEffortSelect } from "./ReasoningEffortSelect.tsx";

export { ReasoningEffortSelect } from "./ReasoningEffortSelect.tsx";

/** Keeps picker open across remounts caused by live session snapshot refreshes. */
const pickerOpenBySessionId = new Map<string, boolean>();

const mobile = "@media (max-width: 680px)" as const;

const modelPicker = stylex.create({
  wrapper: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.35rem",
    columnGap: "0.4rem",
    minWidth: 0,
    width: { [mobile]: "100%" },
    zIndex: 20,
  },
  trigger: {
    maxWidth: "18rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: { [mobile]: "100%" },
  },
  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: { default: 0, [mobile]: "auto" },
    right: { default: "auto", [mobile]: 0 },
    zIndex: 20,
    width: { default: "min(28rem, calc(100vw - 2rem))", [mobile]: "calc(100vw - 2rem)" },
    maxHeight: { default: "50vh", [mobile]: "40vh" },
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#e0c9b0",
    borderRadius: "14px",
    backgroundColor: "#fffdf8",
    boxShadow: "0 16px 44px rgba(23, 32, 42, 0.18)",
  },
  header: {
    padding: "0.55rem",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "#eadbc8",
  },
  search: {
    width: "100%",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.16)",
    borderRadius: "999px",
    paddingBlock: "0.38rem",
    paddingInline: "0.72rem",
    font: "inherit",
    backgroundColor: "#fff",
  },
  list: {
    maxHeight: { default: "calc(50vh - 3.5rem)", [mobile]: "calc(40vh - 3.5rem)" },
    overflowY: "auto",
    paddingBlock: "0.25rem",
  },
  sectionLabel: {
    paddingBlock: "0.32rem",
    paddingInline: "0.85rem",
    color: "#667085",
    fontSize: "0.72rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  option: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "1fr auto",
    columnGap: "0.75rem",
    alignItems: "center",
    borderWidth: 0,
    paddingBlock: "0.42rem",
    paddingInline: "0.85rem",
    font: "inherit",
    color: "#17202a",
    textAlign: "left",
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": "#fdf3e7" },
  },
  optionSelected: { backgroundColor: "#efe5d7" },
  optionActive: { backgroundColor: "#fdf3e7", boxShadow: "inset 3px 0 0 #17202a" },
  optionText: { display: "flex", minWidth: 0, flexDirection: "column", rowGap: "0.15rem" },
  optionTitle: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 650,
  },
  optionMeta: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#667085",
    fontSize: "0.78rem",
  },
  selectedMark: { color: "#067647", fontWeight: 800 },
  empty: { padding: "1rem", color: "#667085" },
});

const effortPicker = stylex.create({
  label: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    color: "#52606d",
    width: "100%",
  },
});

function providerLabel(provider: string): string {
  return provider === "github-copilot" ? "copilot" : provider;
}

function modelLabel(provider: string | null | undefined, model: string | null | undefined): string {
  return [provider ? providerLabel(provider) : null, model].filter(Boolean).join("/");
}

function modelValue(provider: string | null | undefined, model: string | null | undefined): string {
  return provider && model ? `${encodeURIComponent(provider)}/${encodeURIComponent(model)}` : "";
}

function labelForModelValue(value: string): string {
  const separator = value.indexOf("/");
  if (separator === -1) return value;
  return modelLabel(
    decodeURIComponent(value.slice(0, separator)),
    decodeURIComponent(value.slice(separator + 1)),
  );
}

function defaultProviderForBackend(backend: Session["backend"]): string | null {
  switch (backend) {
    case "codex":
      return "openai";
    case "claude":
      return "anthropic";
    case "cursor":
      return "cursor";
    case "grok":
      return "xai";
    default:
      return null;
  }
}

function modelRefForValue(
  value: string,
  defaultProviderID: string | null = null,
): { providerID: string; modelID: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf("/");
  if (separator === -1) {
    const providerID = defaultProviderID?.trim();
    return providerID ? { providerID, modelID: trimmed } : null;
  }
  const providerID = decodeURIComponent(trimmed.slice(0, separator)).trim();
  const modelID = decodeURIComponent(trimmed.slice(separator + 1)).trim();
  return providerID && modelID ? { providerID, modelID } : null;
}

function valueForOpenCodeModel(model: OpenCodeModel): string {
  return modelValue(model.providerID, model.id);
}

export function openCodeSessionModelLabel(session: Session | null | undefined): string {
  return modelLabel(
    session?.opencodeSelectedModelProvider || session?.opencodeModelProvider,
    session?.opencodeSelectedModel || session?.opencodeModel,
  );
}

type RecentModel = { providerID: string; modelID: string };
const recentModelsStorageKey = "say-to-me.opencode.recentModels";
const openCodeGlobalStorageKey = "opencode.global.dat";

function isRecentModel(value: unknown): value is RecentModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Record<string, unknown>;
  return typeof model.providerID === "string" && typeof model.modelID === "string";
}

function readRecentModelsFromStorage(): RecentModel[] {
  try {
    const stored = window.localStorage.getItem(recentModelsStorageKey);
    const parsed = stored ? safeJsonParse(JsonUnknownArray, stored) : null;
    if (Array.isArray(parsed)) return parsed.filter(isRecentModel).slice(0, 10);
    const openCodeStored = window.localStorage.getItem(openCodeGlobalStorageKey);
    const openCodeParsed = openCodeStored ? safeJsonParse(UnknownJson, openCodeStored) : null;
    const openCodeRecent = (openCodeParsed as { model?: { recent?: unknown } } | null)?.model
      ?.recent;
    if (Array.isArray(openCodeRecent)) return openCodeRecent.filter(isRecentModel).slice(0, 10);
  } catch {
    return [];
  }
  return [];
}

function writeRecentModelsToStorage(models: RecentModel[]) {
  try {
    window.localStorage.setItem(recentModelsStorageKey, JSON.stringify(models.slice(0, 10)));
  } catch {
    /* ignore storage failures */
  }
}

function modelSearchText(model: OpenCodeModel): string {
  return `${model.providerID} ${providerLabel(model.providerID)} ${model.id} ${model.name}`.toLowerCase();
}
function modelMatchesQuery(model: OpenCodeModel, query: string): boolean {
  if (!query) return true;
  const searchText = modelSearchText(model);
  return query.split(/\s+/).every((token) => searchText.includes(token));
}
function modelDisplayName(model: OpenCodeModel): string {
  return model.name && model.name !== model.id ? model.name : model.id;
}
function uniqueModels(models: OpenCodeModel[]): OpenCodeModel[] {
  const seen = new Set<string>();
  const result: OpenCodeModel[] = [];
  for (const model of models) {
    const value = valueForOpenCodeModel(model);
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(model);
  }
  return result;
}

type ModelPickerOption = {
  model: OpenCodeModel | null;
  section: "recent" | "all" | "manual";
  value: string;
};

export function OpenCodeAgentModelBadge({
  modelProvider,
  model,
}: {
  modelProvider?: string | null;
  model?: string | null;
}) {
  const label = modelLabel(modelProvider, model);
  if (!label) return null;
  return (
    <span {...stylex.props(badge.base)} data-opencode-agent-model={label} title="OpenCode model">
      {label}
    </span>
  );
}

export function OpenCodeModelSelect({
  session,
  onEffortReset,
  onModelChange,
  children,
}: {
  session: Session | null;
  onEffortReset?: (reasoningEffort: string | null) => void;
  onModelChange?: () => void;
  children?: React.ReactNode;
}) {
  const sessionId = session?.id;
  const pickerRef = useRef<HTMLSpanElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [models, setModels] = useState<OpenCodeModel[]>([]);
  const [loading, setLoading] = useState(false);
  // Survive parent remounts during live session refreshes (same session id).
  const [open, setOpenState] = useState(() =>
    sessionId ? (pickerOpenBySessionId.get(sessionId) ?? false) : false,
  );
  function setOpen(next: boolean) {
    if (sessionId) pickerOpenBySessionId.set(sessionId, next);
    setOpenState(next);
  }
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [settingOpenCodeModel, setSettingOpenCodeModel] = useState(false);
  const [settingAllOpenCodeModels, setSettingAllOpenCodeModels] = useState(false);
  const [resettingOpenCodeModel, setResettingOpenCodeModel] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const [recentModels, setRecentModels] = useState<RecentModel[]>(() =>
    readRecentModelsFromStorage(),
  );
  const [selected, setSelected] = useState(
    modelValue(
      session?.opencodeSelectedModelProvider || session?.opencodeModelProvider,
      session?.opencodeSelectedModel || session?.opencodeModel,
    ),
  );

  useEffect(() => {
    if (!sessionId) return;
    setOpenState(pickerOpenBySessionId.get(sessionId) ?? false);
  }, [sessionId]);

  useEffect(() => {
    setSelected(
      modelValue(
        session?.opencodeSelectedModelProvider || session?.opencodeModelProvider,
        session?.opencodeSelectedModel || session?.opencodeModel,
      ),
    );
  }, [
    session?.opencodeModel,
    session?.opencodeModelProvider,
    session?.opencodeSelectedModel,
    session?.opencodeSelectedModelProvider,
  ]);

  useEffect(() => {
    if (!sessionId) {
      setModels([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    async function loadModels() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/models`);
        const payload = await safeResponseJson(response, OpenCodeModelsPayload);
        if (!cancelled) setModels(payload.models);
      } catch {
        if (!cancelled) setModels([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node | null))
        setOpen(false);
    }
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [open]);

  function rememberModel(model: OpenCodeModel) {
    const next = [
      { providerID: model.providerID, modelID: model.id },
      ...recentModels.filter(
        (item) => item.providerID !== model.providerID || item.modelID !== model.id,
      ),
    ].slice(0, 10);
    setRecentModels(next);
    writeRecentModelsToStorage(next);
  }
  function openPicker() {
    setOpen(true);
    setActiveIndex(0);
  }
  function defaultProviderID() {
    return (
      session?.opencodeSelectedModelProvider ||
      session?.opencodeModelProvider ||
      defaultProviderForBackend(session?.backend) ||
      models[0]?.providerID ||
      null
    );
  }
  function modelRefForSelection(value: string) {
    return modelRefForValue(value, defaultProviderID());
  }

  async function saveSelectedModel(providerID: string, modelID: string) {
    if (!sessionId) return;
    const openCodeSession = /^ses_[A-Za-z0-9]+$/.test(sessionId);
    const response = await fetch(
      `/api/sessions/${sessionId}/${openCodeSession ? "opencode-model" : "model"}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID, modelID }),
      },
    );
    if (!response.ok) return;
    if (openCodeSession) {
      const payload = await safeResponseJson(response, SessionPayload);
      setSelected(
        modelValue(
          payload.session.opencodeSelectedModelProvider,
          payload.session.opencodeSelectedModel,
        ),
      );
      onModelChange?.();
      return;
    }
    const payload = await safeResponseJson(response, ModelSelectionPayload);
    setSelected(modelValue(payload.providerID, payload.modelID));
    onModelChange?.();
  }
  async function chooseModel(value: string) {
    const next = models.find((model) => valueForOpenCodeModel(model) === value);
    if (!sessionId) return;
    if (!next) {
      const model = modelRefForSelection(value);
      if (!model) return;
      setSelected(modelValue(model.providerID, model.modelID));
      setOpen(false);
      await saveSelectedModel(model.providerID, model.modelID);
      return;
    }
    setSelected(modelValue(next.providerID, next.id));
    rememberModel(next);
    setOpen(false);
    await saveSelectedModel(next.providerID, next.id);
  }
  async function setOpenCodeModel() {
    const model = modelRefForSelection(selected);
    if (!sessionId || !model) return;
    setSettingOpenCodeModel(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/opencode-model/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: model.providerID, modelID: model.modelID }),
      });
      if (!response.ok) return;
      const payload = await safeResponseJson(response, SessionPayload);
      setSelected(
        modelValue(
          payload.session.opencodeSelectedModelProvider,
          payload.session.opencodeSelectedModel,
        ),
      );
      onModelChange?.();
    } finally {
      setSettingOpenCodeModel(false);
    }
  }
  async function resetOpenCodeModel() {
    if (!sessionId) return;
    setResettingOpenCodeModel(true);
    try {
      if (/^ses_[A-Za-z0-9]+$/.test(sessionId || "")) {
        const response = await fetch(`/api/sessions/${sessionId}/opencode-model/reset`, {
          method: "POST",
        });
        if (!response.ok) return;
        const payload = await safeResponseJson(response, SessionPayload);
        setSelected(
          modelValue(
            payload.session.opencodeSelectedModelProvider,
            payload.session.opencodeSelectedModel,
          ),
        );
        onEffortReset?.(payload.session.reasoningEffort ?? null);
        onModelChange?.();
      } else {
        const response = await fetch(`/api/sessions/${sessionId}/model/reset`, { method: "POST" });
        if (!response.ok) return;
        const payload = await safeResponseJson(response, ModelSelectionPayload);
        if (!payload.providerID || !payload.modelID) return;
        setSelected(modelValue(payload.providerID, payload.modelID));
        onEffortReset?.(payload.reasoningEffort ?? null);
        onModelChange?.();
      }
    } finally {
      setResettingOpenCodeModel(false);
    }
  }
  async function setAllOpenCodeModels() {
    const model = modelRefForSelection(selected);
    if (!model) return;
    if (!window.confirm("Update model for ALL OpenCode sessions?")) return;
    setSettingAllOpenCodeModels(true);
    try {
      await fetch(`/api/opencode-model/set-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: model.providerID, modelID: model.modelID }),
      });
    } finally {
      setSettingAllOpenCodeModels(false);
    }
  }

  if (!sessionId) return null;
  const isOpenCode = /^ses_[A-Za-z0-9]+$/.test(sessionId || "");
  const trimmedQuery = deferredQuery.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const selectedModel = models.find((model) => valueForOpenCodeModel(model) === selected);
  const currentLabel = selectedModel
    ? modelLabel(selectedModel.providerID, selectedModel.id)
    : selected
      ? labelForModelValue(selected)
      : loading
        ? "Loading models..."
        : "Choose model";
  const recentOptions = uniqueModels(
    recentModels.flatMap((item) => {
      const model = models.find(
        (candidate) => candidate.providerID === item.providerID && candidate.id === item.modelID,
      );
      return model ? [model] : [];
    }),
  );
  const visibleModels = uniqueModels(
    models.filter((model) => modelMatchesQuery(model, normalizedQuery)),
  ).slice(0, 80);
  const pickerOptions: ModelPickerOption[] = [
    ...(!normalizedQuery
      ? recentOptions.map((model) => ({
          model,
          section: "recent" as const,
          value: valueForOpenCodeModel(model),
        }))
      : []),
    ...visibleModels.map((model) => ({
      model,
      section: "all" as const,
      value: valueForOpenCodeModel(model),
    })),
    ...(normalizedQuery ? [{ model: null, section: "manual" as const, value: trimmedQuery }] : []),
  ];
  function moveActive(direction: 1 | -1) {
    if (!pickerOptions.length) return;
    setActiveIndex((current) => {
      const next = (current + direction + pickerOptions.length) % pickerOptions.length;
      optionRefs.current[next]?.scrollIntoView?.({ block: "nearest" });
      return next;
    });
  }
  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      optionRefs.current[0]?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const next = Math.max(0, pickerOptions.length - 1);
      setActiveIndex(next);
      optionRefs.current[next]?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = pickerOptions[activeIndex];
      if (option) void chooseModel(option.value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }
  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openPicker();
  }
  function renderOption(option: ModelPickerOption, index: number) {
    const { model, section, value } = option;
    const isSelected = value === selected;
    const isActive = index === activeIndex;
    return (
      <button
        key={`${section}:${value}`}
        ref={(element) => {
          optionRefs.current[index] = element;
        }}
        {...stylex.props(
          modelPicker.option,
          isSelected && modelPicker.optionSelected,
          isActive && modelPicker.optionActive,
        )}
        type="button"
        role="option"
        aria-selected={isActive}
        data-opencode-model-value={value}
        data-active={isActive ? "true" : undefined}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => void chooseModel(value)}
      >
        <span {...stylex.props(modelPicker.optionText)}>
          <span {...stylex.props(modelPicker.optionTitle)}>
            {section === "manual" ? "Set manual model" : model ? modelDisplayName(model) : null}
          </span>
          <span {...stylex.props(modelPicker.optionMeta)}>
            {section === "manual"
              ? value
              : model
                ? `${providerLabel(model.providerID)}/${model.id}`
                : null}
          </span>
        </span>
        {isSelected ? <span {...stylex.props(modelPicker.selectedMark)}>Selected</span> : null}
      </button>
    );
  }
  return (
    <span {...stylex.props(modelPicker.wrapper)} ref={pickerRef}>
      <button
        {...stylex.props(
          controls.button,
          controls.secondary,
          controls.compact,
          modelPicker.trigger,
        )}
        type="button"
        aria-label="OpenCode model"
        aria-expanded={open}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        {currentLabel}
      </button>
      {isOpenCode ? (
        <>
          <button
            {...stylex.props(controls.button, controls.secondary, controls.compact)}
            type="button"
            disabled={!selected || settingOpenCodeModel}
            title="Set this model on the OpenCode session"
            onClick={() => void setOpenCodeModel()}
          >
            {settingOpenCodeModel ? "Setting..." : "Set"}
          </button>
          <button
            {...stylex.props(controls.button, controls.secondary, controls.compact)}
            type="button"
            disabled={!selected || settingAllOpenCodeModels}
            title="Set this model on all Say To Me sessions at once"
            onClick={() => void setAllOpenCodeModels()}
          >
            {settingAllOpenCodeModels ? "Setting everywhere..." : "Set everywhere"}
          </button>
        </>
      ) : null}
      {children}
      <button
        {...stylex.props(controls.button, controls.secondary, controls.compact)}
        type="button"
        disabled={resettingOpenCodeModel}
        title={`Load the current model from ${isOpenCode ? "OpenCode" : "the provider"}`}
        onClick={() => void resetOpenCodeModel()}
      >
        {resettingOpenCodeModel ? "Resetting..." : "Reset"}
      </button>
      {open ? (
        <div {...stylex.props(modelPicker.panel)} data-opencode-model-panel-placement="start">
          <div {...stylex.props(modelPicker.header)}>
            <input
              {...stylex.props(modelPicker.search)}
              aria-label="Search OpenCode models"
              autoFocus
              placeholder="Search provider or model"
              value={query}
              onKeyDown={handleSearchKeyDown}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
            />
          </div>
          <div {...stylex.props(modelPicker.list)} role="listbox">
            {!normalizedQuery && recentOptions.length ? (
              <>
                <div {...stylex.props(modelPicker.sectionLabel)}>Recent</div>
                {pickerOptions
                  .filter((option) => option.section === "recent")
                  .map((option, index) => renderOption(option, index))}
              </>
            ) : null}
            {!normalizedQuery ? (
              <div {...stylex.props(modelPicker.sectionLabel)}>All models</div>
            ) : visibleModels.length ? (
              <div {...stylex.props(modelPicker.sectionLabel)}>Matches</div>
            ) : (
              <div {...stylex.props(modelPicker.sectionLabel)}>No matches</div>
            )}
            {pickerOptions
              .map((option, index) => ({ option, index }))
              .filter(({ option }) => option.section !== "manual" && option.section !== "recent")
              .map(({ option, index }) => renderOption(option, index))}
            {normalizedQuery
              ? pickerOptions
                  .filter((option) => option.section === "manual")
                  .map((option) => renderOption(option, pickerOptions.length - 1))
              : null}
            {!normalizedQuery && !visibleModels.length ? (
              <div {...stylex.props(modelPicker.empty)}>
                {loading ? "Loading models..." : "No matching models."}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}

export function SessionModelControls({ session }: { session: Session | null }) {
  const [resetEffort, setResetEffort] = useState<string | null | undefined>(undefined);
  const [modelVersion, setModelVersion] = useState(0);
  useEffect(() => {
    setResetEffort(undefined);
    setModelVersion(0);
  }, [session?.id]);
  return (
    <label {...stylex.props(effortPicker.label)}>
      Model
      <OpenCodeModelSelect
        session={session}
        onEffortReset={setResetEffort}
        onModelChange={() => setModelVersion((version) => version + 1)}
      >
        <ReasoningEffortSelect
          session={session}
          resetEffort={resetEffort}
          modelVersion={modelVersion}
        />
      </OpenCodeModelSelect>
    </label>
  );
}
