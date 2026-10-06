import { FC, ReactNode, useEffect, useState } from "react";
import { DialogButton, Focusable, Menu, MenuItem, showContextMenu, showModal } from "@decky/ui";
import { FaBullseye, FaCheck, FaExchangeAlt, FaPen, FaPlus, FaStickyNote } from "react-icons/fa";
import { backend } from "../api/backend";
import { useRunningGame } from "../hooks/useAppLifetime";
import { NotesProvider, useGame } from "../state/NotesProvider";
import { useDataVersion, useSettings } from "../state/notesStore";
import { getPlace, setPlace } from "../state/place";
import { rememberFolder } from "../state/resume";
import { Game, GameSummary } from "../types";
import { NoteList } from "../components/NoteList";
import { gameArt } from "../components/Library";
import { Loading, errorText } from "../components/Loading";
import { TomeFrame } from "./TomeFrame";
import { TomePickerModal } from "./TomePicker";
import { TomeWheelModal } from "./RadialPicker";
import { moveTome, resetGameLayout, setCollapsed, setTomeOn, useArrangement, useForAllGames } from "./layout";
import { TomeProps } from "./registry";
import { takeWheelRequest, useWheelRequest } from "./wheel";
import { Hint } from "./bits";
import "./builtin";
import * as s from "../components/styles";

// The Desk: the first tab. It follows the game you're playing (or the one you played last) and shows your
// Tomes for it, one stream you can reorder, fold and add to.

let lastDeskGame: string | null = null;
/** The running game the Desk last switched to; a game launched after that takes the Desk over. */
let followed: string | null = null;

type GoTab = TomeProps["goTab"];

export const Desk: FC<{ fullScreen: boolean; goTab: GoTab }> = ({ fullScreen, goTab }) => {
  const running = useRunningGame();
  const version = useDataVersion();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [appId, setAppIdState] = useState<string | null>(() => {
    const p = getPlace();
    if (running && running.appId !== followed) {
      followed = running.appId;
      return running.appId;
    }
    return lastDeskGame ?? (p.tab === "desk" ? p.appId : null) ?? running?.appId ?? null;
  });
  const [view, setViewState] = useState<"desk" | "notes">(() => getPlace().deskView ?? "desk");
  const [editing, setEditing] = useState(false);

  const setAppId = (id: string | null) => {
    lastDeskGame = id;
    setPlace({ appId: id, folderId: null, note: null, deskView: "desk" });
    setViewState("desk");
    setAppIdState(id);
  };
  const setView = (v: "desk" | "notes") => {
    setPlace({ deskView: v, ...(v === "desk" ? { folderId: null, note: null } : {}) });
    setViewState(v);
  };

  useEffect(() => setPlace({ appId, deskView: view }), []);
  const loadGames = () => {
    setGamesError(null);
    backend.listGames().then(setGames, (e) => {
      console.error("Desk of Madness: list_games failed", e);
      setGamesError(errorText(e));
    });
  };
  useEffect(loadGames, [version]);

  // A game starting takes over the Desk.
  useEffect(() => {
    if (running && running.appId !== followed) {
      followed = running.appId;
      setAppId(running.appId);
      setView("desk");
    }
  }, [running?.appId]);

  // Nothing picked yet: the game played last.
  useEffect(() => {
    if (appId || !games?.length) return;
    const last = [...games].sort((a, b) => (b.lastLaunched ?? 0) - (a.lastLaunched ?? 0))[0];
    if (last) setAppId(last.appId);
  }, [games, appId]);

  // The Tome wheel's combo (full-screen page only; the panel has its own button for it).
  const wheel = useWheelRequest();
  useEffect(() => {
    if (!fullScreen || !wheel) return;
    const r = takeWheelRequest();
    if (!r) return;
    setView("desk");
    showModal(<TomeWheelModal appId={appId} combo={r.combo} />);
  }, [wheel, fullScreen]);

  const summary = games?.find((g) => g.appId === appId) ?? null;
  const live = !!running && running.appId === appId;

  const pickGame = () => {
    const recent = [...(games ?? [])]
      .filter((g) => g.launchCount > 0 || g.noteCount > 0)
      .sort((a, b) => (b.lastLaunched ?? 0) - (a.lastLaunched ?? 0))
      .slice(0, 12);
    showContextMenu(
      <Menu label="Show the Desk for">
        {running && (
          <MenuItem onSelected={() => setAppId(running.appId)}>
            ● {running.name} (playing)
          </MenuItem>
        )}
        {recent
          .filter((g) => g.appId !== running?.appId)
          .map((g) => (
            <MenuItem key={g.appId} onSelected={() => setAppId(g.appId)}>
              {g.name}
            </MenuItem>
          ))}
        <MenuItem onSelected={() => goTab("all")}>All games…</MenuItem>
      </Menu>
    );
  };

  if (view === "notes" && appId) {
    return (
      <NotesProvider key={appId} appId={appId}>
        <NoteList live={live} onBack={() => setView("desk")} backLabel="Desk" />
      </NotesProvider>
    );
  }

  const header = (
    <DeskHeader
      name={summary?.name ?? (games ? "No game yet" : "")}
      appId={appId}
      live={live}
      fullScreen={fullScreen}
      editing={editing}
      onPickGame={pickGame}
      onEdit={() => setEditing((e) => !e)}
      onAdd={() => showModal(<TomePickerModal appId={appId} gameName={summary?.name} />)}
      onWheel={() => showModal(<TomeWheelModal appId={appId} />)}
      onNotes={appId ? () => setView("notes") : undefined}
    />
  );

  const props = {
    live,
    fullScreen,
    editing,
    goTab,
    showNotes: (folderId?: string | null) => {
      if (!appId) return;
      rememberFolder(appId, folderId ?? null);
      setView("notes");
    },
  };

  if (!games) return <Loading error={gamesError} onRetry={loadGames} what="your games" />;

  return (
    <div>
      {header}
      {appId ? (
        <NotesProvider key={appId} appId={appId}>
          <GameDesk appId={appId} {...props} />
        </NotesProvider>
      ) : (
        <>
          <div style={{ opacity: 0.75, fontSize: "14px", margin: "4px 0 12px" }}>
            Launch a game and the Desk fills in with its notes, checklists and counters.
          </div>
          <DeskStream appId={null} game={null} {...props} />
        </>
      )}
    </div>
  );
};

