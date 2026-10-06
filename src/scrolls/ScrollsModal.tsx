import { FC, useEffect, useState } from "react";
import { DialogButton, Focusable, ModalRoot, Spinner, ToggleField, showModal } from "@decky/ui";
import { toaster } from "@decky/api";
import { backend } from "../api/backend";
import { useSettings } from "../state/notesStore";
import { useServerInfo } from "../state/speech";
import { InstalledScroll, WorkshopScroll } from "../types";
import { errText } from "../utils/errors";
import * as s from "../components/styles";
import { installScroll, removeScroll, setScrollEnabled, useScrolls } from "./host";

// 📜 Scrolls: what's installed (on/off, settings, updates, remove) and what the Workshop has.

const newer = (a: string, b: string) => {
  const parse = (v: string) => {
    const [main, pre] = v.split("-", 2);
    return { nums: main.split(".").map((x) => parseInt(x, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) > (y.nums[i] ?? 0);
  if (!x.pre !== !y.pre) return !x.pre; // 1.0.0 is newer than 1.0.0-beta.1
  return (x.pre ?? "").localeCompare(y.pre ?? "", undefined, { numeric: true }) > 0;
};

const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);

const KindChip: FC<{ kind?: string; signed?: boolean }> = ({ kind, signed }) =>
  kind === "code" ? (
    <span style={s.chip}>{signed ? "🔏 Code, signed by the Workshop" : "⚠️ Code, not signed"}</span>
  ) : (
    <span style={s.chip}>📄 Data only</span>
  );

/** A Workshop Scroll's page: what it does and what it touches, with Install. */
const ScrollDetail: FC<{ id: string; onDone: () => void; closeModal?: () => void }> = ({ id, onDone, closeModal }) => {
  const [scroll, setScroll] = useState<WorkshopScroll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { installed } = useScrolls();
  const allowed = useServerInfo().allowedScrolls ?? [];
  useEffect(() => {
    backend.bsScroll(id).then(setScroll).catch((e) => setError(errText(e)));
  }, [id]);
  const have = installed.find((x) => x.id === id);
  const install = async () => {
    setBusy(true);
    try {
      const meta = await installScroll(id);
      toaster.toast({ title: "📜 Scrolls", body: `${have ? "Updated" : "Installed"} ${meta.name} ${meta.version}.` });
      onDone();
      closeModal?.();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };
  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      {error && <div style={{ color: "#ff6b6b", marginBottom: "8px" }}>⚠️ {error}</div>}
      {!scroll && !error && <Spinner style={{ width: "28px" }} />}
      {scroll && (
        <>
          <h2 style={{ margin: "0 0 4px" }}>
            {scroll.icon} {scroll.name}
          </h2>
          <div style={{ fontSize: "13px", opacity: 0.75 }}>
            {scroll.version} · by {scroll.author.name} · {kb(scroll.size)} · installed {scroll.installs}×
          </div>
          <div style={{ ...s.chipRow, margin: "8px 0" }}>
            <KindChip kind={scroll.kind} signed={scroll.signed} />
            {scroll.official && <span style={s.chip}>⭐ Official</span>}
          </div>
          {scroll.description ? (
            <p style={{ fontSize: "14px", whiteSpace: "pre-wrap" }}>{scroll.description}</p>
          ) : (
            <p style={{ fontSize: "14px" }}>{scroll.summary}</p>
          )}
          {scroll.permissions.length > 0 && (
            <>
              <div style={s.sectionLabel}>What it can do</div>
              {scroll.permissions.map((p) => (
                <div key={p.id} style={{ fontSize: "13px", padding: "2px 0" }}>
                  • {p.text}
                </div>
              ))}
              <div style={{ fontSize: "12px", opacity: 0.65, marginTop: "6px" }}>
                Code Scrolls run inside Steam like Desk itself. This one was reviewed and signed by the Workshop's owner.
              </div>
            </>
          )}
          {allowed.length > 0 && !allowed.includes(scroll.id) && (
            <div style={{ fontSize: "13px", color: "#ffc82c", marginTop: "8px" }}>Your Desk server's admin hasn't allowed this Scroll.</div>
          )}
          <Focusable style={{ ...s.toolbar, marginTop: "12px" }}>
            {(!have || (have.version && newer(scroll.version, have.version)) || have.broken) && (
              <DialogButton style={s.primaryButton} disabled={busy} onClick={install}>
                {busy ? "Installing…" : have ? `Update to ${scroll.version}` : "Install"}
              </DialogButton>
            )}
            {have && !have.broken && have.version === scroll.version && <span style={s.chip}>✓ Installed</span>}
            <DialogButton style={s.smallButton} onClick={() => closeModal?.()}>
              Close
            </DialogButton>
          </Focusable>
        </>
      )}
    </ModalRoot>
  );
};

const InstalledRow: FC<{ scroll: InstalledScroll; latest?: WorkshopScroll }> = ({ scroll, latest }) => {
  const settings = useSettings();
  const { status, settingsPage } = useScrolls();
  const state = settings.scrolls?.[scroll.id] ?? {};
  const st = status(scroll.id);
  const Page = settingsPage(scroll.id);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toaster.toast({ title: "📜 Scrolls", body: errText(e) });
    }
    setBusy(false);
  };
  const update = latest && scroll.version && newer(latest.version, scroll.version) ? latest.version : null;
  return (
    <div style={{ ...s.row, display: "block", padding: "8px 12px" }}>
      <ToggleField
        label={`${scroll.icon ?? "📜"} ${scroll.name}`}
        description={
          scroll.broken
            ? `⚠️ ${scroll.broken}`
            : st.state === "error"
              ? `⚠️ Couldn't start: ${st.error}`
              : state.offReason && !state.enabled
                ? `Turned itself off: ${state.offReason}`
                : scroll.summary
        }
        checked={!!state.enabled && !scroll.broken}
        disabled={!!scroll.broken || busy}
        onChange={(on) => act(() => setScrollEnabled(scroll.id, on))}
      />
      <Focusable flow-children="row" style={{ ...s.toolbar, marginBottom: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", opacity: 0.7 }}>
          {scroll.version} · {kb(scroll.size)} · {scroll.kind === "code" ? (scroll.signed ? "🔏 signed code" : "code") : "📄 data"}
          {st.state === "on" ? " · running" : st.state === "starting" ? " · starting…" : ""}
        </span>
        {Page && st.state === "on" && (
          <DialogButton style={s.smallButton} onClick={() => showModal(<Page />)}>
            ⚙ Settings
          </DialogButton>
        )}
        {update && (
          <DialogButton style={s.primaryButton} disabled={busy} onClick={() => act(() => installScroll(scroll.id))}>
            Update to {update}
          </DialogButton>
        )}
        <DialogButton style={s.smallButton} disabled={busy} onClick={() => act(() => removeScroll(scroll.id))}>
          Remove
        </DialogButton>
      </Focusable>
    </div>
  );
};

export const ScrollsModal: FC<{ start?: "installed" | "workshop"; closeModal?: () => void }> = ({ start, closeModal }) => {
  const { installed } = useScrolls();
  const [tab, setTab] = useState<"installed" | "workshop">(start ?? (installed.length ? "installed" : "workshop"));
  const [list, setList] = useState<WorkshopScroll[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    backend.bsScrolls().then(setList).catch((e) => setError(errText(e)));
  };
  useEffect(load, []);
  const latest = (id: string) => list?.find((x) => x.id === id);
  const updates = installed.filter((x) => x.version && latest(x.id) && newer(latest(x.id)!.version, x.version)).length;

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize>
      <h2 style={{ margin: "0 0 4px" }}>📜 Scrolls</h2>
      <div style={{ fontSize: "13px", opacity: 0.75, marginBottom: "8px" }}>
        Add-ons for your Desk from the Madness Workshop: new Tomes, Steam tweaks, link lists and more.
      </div>
      <Focusable flow-children="row" style={s.toolbar}>
        <DialogButton style={tab === "installed" ? s.primaryButton : s.smallButton} onClick={() => setTab("installed")}>
          Installed ({installed.length}){updates ? ` · ${updates} update${updates === 1 ? "" : "s"}` : ""}
        </DialogButton>
        <DialogButton style={tab === "workshop" ? s.primaryButton : s.smallButton} onClick={() => setTab("workshop")}>
          🏭 From the Workshop
        </DialogButton>
      </Focusable>
      <Focusable style={{ maxHeight: "60vh", overflowY: "auto" }}>
        {tab === "installed" && (
          <>
            {installed.length === 0 && <div style={{ opacity: 0.7, padding: "8px 0" }}>No Scrolls yet. Find some under 🏭 From the Workshop.</div>}
            {installed.map((x) => (
              <InstalledRow key={x.id} scroll={x} latest={latest(x.id)} />
            ))}
          </>
        )}
        {tab === "workshop" && (
          <>
            {error && <div style={{ opacity: 0.8 }}>⚠️ {error}</div>}
            {!list && !error && <Spinner style={{ width: "28px" }} />}
            {list?.length === 0 && <div style={{ opacity: 0.7 }}>The Workshop has no Scrolls yet.</div>}
            {list?.map((x) => {
              const have = installed.find((i) => i.id === x.id);
              return (
                <Focusable
                  key={x.id}
                  style={s.row}
                  onActivate={() => showModal(<ScrollDetail id={x.id} onDone={load} />)}
                  onClick={() => showModal(<ScrollDetail id={x.id} onDone={load} />)}
                >
                  <span style={{ fontSize: "20px", width: "28px", textAlign: "center" }}>{x.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.title}>
                      {x.name} {x.official && "⭐"}
                    </div>
                    <div style={{ fontSize: "12px", opacity: 0.7 }}>{x.summary}</div>
                  </div>
                  <span style={s.chip}>
                    {have ? (have.version && newer(x.version, have.version) ? "Update" : "✓ Installed") : x.kind === "code" ? "🔏 Code" : "📄 Data"}
                  </span>
                </Focusable>
              );
            })}
          </>
        )}
      </Focusable>
      <DialogButton style={{ ...s.smallButton, marginTop: "10px" }} onClick={() => closeModal?.()}>
        Close
      </DialogButton>
    </ModalRoot>
  );
};

export const openScrolls = (start?: "installed" | "workshop") => showModal(<ScrollsModal start={start} />);
