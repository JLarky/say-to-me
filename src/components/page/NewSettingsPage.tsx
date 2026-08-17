import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router";

import {
  loadPrototypeProfile,
  profileInitials,
  savePrototypeProfile,
} from "../../new-space-prototype.ts";
import { chrome } from "./NewDashboardChrome.stylex.ts";
import { Sidebar } from "./NewDashboardChrome.tsx";
import { settings } from "./NewSettingsPage.stylex.ts";
import {
  createEmptyT3ServerInstance,
  createEmptyPaseoInstance,
  DEFAULT_JARVIS_PARENT_PATH,
  DEFAULT_PASEO_HOST,
  DEFAULT_WORKTREE_PARENT_PATH,
  displayLocationPath,
  fetchSettings,
  type T3ServerInstance,
  type PaseoInstance,
  type OpenCodeInstance,
  updateSettings,
} from "../../settings-api.ts";

export function NewSettingsPage() {
  const [profile, setProfile] = useState(loadPrototypeProfile);
  const [draftName, setDraftName] = useState(profile.name);
  const [saved, setSaved] = useState(false);
  const [worktreeParent, setWorktreeParent] = useState(DEFAULT_WORKTREE_PARENT_PATH);
  const [jarvisParent, setJarvisParent] = useState(DEFAULT_JARVIS_PARENT_PATH);
  const [t3Instances, setT3Instances] = useState<T3ServerInstance[]>([]);
  const [paseoInstances, setPaseoInstances] = useState<PaseoInstance[]>([]);
  const [opencodeInstances, setOpenCodeInstances] = useState<OpenCodeInstance[]>([]);
  const [locationSettingsLoading, setLocationSettingsLoading] = useState(true);
  const [worktreeSettingsSaving, setWorktreeSettingsSaving] = useState(false);
  const [jarvisSettingsSaving, setJarvisSettingsSaving] = useState(false);
  const [t3SettingsSaving, setT3SettingsSaving] = useState(false);
  const [paseoSettingsSaving, setPaseoSettingsSaving] = useState(false);
  const [opencodeSettingsSaving, setOpenCodeSettingsSaving] = useState(false);
  const [worktreeSettingsSaved, setWorktreeSettingsSaved] = useState(false);
  const [jarvisSettingsSaved, setJarvisSettingsSaved] = useState(false);
  const [t3SettingsSaved, setT3SettingsSaved] = useState(false);
  const [paseoSettingsSaved, setPaseoSettingsSaved] = useState(false);
  const [opencodeSettingsSaved, setOpenCodeSettingsSaved] = useState(false);
  const [worktreeSettingsError, setWorktreeSettingsError] = useState<string | null>(null);
  const [jarvisSettingsError, setJarvisSettingsError] = useState<string | null>(null);
  const [t3SettingsError, setT3SettingsError] = useState<string | null>(null);
  const [paseoSettingsError, setPaseoSettingsError] = useState<string | null>(null);
  const [opencodeSettingsError, setOpenCodeSettingsError] = useState<string | null>(null);
  const name = draftName.trim();

  useEffect(() => {
    document.title = "Say To Me — Settings";
  }, []);

  useEffect(() => {
    let active = true;
    void fetchSettings()
      .then((value) => {
        if (!active) return;
        setWorktreeParent(
          displayLocationPath(value.preferredWorktreeParentPath, DEFAULT_WORKTREE_PARENT_PATH),
        );
        setJarvisParent(
          displayLocationPath(value.preferredJarvisParentPath, DEFAULT_JARVIS_PARENT_PATH),
        );
        setT3Instances(value.t3ServerInstances);
        setPaseoInstances(value.paseoInstances);
        setOpenCodeInstances(value.opencodeInstances ?? []);
        setWorktreeSettingsError(null);
        setJarvisSettingsError(null);
        setT3SettingsError(null);
        setPaseoSettingsError(null);
        setOpenCodeSettingsError(null);
      })
      .catch((cause: unknown) => {
        const error = cause;
        if (!active) return;
        const message =
          error instanceof Error ? error.message : "Unable to load location settings.";
        setWorktreeSettingsError(message);
        setJarvisSettingsError(message);
        setT3SettingsError(message);
        setPaseoSettingsError(message);
        setOpenCodeSettingsError(message);
      })
      .finally(() => {
        if (active) setLocationSettingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function save() {
    if (!name) return;
    const next = { name };
    savePrototypeProfile(next);
    setProfile(next);
    setDraftName(name);
    setSaved(true);
  }

  async function saveWorktreeSettings() {
    setWorktreeSettingsSaving(true);
    setWorktreeSettingsError(null);
    try {
      const value = await updateSettings({
        preferredWorktreeParentPath: worktreeParent.trim() || null,
      });
      setWorktreeParent(
        displayLocationPath(value.preferredWorktreeParentPath, DEFAULT_WORKTREE_PARENT_PATH),
      );
      setWorktreeSettingsSaved(true);
    } catch (error) {
      setWorktreeSettingsError(
        error instanceof Error ? error.message : "Unable to save worktree settings.",
      );
    } finally {
      setWorktreeSettingsSaving(false);
    }
  }

  async function saveJarvisSettings() {
    setJarvisSettingsSaving(true);
    setJarvisSettingsError(null);
    try {
      const value = await updateSettings({
        preferredJarvisParentPath: jarvisParent.trim() || null,
      });
      setJarvisParent(
        displayLocationPath(value.preferredJarvisParentPath, DEFAULT_JARVIS_PARENT_PATH),
      );
      setJarvisSettingsSaved(true);
    } catch (error) {
      setJarvisSettingsError(
        error instanceof Error ? error.message : "Unable to save Jarvis settings.",
      );
    } finally {
      setJarvisSettingsSaving(false);
    }
  }

  function updateT3Instance(index: number, patch: Partial<T3ServerInstance>) {
    setT3Instances((current) =>
      current.map((instance, i) => (i === index ? { ...instance, ...patch } : instance)),
    );
    setT3SettingsSaved(false);
  }

  function addT3Instance() {
    setT3Instances((current) => [
      ...current,
      createEmptyT3ServerInstance(
        current.some((instance) => instance.id === "default") ? { id: "worktree" } : {},
      ),
    ]);
    setT3SettingsSaved(false);
  }

  function removeT3Instance(index: number) {
    setT3Instances((current) => current.filter((_, i) => i !== index));
    setT3SettingsSaved(false);
  }

  async function saveT3Settings() {
    setT3SettingsSaving(true);
    setT3SettingsError(null);
    try {
      const value = await updateSettings({ t3ServerInstances: t3Instances });
      setT3Instances(value.t3ServerInstances);
      setT3SettingsSaved(true);
    } catch (error) {
      setT3SettingsError(
        error instanceof Error ? error.message : "Unable to save T3 server instances.",
      );
    } finally {
      setT3SettingsSaving(false);
    }
  }

  function updatePaseoInstance(index: number, patch: Partial<PaseoInstance>) {
    setPaseoInstances((current) =>
      current.map((instance, i) => (i === index ? { ...instance, ...patch } : instance)),
    );
    setPaseoSettingsSaved(false);
  }

  async function removePaseoInstance(index: number) {
    const instance = paseoInstances[index];
    if (!instance) return;
    const label = instance.id.trim() || `instance ${index + 1}`;
    const fallbackNotice =
      paseoInstances.length === 1
        ? `\n\nA default Paseo instance for ${DEFAULT_PASEO_HOST} will be created.`
        : "";
    if (
      !window.confirm(
        `Remove Paseo instance "${label}"?\n\nExisting sessions assigned to this instance might stop working.${fallbackNotice}`,
      )
    ) {
      return;
    }

    const previous = paseoInstances;
    const next = previous.filter((_, i) => i !== index);
    setPaseoInstances(next);
    setPaseoSettingsSaved(false);
    setPaseoSettingsError(null);
    setPaseoSettingsSaving(true);
    try {
      const value = await updateSettings({ paseoInstances: next });
      setPaseoInstances(value.paseoInstances);
      setPaseoSettingsSaved(true);
    } catch (error) {
      setPaseoInstances(previous);
      setPaseoSettingsError(
        error instanceof Error ? error.message : "Unable to remove Paseo instance.",
      );
    } finally {
      setPaseoSettingsSaving(false);
    }
  }

  async function savePaseoSettings() {
    setPaseoSettingsSaving(true);
    setPaseoSettingsError(null);
    try {
      const value = await updateSettings({ paseoInstances });
      setPaseoInstances(value.paseoInstances);
      setPaseoSettingsSaved(true);
    } catch (error) {
      setPaseoSettingsError(
        error instanceof Error ? error.message : "Unable to save Paseo instances.",
      );
    } finally {
      setPaseoSettingsSaving(false);
    }
  }

  async function saveOpenCodeSettings() {
    setOpenCodeSettingsSaving(true);
    setOpenCodeSettingsError(null);
    try {
      const value = await updateSettings({ opencodeInstances });
      setOpenCodeInstances(value.opencodeInstances ?? []);
      setOpenCodeSettingsSaved(true);
    } catch (error) {
      setOpenCodeSettingsError(
        error instanceof Error ? error.message : "Unable to save OpenCode settings.",
      );
    } finally {
      setOpenCodeSettingsSaving(false);
    }
  }

  return (
    <div {...stylex.props(chrome.root, chrome.shell)}>
      <Sidebar active="settings" initials={profileInitials(profile.name)} />
      <main {...stylex.props(settings.main)}>
        <header {...stylex.props(settings.topbar)}>
          <div>
            <small {...stylex.props(settings.topbarLabel)}>LOCAL PROFILE</small>
            <strong {...stylex.props(settings.topbarTitle)}>Settings</strong>
          </div>
          <Link {...stylex.props(settings.backLink)} to="/dashboard">
            Back to spaces
          </Link>
        </header>

        <div {...stylex.props(settings.content)}>
          <section {...stylex.props(settings.intro)}>
            <span {...stylex.props(settings.eyebrow)}>IDENTITY</span>
            <h1 {...stylex.props(settings.heading)}>Make the initials yours.</h1>
            <p {...stylex.props(settings.lede)}>
              This name identifies you in the prototype. Its initials appear in the navigation on
              this browser only.
            </p>
          </section>

          <section {...stylex.props(settings.card)}>
            <div {...stylex.props(settings.preview)}>
              <span {...stylex.props(settings.avatar)}>{profileInitials(name)}</span>
              <strong {...stylex.props(settings.previewName)}>{name || "Your name"}</strong>
            </div>

            <form
              {...stylex.props(settings.form)}
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <label {...stylex.props(settings.label)}>
                DISPLAY NAME
                <input
                  {...stylex.props(settings.input)}
                  autoFocus
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                    setSaved(false);
                  }}
                  placeholder="Your name"
                />
              </label>
              <p {...stylex.props(settings.hint)}>
                Initials use the first and last words in your name.
              </p>
              <div {...stylex.props(settings.actions)}>
                <span {...stylex.props(settings.saved)}>{saved ? "Saved locally" : ""}</span>
                <button {...stylex.props(settings.saveButton)} type="submit" disabled={!name}>
                  Save profile
                </button>
              </div>
            </form>
          </section>

          <div {...stylex.props(settings.note)}>
            <span {...stylex.props(settings.noteMark)}>i</span>
            <span>
              Prototype profile data stays in localStorage and is not sent to a server or shared
              with other browsers.
            </span>
          </div>

          <section {...stylex.props(settings.intro, settings.preferenceIntro)}>
            <span {...stylex.props(settings.eyebrow)}>OPENCODE</span>
            <h2 {...stylex.props(settings.preferenceHeading)}>Configure OpenCode links.</h2>
            <p {...stylex.props(settings.lede)}>
              Set the local and Tailscale hosts used by OpenCode session links.
            </p>
          </section>
          <section {...stylex.props(settings.card, settings.preferenceCard)}>
            <form
              {...stylex.props(settings.form)}
              onSubmit={(event) => {
                event.preventDefault();
                void saveOpenCodeSettings();
              }}
            >
              {opencodeInstances.map((instance, index) => (
                <div key={`opencode-${index}`} {...stylex.props(settings.instanceCard)}>
                  <div {...stylex.props(settings.instanceHeader)}>
                    <span {...stylex.props(settings.instanceTitle)}>
                      INSTANCE {index + 1} · {instance.id}
                    </span>
                  </div>
                  <div {...stylex.props(settings.fieldStack)}>
                    <label {...stylex.props(settings.label)}>
                      LOCAL URL
                      <input
                        {...stylex.props(settings.input)}
                        value={instance.localUrl ?? ""}
                        placeholder="http://localhost:4096"
                        onChange={(event) =>
                          setOpenCodeInstances((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, localUrl: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </label>
                    <label {...stylex.props(settings.label)}>
                      TAILSCALE URL
                      <input
                        {...stylex.props(settings.input)}
                        value={instance.tailscaleUrl ?? ""}
                        placeholder="https://opencode.example.ts.net"
                        onChange={(event) =>
                          setOpenCodeInstances((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, tailscaleUrl: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
              {opencodeSettingsError ? (
                <p {...stylex.props(settings.error)} role="alert">
                  {opencodeSettingsError}
                </p>
              ) : null}
              <div {...stylex.props(settings.actions)}>
                <span {...stylex.props(settings.saved)}>
                  {opencodeSettingsSaved ? "OpenCode settings saved" : ""}
                </span>
                <button
                  {...stylex.props(settings.saveButton)}
                  type="submit"
                  disabled={locationSettingsLoading || opencodeSettingsSaving}
                >
                  {opencodeSettingsSaving ? "Saving…" : "Save OpenCode links"}
                </button>
              </div>
            </form>
          </section>

          <section {...stylex.props(settings.intro, settings.preferenceIntro)}>
            <span {...stylex.props(settings.eyebrow)}>WORKTREES</span>
            <h2 {...stylex.props(settings.preferenceHeading)}>Choose the default location once.</h2>
            <p {...stylex.props(settings.lede)}>
              New worktree forms use this parent folder by default. You can still override it for an
              individual worktree.
            </p>
          </section>

          <section {...stylex.props(settings.card, settings.preferenceCard)}>
            <form
              {...stylex.props(settings.form)}
              onSubmit={(event) => {
                event.preventDefault();
                void saveWorktreeSettings();
              }}
            >
              <label {...stylex.props(settings.label)}>
                PREFERRED WORKTREE PARENT
                <input
                  {...stylex.props(settings.input)}
                  value={worktreeParent}
                  disabled={locationSettingsLoading || worktreeSettingsSaving}
                  onChange={(event) => {
                    setWorktreeParent(event.target.value);
                    setWorktreeSettingsSaved(false);
                  }}
                />
              </label>
              <p {...stylex.props(settings.hint)}>
                Stored in the application database and shared by browsers using this server. Default
                is {DEFAULT_WORKTREE_PARENT_PATH}.
              </p>
              {worktreeSettingsError ? (
                <p {...stylex.props(settings.error)} role="alert">
                  {worktreeSettingsError}
                </p>
              ) : null}
              <div {...stylex.props(settings.actions)}>
                <span {...stylex.props(settings.saved)}>
                  {worktreeSettingsSaved ? "Preference saved" : ""}
                </span>
                <button
                  {...stylex.props(settings.saveButton)}
                  type="submit"
                  disabled={locationSettingsLoading || worktreeSettingsSaving}
                >
                  {worktreeSettingsSaving ? "Saving…" : "Save worktree location"}
                </button>
              </div>
            </form>
          </section>

          <section {...stylex.props(settings.intro, settings.preferenceIntro)}>
            <span {...stylex.props(settings.eyebrow)}>PASEO</span>
            <h2 {...stylex.props(settings.preferenceHeading)}>Connect Paseo instances.</h2>
            <p {...stylex.props(settings.lede)}>
              Configure the CLI executable or checkout, optional home, and host for discovery and
              delivery.
            </p>
          </section>
          <section {...stylex.props(settings.card, settings.preferenceCard)}>
            <form
              {...stylex.props(settings.form)}
              onSubmit={(event) => {
                event.preventDefault();
                void savePaseoSettings();
              }}
            >
              <div {...stylex.props(settings.instanceList)}>
                {paseoInstances.map((instance, index) => (
                  <div key={`paseo-${index}`} {...stylex.props(settings.instanceCard)}>
                    <div {...stylex.props(settings.instanceHeader)}>
                      <span {...stylex.props(settings.instanceTitle)}>
                        INSTANCE {index + 1}
                        {instance.id.trim() ? ` · ${instance.id.trim()}` : ""}
                      </span>
                      <button
                        {...stylex.props(settings.removeButton)}
                        type="button"
                        disabled={paseoSettingsSaving}
                        onClick={() => void removePaseoInstance(index)}
                      >
                        Remove
                      </button>
                    </div>
                    <div {...stylex.props(settings.fieldStack)}>
                      <label {...stylex.props(settings.label)}>
                        INSTANCE ID
                        <input
                          {...stylex.props(settings.input)}
                          value={instance.id}
                          onChange={(event) =>
                            updatePaseoInstance(index, { id: event.target.value })
                          }
                        />
                      </label>
                      <label {...stylex.props(settings.label)}>
                        SERVER ID
                        <input
                          {...stylex.props(settings.input)}
                          value={instance.serverId ?? ""}
                          placeholder="srv_…"
                          onChange={(event) =>
                            updatePaseoInstance(index, { serverId: event.target.value })
                          }
                        />
                      </label>
                      <label {...stylex.props(settings.label)}>
                        LOCAL URL
                        <input
                          {...stylex.props(settings.input)}
                          value={instance.localUrl ?? ""}
                          placeholder="http://localhost:6767"
                          onChange={(event) =>
                            updatePaseoInstance(index, { localUrl: event.target.value })
                          }
                        />
                      </label>
                      <label {...stylex.props(settings.label)}>
                        TAILSCALE URL
                        <input
                          {...stylex.props(settings.input)}
                          value={instance.tailscaleUrl ?? ""}
                          placeholder="https://paseo.example.ts.net"
                          onChange={(event) =>
                            updatePaseoInstance(index, { tailscaleUrl: event.target.value })
                          }
                        />
                      </label>
                      <label {...stylex.props(settings.label)}>
                        BIN PATH (EXECUTABLE OR CHECKOUT)
                        <input
                          {...stylex.props(settings.input)}
                          value={instance.binPath ?? ""}
                          placeholder="paseo on PATH, /path/to/paseo, or checkout"
                          onChange={(event) =>
                            updatePaseoInstance(index, { binPath: event.target.value })
                          }
                        />
                      </label>
                      <label {...stylex.props(settings.label)}>
                        HOME (OPTIONAL)
                        <input
                          {...stylex.props(settings.input)}
                          value={instance.home ?? ""}
                          placeholder="~/.paseo"
                          onChange={(event) =>
                            updatePaseoInstance(index, { home: event.target.value })
                          }
                        />
                      </label>
                      <label {...stylex.props(settings.label)}>
                        HOST
                        <input
                          {...stylex.props(settings.input)}
                          value={instance.host}
                          placeholder="127.0.0.1:6767"
                          onChange={(event) =>
                            updatePaseoInstance(index, { host: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              {paseoSettingsError ? (
                <p {...stylex.props(settings.error)} role="alert">
                  {paseoSettingsError}
                </p>
              ) : null}
              <div {...stylex.props(settings.actions)}>
                <span {...stylex.props(settings.saved)}>
                  {paseoSettingsSaved ? "Instances saved" : ""}
                </span>
                <button
                  {...stylex.props(settings.secondaryButton)}
                  type="button"
                  onClick={() =>
                    setPaseoInstances((current) => [
                      ...current,
                      createEmptyPaseoInstance(
                        current.some((instance) => instance.id === "default")
                          ? { id: "worktree" }
                          : {},
                      ),
                    ])
                  }
                >
                  Add instance
                </button>
                <button
                  {...stylex.props(settings.saveButton)}
                  type="submit"
                  disabled={locationSettingsLoading || paseoSettingsSaving}
                >
                  {paseoSettingsSaving ? "Saving…" : "Save Paseo instances"}
                </button>
              </div>
            </form>
          </section>

          <section {...stylex.props(settings.intro, settings.preferenceIntro)}>
            <span {...stylex.props(settings.eyebrow)}>JARVIS</span>
            <h2 {...stylex.props(settings.preferenceHeading)}>
              Choose where new Jarvis workspaces live.
            </h2>
            <p {...stylex.props(settings.lede)}>
              Create Jarvis Session scaffolds a named folder here from the Jarvis template.
            </p>
          </section>

          <section {...stylex.props(settings.card, settings.preferenceCard)}>
            <form
              {...stylex.props(settings.form)}
              onSubmit={(event) => {
                event.preventDefault();
                void saveJarvisSettings();
              }}
            >
              <label {...stylex.props(settings.label)}>
                PREFERRED JARVIS PARENT
                <input
                  {...stylex.props(settings.input)}
                  value={jarvisParent}
                  disabled={locationSettingsLoading || jarvisSettingsSaving}
                  onChange={(event) => {
                    setJarvisParent(event.target.value);
                    setJarvisSettingsSaved(false);
                  }}
                />
              </label>
              <p {...stylex.props(settings.hint)}>
                Stored in the application database and shared by browsers using this server. Default
                is {DEFAULT_JARVIS_PARENT_PATH}. Creating &quot;the jarvis&quot; yields{" "}
                {DEFAULT_JARVIS_PARENT_PATH}/the-jarvis.
              </p>
              {jarvisSettingsError ? (
                <p {...stylex.props(settings.error)} role="alert">
                  {jarvisSettingsError}
                </p>
              ) : null}
              <div {...stylex.props(settings.actions)}>
                <span {...stylex.props(settings.saved)}>
                  {jarvisSettingsSaved ? "Preference saved" : ""}
                </span>
                <button
                  {...stylex.props(settings.saveButton)}
                  type="submit"
                  disabled={locationSettingsLoading || jarvisSettingsSaving}
                >
                  {jarvisSettingsSaving ? "Saving…" : "Save Jarvis location"}
                </button>
              </div>
            </form>
          </section>

          <section {...stylex.props(settings.intro, settings.preferenceIntro)}>
            <span {...stylex.props(settings.eyebrow)}>T3 SERVER</span>
            <h2 {...stylex.props(settings.preferenceHeading)}>Connect one or more T3 instances.</h2>
            <p {...stylex.props(settings.lede)}>
              Each instance has an id, a T3 checkout (bin path), a T3 data home, an API origin URL,
              and whether it is a dev server. Add as many as you need and edit them anytime.
            </p>
          </section>

          <section {...stylex.props(settings.card, settings.preferenceCard)}>
            <form
              {...stylex.props(settings.form)}
              onSubmit={(event) => {
                event.preventDefault();
                void saveT3Settings();
              }}
            >
              <div {...stylex.props(settings.instanceList)}>
                {t3Instances.length === 0 ? (
                  <p {...stylex.props(settings.emptyState)}>
                    No T3 server instances yet. Add one to get started. New instances default to id
                    &quot;default&quot;.
                  </p>
                ) : (
                  t3Instances.map((instance, index) => (
                    <div key={`t3-instance-${index}`} {...stylex.props(settings.instanceCard)}>
                      <div {...stylex.props(settings.instanceHeader)}>
                        <span {...stylex.props(settings.instanceTitle)}>
                          INSTANCE {index + 1}
                          {instance.id.trim() ? ` · ${instance.id.trim()}` : ""}
                        </span>
                        <button
                          {...stylex.props(settings.removeButton)}
                          type="button"
                          disabled={locationSettingsLoading || t3SettingsSaving}
                          onClick={() => removeT3Instance(index)}
                        >
                          Remove
                        </button>
                      </div>
                      <div {...stylex.props(settings.fieldStack)}>
                        <label {...stylex.props(settings.label)}>
                          INSTANCE ID
                          <input
                            {...stylex.props(settings.input)}
                            value={instance.id}
                            disabled={locationSettingsLoading || t3SettingsSaving}
                            onChange={(event) =>
                              updateT3Instance(index, { id: event.target.value })
                            }
                            placeholder="default"
                            autoComplete="off"
                          />
                        </label>
                        <label {...stylex.props(settings.label)}>
                          BIN PATH (T3 CHECKOUT)
                          <input
                            {...stylex.props(settings.input)}
                            value={instance.binPath ?? ""}
                            disabled={locationSettingsLoading || t3SettingsSaving}
                            onChange={(event) =>
                              updateT3Instance(index, { binPath: event.target.value })
                            }
                            placeholder="/path/to/your/t3code-checkout"
                            autoComplete="off"
                          />
                        </label>
                        <label {...stylex.props(settings.label)}>
                          BASE DIR (T3 DATA HOME)
                          <input
                            {...stylex.props(settings.input)}
                            value={instance.baseDir}
                            disabled={locationSettingsLoading || t3SettingsSaving}
                            onChange={(event) =>
                              updateT3Instance(index, { baseDir: event.target.value })
                            }
                            placeholder="~/.t3"
                            autoComplete="off"
                          />
                        </label>
                        <label {...stylex.props(settings.label)}>
                          ORIGIN URL (API)
                          <input
                            {...stylex.props(settings.input)}
                            value={instance.originUrl}
                            disabled={locationSettingsLoading || t3SettingsSaving}
                            onChange={(event) =>
                              updateT3Instance(index, { originUrl: event.target.value })
                            }
                            placeholder="http://localhost:5470/"
                            autoComplete="off"
                          />
                        </label>
                        <label {...stylex.props(settings.checkboxLabel)}>
                          <input
                            type="checkbox"
                            checked={instance.isDev}
                            disabled={locationSettingsLoading || t3SettingsSaving}
                            onChange={(event) =>
                              updateT3Instance(index, { isDev: event.target.checked })
                            }
                          />
                          Dev mode (use baseDir/dev auth store; leave off for userdata)
                        </label>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <p {...stylex.props(settings.hint)}>
                Stored in the application database and shared by browsers using this server.
                Instance ids must be unique. Bin path is the T3 checkout containing
                <code>apps/server/dist/bin.mjs</code>; base dir is T3CODE_HOME (data). Origin is the
                API host (worktree APIs may differ from the web UI port). Dev mode mints against the{" "}
                <code>dev</code> state store; off uses <code>userdata</code>.
              </p>
              {t3SettingsError ? (
                <p {...stylex.props(settings.error)} role="alert">
                  {t3SettingsError}
                </p>
              ) : null}
              <div {...stylex.props(settings.actions)}>
                <button
                  {...stylex.props(settings.secondaryButton)}
                  type="button"
                  disabled={locationSettingsLoading || t3SettingsSaving}
                  onClick={addT3Instance}
                >
                  Add instance
                </button>
                <div {...stylex.props(settings.actionsEnd)}>
                  <span {...stylex.props(settings.saved)}>
                    {t3SettingsSaved ? "Instances saved" : ""}
                  </span>
                  <button
                    {...stylex.props(settings.saveButton)}
                    type="submit"
                    disabled={locationSettingsLoading || t3SettingsSaving}
                  >
                    {t3SettingsSaving ? "Saving…" : "Save T3 instances"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
