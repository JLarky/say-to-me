import React, { useEffect, useMemo, useState } from "react";
import * as stylex from "@stylexjs/stylex";

import { controls } from "../styles/controls.stylex.ts";
import type { Session } from "../types.ts";
import { SessionOpenCodeReasoningEffortPayload } from "../types.ts";
import { safeResponseJson } from "@say-to-me/runtime-validation";

const mobile = "@media (max-width: 680px)" as const;

const effortPicker = stylex.create({
  wrapper: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    width: {
      [mobile]: "100%",
    },
  },
  select: {
    minWidth: 0,
    width: {
      [mobile]: "100%",
    },
  },
});

type EffortConfig = {
  endpoint: "reasoning-effort" | "opencode-reasoning-effort";
  label: "Codex" | "OpenCode";
  dataAttribute: "data-codex-reasoning-effort" | "data-opencode-reasoning-effort";
  allowsClear: boolean;
};

function effortConfig(backend: Session["backend"]): EffortConfig | null {
  if (backend === "codex") {
    return {
      endpoint: "reasoning-effort",
      label: "Codex",
      dataAttribute: "data-codex-reasoning-effort",
      allowsClear: false,
    };
  }
  if (backend === "opencode") {
    return {
      endpoint: "opencode-reasoning-effort",
      label: "OpenCode",
      dataAttribute: "data-opencode-reasoning-effort",
      allowsClear: true,
    };
  }
  return null;
}

export function ReasoningEffortSelect({
  session,
  resetEffort,
  modelVersion = 0,
}: {
  session: Session | null;
  resetEffort?: string | null;
  modelVersion?: number;
}) {
  const sessionId = session?.id;
  const config = useMemo(() => effortConfig(session?.backend), [session?.backend]);
  const [available, setAvailable] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId || !config) {
      setAvailable([]);
      setSelected(null);
      setCurrent(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/sessions/${sessionId}/${config.endpoint}`)
      .then(async (response) => {
        const payload = await safeResponseJson(response, SessionOpenCodeReasoningEffortPayload);
        if (!response.ok) throw new Error("Unable to load reasoning effort.");
        if (cancelled) return;
        setAvailable(payload.available);
        setSelected(payload.selected);
        setCurrent(payload.current);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load effort");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, sessionId, modelVersion]);

  useEffect(() => {
    const sessionEffort = session?.reasoningEffort;
    if (config && sessionEffort && available.includes(sessionEffort)) {
      setSelected(sessionEffort);
      setCurrent(sessionEffort);
    }
  }, [available, config, session?.reasoningEffort]);

  useEffect(() => {
    if (resetEffort === undefined) return;
    setSelected(resetEffort);
    setCurrent(resetEffort);
  }, [resetEffort]);

  if (!sessionId || !config) return null;
  const selectedConfig = config;

  const displayed = selected ?? current ?? "";

  async function chooseEffort(value: string) {
    if (!selectedConfig.allowsClear && !available.includes(value)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/${selectedConfig.endpoint}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effort: value }),
      });
      const payload = await safeResponseJson(response, SessionOpenCodeReasoningEffortPayload);
      if (!response.ok) throw new Error("Unable to save reasoning effort.");
      setSelected(payload.selected);
      setCurrent(payload.current);
    } catch {
      setError("Unable to save effort");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span
      {...stylex.props(effortPicker.wrapper)}
      data-reasoning-effort
      data-codex-reasoning-effort={
        config.dataAttribute === "data-codex-reasoning-effort" ? true : undefined
      }
      data-opencode-reasoning-effort={
        config.dataAttribute === "data-opencode-reasoning-effort" ? true : undefined
      }
    >
      <select
        {...stylex.props(controls.select, controls.compact, effortPicker.select)}
        aria-label={`${config.label} reasoning effort`}
        value={displayed}
        disabled={loading || saving || !available.length}
        onChange={(event) => void chooseEffort(event.target.value)}
      >
        {config.allowsClear ? <option value="">Default (OpenCode)</option> : null}
        {available.map((effort) => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
      </select>
      {error ? <span role="alert">{error}</span> : null}
    </span>
  );
}
