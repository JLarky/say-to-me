import { useEffect, useRef, useState, type FormEvent } from "react";
import * as stylex from "@stylexjs/stylex";

import {
  createAgentWorktreeSession,
  newAgentBranchId,
  resolveAgentBase,
  suggestAgentBranch,
  worktreeFolderNameFromBranch,
} from "../agent-worktree-session.ts";
import { isCodexReasoningEffort, type CodexReasoningEffort } from "../codex-reasoning-effort.ts";
import type { PrototypeSpacesState } from "../new-space-prototype.ts";
import { DEFAULT_WORKTREE_PARENT_PATH, displayLocationPath } from "../settings-api.ts";
import {
  fetchProviderModels,
  type CreateProvider,
  type ProviderModel,
} from "../session-creation-api.ts";
import { createProvider, ProviderSessionFields } from "./ProviderSessionFields.tsx";
import { dialogs } from "./page/NewDashboardDialogs.stylex.ts";

const agentDialog = stylex.create({
  checkbox: {
    display: "flex",
    alignItems: "center",
    rowGap: "10px",
    columnGap: "10px",
    marginTop: "18px",
    color: "#c7cbc0",
    fontSize: "13px",
    lineHeight: 1.4,
    cursor: "pointer",
  },
  checkboxInput: {
    width: "16px",
    height: "16px",
    accentColor: "#dfff45",
    flexShrink: 0,
  },
});

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => {
    if (element.hasAttribute("disabled")) return false;
    return element.offsetParent !== null || element === document.activeElement || element === root;
  });
}

type CreateAgentWorktreeDialogProps = {
  spaceId: string;
  spaceName: string;
  repoId: string;
  repoName: string;
  base: string;
  parentPath: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
  onState?: (state: PrototypeSpacesState) => void;
  onCreated: (result: {
    state: PrototypeSpacesState;
    sessionId: string;
    worktreePath: string;
    branch: string;
  }) => void;
};