const GameDesk: FC<Omit<StreamProps, "game">> = (props) => {
  const { game, error, refresh } = useGame();
  if (!game) return <Loading error={error} onRetry={refresh} what="this game's notes" />;
  return <DeskStream {...props} game={game} />;
};

// Compact mode: tighter Tomes and lines, so more fit in the Quick Access menu.
const COMPACT_CSS = `
.dom-compact .dom-tome { padding: 4px 8px !important; margin-bottom: 6px !important; }
.dom-compact .dom-line { padding: 4px 8px !important; margin-bottom: 2px !important; }
.dom-compact .dom-sub { display: none; }
`;

interface StreamProps extends Omit<TomeProps, "game"> {
  appId: string | null;
  game: Game | null;
  editing: boolean;
}

/** The Tomes that are on, in order; in edit mode with buttons to move and hide them. */
const DeskStream: FC<StreamProps> = ({ appId, game, editing, ...rest }) => {
  const { items, own, perGame } = useArrangement(appId);
  const compact = !!useSettings().desk?.compact;
  const on = items.filter((x) => x.on);
  const shown = on.filter((x) => editing || !(x.def.needsGame && !game) && !x.def.isEmpty?.(game));
  const tomeProps: TomeProps = { ...rest, game };

  return (
    <>
      {compact && <style>{COMPACT_CSS}</style>}
      <div className={compact ? "dom-compact" : undefined} style={rest.fullScreen ? { columnCount: 2, columnGap: "12px" } : undefined}>
        {shown.map(({ def, collapsed }, i) => {
          const Tome = def.component;
          return (
            <TomeFrame
              key={def.id}
              id={def.id}
              icon={def.icon}
              name={def.name}
              collapsed={collapsed}
              editing={editing}
              isFirst={i === 0}
              isLast={i === shown.length - 1}
              onToggle={() => setCollapsed(appId, def.id, !collapsed)}
              onMove={(by) => moveTome(appId, def.id, by)}
              onHide={() => setTomeOn(appId, def.id, false)}
            >
              {def.needsGame && !game ? <Hint>Pick a game to use this Tome.</Hint> : <Tome {...tomeProps} />}
            </TomeFrame>
          );
        })}
      </div>
      {shown.length === 0 && (
        <Hint>
          Your Desk is empty. Press <FaPlus size={10} /> to add Tomes.
        </Hint>
      )}
      {editing && (
        <Focusable style={{ ...s.toolbar, marginTop: "4px", fontSize: "13px" }}>
          <div style={{ flex: "1 1 100%", opacity: 0.75 }}>
            {appId && perGame
              ? own
                ? `This layout is just for ${game?.name ?? "this game"}.`
                : `Changes make a layout just for ${game?.name ?? "this game"}.`
              : "This layout is used for every game."}
          </div>
          {appId && own && (
            <>
              <DialogButton style={s.smallButton} onClick={() => useForAllGames(appId)}>
                Use for all games
              </DialogButton>
              <DialogButton style={s.smallButton} onClick={() => resetGameLayout(appId)}>
                Reset to the all-games layout
              </DialogButton>
            </>
          )}
        </Focusable>
      )}
    </>
  );
};

