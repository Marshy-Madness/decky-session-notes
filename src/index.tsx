import { definePlugin } from "@decky/api";
import { FaRegStickyNote } from "react-icons/fa";
import { QuickAccessPanel } from "./components/QuickAccessPanel";

export default definePlugin(() => ({
  name: "Session Notes",
  titleView: <div>Session Notes</div>,
  content: <QuickAccessPanel />,
  icon: <FaRegStickyNote />,
  onDismount() {},
}));