export function CreateAgentWorktreeDialog({
  spaceId,
  spaceName,
  repoId,
  repoName,
  base,
  parentPath,
  defaultProvider,
  defaultModel,
  returnFocusTo = null,
  onClose,
  onBusyChange,
  onState,
  onCreated,
}: CreateAgentWorktreeDialogProps) {
  const [provider, setProvider] = useState<CreateProvider>(
    createProvider(defaultProvider ?? "cursor"),
  );
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelLoadKey, setModelLoadKey] = useState(0);
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort | "">("");
  const [branchId] = useState(() => newAgentBranchId());
  const [lockedBranch, setLockedBranch] = useState<string | null>(null);
  const [useRemoteDefault, setUseRemoteDefault] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingWorktreePath, setPendingWorktreePath] = useState<string | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(returnFocusTo);

  const branch = lockedBranch ?? suggestAgentBranch(provider, branchId);
  const effectiveBase = resolveAgentBase(base, useRemoteDefault);
  const startingFromLabel = useRemoteDefault ? "remote default (origin/HEAD)" : effectiveBase;
  const folder = worktreeFolderNameFromBranch(branch);
  const destination = `${displayLocationPath(parentPath, DEFAULT_WORKTREE_PARENT_PATH)}/${repoName}-${branch.replaceAll("/", "-")}`;
  const worktreeStarted = Boolean(pendingWorktreePath);

  useEffect(() => {
    onBusyChange?.(creating);
  }, [creating, onBusyChange]);

  useEffect(() => {
    previousFocusRef.current =
      returnFocusTo ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialog = dialogRef.current;
    const focusInitial = () => {
      const input = dialog?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled])",
      );
      (input ?? dialog)?.focus();
    };
    focusInitial();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialog) return;
      const items = focusableElements(dialog);
      // While creating, controls are disabled — keep focus on the dialog container.
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog)
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [returnFocusTo]);

  useEffect(() => {
    let active = true;
    setModelsLoading(true);
    setModelsError(null);
    setModelId("");
    void fetchProviderModels(provider)
      .then((next) => {
        if (!active) return;
        setModels(next);
        if (next.length === 0) {
          setModelId("");
          setModelsError("No models available for this provider.");
          return;
        }
        const preferred = defaultModel?.toLocaleLowerCase();
        const preferredMatch = next.find(
          (model) =>
            model.id.toLocaleLowerCase() === preferred ||
            model.name.toLocaleLowerCase() === preferred ||
            `${model.providerID}/${model.id}`.toLocaleLowerCase() === preferred,
        );
        const selected = preferredMatch ?? next[0]!;
        setModelId(provider === "opencode" ? `${selected.providerID}/${selected.id}` : selected.id);
      })
      .catch((cause: unknown) => {
        const err = cause;
        if (!active) return;
        setModels([]);
        setModelId("");
        setModelsError(err instanceof Error ? err.message : "Unable to load models.");
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [defaultModel, modelLoadKey, provider]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelId) {
      setError("Pick a model first.");
      return;
    }
    if (provider === "opencode" && !modelId.includes("/")) {
      setError("Pick an OpenCode model (provider/model).");
      return;
    }
    if (reasoningEffort && !isCodexReasoningEffort(reasoningEffort)) {
      setError("Invalid reasoning effort.");
      return;
    }
    setCreating(true);
    setError(null);
    setLockedBranch(branch);
    let worktreePath = pendingWorktreePath;
    let sessionId = pendingSessionId;
    try {
      const result = await createAgentWorktreeSession({
        spaceId,
        repoId,
        branch,
        base: effectiveBase,
        parentPath,
        provider,
        modelID: modelId,
        reasoningEffort,
        worktreePath,
        sessionId,
        onProgress: (progress) => {
          if (progress.worktreePath) {
            worktreePath = progress.worktreePath;
            setPendingWorktreePath(progress.worktreePath);
          }
          if (progress.sessionId) {
            sessionId = progress.sessionId;
            setPendingSessionId(progress.sessionId);
          }
          if (progress.state) onState?.(progress.state);
        },
      });
      setPendingWorktreePath(result.worktreePath);
      setPendingSessionId(result.sessionId);
      onCreated(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create agent session.";
      setError(
        worktreePath || sessionId
          ? `${message} Retry continues from the worktree or session already created.`
          : message,
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div {...stylex.props(dialogs.layer)}>
      <button
        {...stylex.props(dialogs.backdrop)}
        type="button"
        aria-label="Close new agent dialog"
        disabled={creating}
        onClick={onClose}
      />
      <form
        {...stylex.props(dialogs.formModal)}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-title"
        tabIndex={0}
        onSubmit={onSubmit}
      >
        <header {...stylex.props(dialogs.header)}>
          <div>
            <small {...stylex.props(dialogs.eyebrow)}>NEW AGENT</small>
            <h2 {...stylex.props(dialogs.title)} id="create-agent-title">
              Start in a fresh worktree
            </h2>
          </div>
          <button
            {...stylex.props(dialogs.close)}
            type="button"
            aria-label="Close"
            disabled={creating}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <p {...stylex.props(dialogs.description)}>
          Creates branch {branch} from {startingFromLabel} in {repoName}, attaches the worktree to{" "}
          {spaceName}, and starts a provider session there.
        </p>
        <div {...stylex.props(dialogs.destinationPreview)}>
          <span {...stylex.props(dialogs.labelText)}>WORKTREE</span>
          <code {...stylex.props(dialogs.destinationPath)}>{destination}</code>
        </div>
        <div {...stylex.props(dialogs.destinationPreview)}>
          <span {...stylex.props(dialogs.labelText)}>NEW BRANCH</span>
          <code {...stylex.props(dialogs.destinationPath)}>
            {branch} ({folder})
          </code>
        </div>
        <div {...stylex.props(dialogs.destinationPreview)}>
          <span {...stylex.props(dialogs.labelText)}>STARTING FROM</span>
          <code {...stylex.props(dialogs.destinationPath)}>{startingFromLabel}</code>
        </div>
        <label {...stylex.props(agentDialog.checkbox)}>
          <input
            {...stylex.props(agentDialog.checkboxInput)}
            type="checkbox"
            checked={useRemoteDefault}
            disabled={creating || worktreeStarted}
            onChange={(event) => setUseRemoteDefault(event.target.checked)}
          />
          <span>Start from remote default</span>
        </label>
        <p {...stylex.props(dialogs.formHelp)}>
          {useRemoteDefault
            ? "Resolves origin/HEAD (main, develop, …), fetches that tip, then creates the worktree from it."
            : `Uses the selected checkout base (${base}) with no fetch.`}
        </p>
        {error ? (
          <p {...stylex.props(dialogs.error)} role="alert">
            {error}
          </p>
        ) : null}
        {modelsError ? (
          <p {...stylex.props(dialogs.error)} role="alert">
            {modelsError}{" "}
            <button
              type="button"
              disabled={creating || modelsLoading}
              onClick={() => {
                setModelsError(null);
                setModelLoadKey((key) => key + 1);
              }}
            >
              Retry
            </button>
          </p>
        ) : null}
        <ProviderSessionFields
          provider={provider}
          onProviderChange={(next) => {
            setProvider(next);
            setModels([]);
            setModelId("");
            setReasoningEffort("");
            setError(null);
            setModelsError(null);
          }}
          modelId={modelId}
          onModelIdChange={(next) => {
            setModelId(next);
            setError(null);
          }}
          models={models}
          modelsLoading={modelsLoading}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={(next) => {
            setReasoningEffort(next);
            setError(null);
          }}
          disabled={creating || worktreeStarted}
        />
        <footer {...stylex.props(dialogs.footer)}>
          <button
            {...stylex.props(dialogs.button)}
            type="button"
            disabled={creating}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            {...stylex.props(
              dialogs.button,
              dialogs.primaryButton,
              (creating || modelsLoading || !modelId) && dialogs.disabledButton,
            )}
            type="submit"
            disabled={creating || modelsLoading || !modelId}
          >
            {creating
              ? pendingSessionId
                ? "Attaching…"
                : pendingWorktreePath
                  ? "Creating session…"
                  : "Creating worktree…"
              : pendingSessionId
                ? "Retry attaching"
                : pendingWorktreePath
                  ? "Retry creating session"
                  : "Create agent"}
          </button>
        </footer>
      </form>
    </div>
  );
}
