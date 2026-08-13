import * as stylex from "@stylexjs/stylex";

import { codexReasoningEfforts, type CodexReasoningEffort } from "../codex-reasoning-effort.ts";
import {
  providerLabels,
  providerModelOptionValue,
  type CreateProvider,
  type ProviderModel,
} from "../session-creation-api.ts";
import { dialogs } from "./page/NewDashboardDialogs.stylex.ts";

type ProviderSessionFieldsProps = {
  provider: CreateProvider;
  onProviderChange: (provider: CreateProvider) => void;
  modelId: string;
  onModelIdChange: (modelId: string) => void;
  models: ProviderModel[];
  modelsLoading: boolean;
  reasoningEffort: CodexReasoningEffort | "";
  onReasoningEffortChange: (effort: CodexReasoningEffort | "") => void;
  disabled?: boolean;
  autoFocusProvider?: boolean;
};

function createProvider(value: string): CreateProvider {
  if (value === "claude" || value === "codex" || value === "cursor" || value === "grok")
    return value;
  return "opencode";
}

export function ProviderSessionFields({
  provider,
  onProviderChange,
  modelId,
  onModelIdChange,
  models,
  modelsLoading,
  reasoningEffort,
  onReasoningEffortChange,
  disabled = false,
  autoFocusProvider = false,
}: ProviderSessionFieldsProps) {
  return (
    <>
      <label {...stylex.props(dialogs.label)}>
        <span {...stylex.props(dialogs.labelText)}>PROVIDER</span>
        <select
          {...stylex.props(dialogs.input)}
          autoFocus={autoFocusProvider}
          value={provider}
          disabled={disabled}
          onChange={(event) => onProviderChange(createProvider(event.target.value))}
        >
          {(Object.keys(providerLabels) as CreateProvider[]).map((item) => (
            <option key={item} value={item}>
              {providerLabels[item]}
            </option>
          ))}
        </select>
      </label>
      <label {...stylex.props(dialogs.label)}>
        <span {...stylex.props(dialogs.labelText)}>MODEL</span>
        <select
          {...stylex.props(dialogs.input)}
          value={modelId}
          disabled={disabled || modelsLoading || !models.length}
          onChange={(event) => onModelIdChange(event.target.value)}
        >
          {models.map((model) => {
            const value = providerModelOptionValue(provider, model);
            return (
              <option key={value} value={value}>
                {provider === "opencode" ? `${model.providerID}/${model.name}` : model.name}
              </option>
            );
          })}
        </select>
      </label>
      {provider === "codex" ? (
        <label {...stylex.props(dialogs.label)}>
          <span {...stylex.props(dialogs.labelText)}>REASONING EFFORT</span>
          <select
            {...stylex.props(dialogs.input)}
            value={reasoningEffort}
            disabled={disabled}
            onChange={(event) =>
              onReasoningEffortChange(event.target.value as CodexReasoningEffort | "")
            }
          >
            <option value="">Provider default</option>
            {codexReasoningEfforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}

export { createProvider };