const DeskHeader: FC<{
  name: string;
  appId: string | null;
  live: boolean;
  fullScreen: boolean;
  editing: boolean;
  onPickGame: () => void;
  onEdit: () => void;
  onAdd: () => void;
  onWheel: () => void;
  onNotes?: () => void;
}> = ({ name, appId, live, fullScreen, editing, onPickGame, onEdit, onAdd, onWheel, onNotes }) => {
  const [hint, setHint] = useState("");
  const art = appId ? gameArt(appId) : undefined;
  const actions: { label: string; icon: ReactNode; run: () => void; primary?: boolean }[] = [
    ...(onNotes ? [{ label: "All notes for this game", icon: <FaStickyNote />, run: onNotes, primary: true }] : []),
    { label: "Switch game", icon: <FaExchangeAlt />, run: onPickGame },
    { label: "Add Tomes", icon: <FaPlus />, run: onAdd },
    { label: "Tome wheel", icon: <FaBullseye />, run: onWheel },
    { label: editing ? "Done editing" : "Edit Desk", icon: editing ? <FaCheck /> : <FaPen />, run: onEdit },
  ];
  return (
    <div style={{ marginBottom: "10px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          minHeight: fullScreen && art ? "70px" : undefined,
          padding: art ? "8px 10px" : 0,
          borderRadius: "8px",
          background: art ? `linear-gradient(90deg, rgba(14,20,27,0.92) 40%, rgba(14,20,27,0.55)), url("${art}") center/cover` : undefined,
        }}
      >
        <div style={{ ...s.title, fontSize: fullScreen ? "22px" : "18px", flex: 1 }}>{name}</div>
        {live && <span style={{ ...s.chip, background: "#2d7d2d", opacity: 1 }}>● Playing</span>}
      </div>
      <Focusable flow-children="row" style={{ ...s.toolbar, flexWrap: "nowrap", marginTop: "8px" }}>
        {actions.map((a) => (
          <DialogButton
            key={a.label}
            style={a.primary ? s.primaryIconButton : editing && a.label === "Done editing" ? { ...s.iconButton, background: "#2d7d2d" } : s.iconButton}
            onClick={a.run}
            onGamepadFocus={() => setHint(a.label)}
            onMouseEnter={() => setHint(a.label)}
            {...({ title: a.label, "aria-label": a.label } as any)}
          >
            {a.icon}
          </DialogButton>
        ))}
        <div style={s.iconHint}>{hint}</div>
      </Focusable>
    </div>
  );
};
