import { useEffect, useRef, useState, type FormEvent } from "react";
import * as stylex from "@stylexjs/stylex";

import { createJarvisInSpace } from "../jarvis-create-api.ts";
import { isCodexReasoningEffort, type CodexReasoningEffort } from "../codex-reasoning-effort.ts";
import type { PrototypeSpacesState } from "../new-space-prototype.ts";
import { DEFAULT_JARVIS_PARENT_PATH, displayLocationPath, fetchSettings } from "../settings-api.ts";
import {
  fetchProviderModels,
  type CreateProvider,
  type ProviderModel,
} from "../session-creation-api.ts";
import { createProvider, ProviderSessionFields } from "./ProviderSessionFields.tsx";
import { dialogs } from "./page/NewDashboardDialogs.stylex.ts";

function jarvisSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "jarvis-session"
  );
}

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

type CreateJarvisDialogProps = {
  spaceId: string;
  spaceName: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  /** Element that opened the dialog — restored on close even if the menu unmounted. */
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
  onCreated: (result: {
    state: PrototypeSpacesState;
    sessionId: string;
    bootstrapStatus: string;
    bootstrapError?: string;
  }) => void;
};

export function CreateJarvisDialog({
  spaceId,
  spaceName,
  defaultProvider,
  defaultModel,
  returnFocusTo = null,
  onClose,
  onBusyChange,
  onCreated,
}: CreateJarvisDialogProps) {
  const [name, setName] = useState("");
  const [jarvisParent, setJarvisParent] = useState(DEFAULT_JARVIS_PARENT_PATH);
  const [provider, setProvider] = useState<CreateProvider>(
    createProvider(defaultProvider ?? "opencode"),
  );
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelLoadKey, setModelLoadKey] = useState(0);
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort | "">("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(returnFocusTo);

  const slug = jarvisSlug(name.trim() || "jarvis-session");
  const destination = `${displayLocationPath(jarvisParent, DEFAULT_JARVIS_PARENT_PATH)}/${slug}`;

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
    void fetchSettings()
      .then((settings) => {
        if (active) {
          setJarvisParent(
            displayLocationPath(settings.preferredJarvisParentPath, DEFAULT_JARVIS_PARENT_PATH),
          );
        }
      })
      .catch(() => {
        // Keep default parent preview.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setModelsLoading(true);
    setModelsError(null);
    // Clear stale model immediately so a fast submit cannot send the previous provider's id.
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
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) {
      setError("Name is required and must be 80 characters or fewer.");
      return;
    }
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
    try {
      const result = await createJarvisInSpace({
        spaceId,
        name: trimmed,
        provider,
        modelID: modelId,
        reasoningEffort,
      });
      onCreated({
        state: result.state,
        sessionId: result.session.id,
        bootstrapStatus: result.bootstrapStatus,
        bootstrapError: result.bootstrapError,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create Jarvis.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div {...stylex.props(dialogs.layer)}>
      <button
        {...stylex.props(dialogs.backdrop)}
        type="button"
        aria-label="Close create Jarvis dialog"
        disabled={creating}
        onClick={onClose}
      />
      <form
        {...stylex.props(dialogs.formModal)}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-jarvis-title"
        tabIndex={0}
        onSubmit={onSubmit}
      >
        <header {...stylex.props(dialogs.header)}>
          <div>
            <small {...stylex.props(dialogs.eyebrow)}>CREATE JARVIS</small>
            <h2 {...stylex.props(dialogs.title)} id="create-jarvis-title">
              New Jarvis in {spaceName}
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
          Scaffolds a Jarvis git repo under your preferred parent, attaches it to this space, and
          starts a provider session marked as Jarvis-managed.
        </p>
        <div {...stylex.props(dialogs.destinationPreview)}>
          <span {...stylex.props(dialogs.labelText)}>DESTINATION</span>
          <code {...stylex.props(dialogs.destinationPath)}>{destination}</code>
        </div>
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
        <label {...stylex.props(dialogs.label)}>
          <span {...stylex.props(dialogs.labelText)}>SESSION NAME</span>
          <input
            {...stylex.props(dialogs.input)}
            autoFocus
            value={name}
            disabled={creating}
            maxLength={80}
            placeholder="the jarvis"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </label>
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
          onModelIdChange={setModelId}
          models={models}
          modelsLoading={modelsLoading}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={(value) => {
            if (!value || isCodexReasoningEffort(value)) setReasoningEffort(value);
          }}
          disabled={creating}
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
            {creating ? "Creating…" : "Create Jarvis"}
          </button>
        </footer>
      </form>
    </div>
  );
}
