import { FC, ReactNode } from "react";
import { DialogButton, Focusable, Menu, MenuItem, showContextMenu, showModal, ConfirmModal } from "@decky/ui";
import { FaMinus, FaPlus, FaSkull, FaDragon, FaHashtag, FaCheck } from "react-icons/fa";
import { backend } from "../api/backend";
import { emitDataChanged } from "../state/notesStore";
import { Counter, CounterKind, Game } from "../types";
import { newId } from "../utils/format";
import { NameModal } from "./NameModal";
import * as s from "./styles";

const ICON: Record<CounterKind, ReactNode> = {
  death: <FaSkull />,
  boss: <FaDragon />,
  custom: <FaHashtag />,
};

const KIND_LABEL: Record<CounterKind, string> = {
  death: "Death counter",
  boss: "Boss attempts",
  custom: "Custom counter",
};

const DEFAULT_NAME: Record<CounterKind, string> = { death: "Deaths", boss: "", custom: "" };

export function addCounter(appId: string) {
  const create = (kind: CounterKind) =>
    showModal(
      <NameModal
        heading={`New ${KIND_LABEL[kind].toLowerCase()}`}
        label={kind === "boss" ? "Boss name" : "Name"}
        initial={DEFAULT_NAME[kind]}
        onSubmit={async (name) => {
          await backend.saveCounter(appId, { id: newId(), name, kind, count: 0, sessionCount: 0, createdAt: 0 });
          emitDataChanged();
        }}
      />
    );
  showContextMenu(
    <Menu label="Add counter">
      <MenuItem onSelected={() => create("death")}>💀 Death counter</MenuItem>
      <MenuItem onSelected={() => create("boss")}>⚔️ Boss attempts</MenuItem>
      <MenuItem onSelected={() => create("custom")}># Custom counter</MenuItem>
    </Menu>
  );
}

/** The counter's options menu: defeated, rename, reset, delete. */
export function counterMenu(appId: string, counter: Counter) {
  const save = async (patch: Partial<Counter>) => {
    await backend.saveCounter(appId, { ...counter, ...patch });
    emitDataChanged();
  };
  showContextMenu(
    <Menu label={counter.name}>
      {counter.kind === "boss" && (
        <MenuItem onSelected={() => save({ defeated: !counter.defeated })}>
          {counter.defeated ? "Mark not defeated" : "Mark defeated 🎉"}
        </MenuItem>
      )}
      <MenuItem
        onSelected={() =>
          showModal(<NameModal heading="Rename counter" initial={counter.name} onSubmit={(name) => save({ name })} />)
        }
      >
        Rename
      </MenuItem>
      <MenuItem onSelected={() => save({ count: 0, sessionCount: 0 })}>Reset to 0</MenuItem>
      <MenuItem
        tone="destructive"
        onSelected={() =>
          showModal(
            <ConfirmModal
              strTitle={`Delete "${counter.name}"?`}
              strOKButtonText="Delete"
              onOK={async () => {
                await backend.deleteCounter(appId, counter.id);
                emitDataChanged();
              }}
            />
          )
        }
      >
        Delete
      </MenuItem>
    </Menu>
  );
}

const CounterRow: FC<{ appId: string; counter: Counter }> = ({ appId, counter }) => {
  const bump = async (delta: number) => {
    await backend.bumpCounter(appId, counter.id, delta);
    emitDataChanged();
  };
  const options = () => counterMenu(appId, counter);

  return (
    <Focusable
      flow-children="row"
      style={{ ...s.row, padding: "6px 10px", marginBottom: "4px", opacity: counter.defeated ? 0.7 : 1 }}
      onOptionsButton={options}
      onOptionsActionDescription="Counter options"
    >
      <span style={{ opacity: 0.8 }}>{ICON[counter.kind]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...s.title, fontSize: "14px" }}>
          {counter.name}
          {counter.defeated && (
            <span style={{ ...s.chip, background: "#2d7d2d", marginLeft: "6px" }}>
              <FaCheck size={9} /> Defeated
            </span>
          )}
        </div>
        {counter.sessionCount > 0 && <div style={{ fontSize: "11px", opacity: 0.6 }}>+{counter.sessionCount} this session</div>}
      </div>
      <DialogButton style={{ ...s.smallButton, padding: "4px 10px" }} onClick={() => bump(-1)} disabled={counter.count === 0}>
        <FaMinus size={10} />
      </DialogButton>
      <div style={{ minWidth: "40px", textAlign: "center", fontSize: "18px", fontWeight: "bold" }}>{counter.count}</div>
      <DialogButton style={{ ...s.smallButton, padding: "4px 10px" }} onClick={() => bump(1)}>
        <FaPlus size={10} />
      </DialogButton>
      <DialogButton style={{ ...s.smallButton, padding: "4px 10px" }} onClick={options}>
        ⋯
      </DialogButton>
    </Focusable>
  );
};

/** Death / boss-attempt / custom counters for a game. */
export const Counters: FC<{ game: Game }> = ({ game }) => {
  const counters = [...(game.counters ?? [])].sort(
    (a, b) => Number(a.defeated ?? false) - Number(b.defeated ?? false) || a.createdAt - b.createdAt
  );
  if (counters.length === 0) return null;

  return (
    <div style={{ marginBottom: "8px" }}>
      {counters.map((c) => (
        <CounterRow key={c.id} appId={game.appId} counter={c} />
      ))}
    </div>
  );
};
