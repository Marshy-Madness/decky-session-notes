import { FC, useEffect, useRef, useState } from "react";
import { DialogButton } from "@decky/ui";
import { FaPlay, FaStop } from "react-icons/fa";
import { Recording } from "../types";
import { formatClock } from "../utils/format";
import { loadMedia } from "./MediaImage";
import * as s from "./styles";

export const AudioButton: FC<{ appId: string; recording: Recording; label?: string }> = ({ appId, recording, label }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => audioRef.current?.pause(), []);

  const toggle = async () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (!audioRef.current) {
      const src = await loadMedia(appId, recording.file);
      if (!src) return;
      audioRef.current = new Audio(src);
      audioRef.current.onended = () => setPlaying(false);
    }
    audioRef.current.currentTime = 0;
    await audioRef.current.play();
    setPlaying(true);
  };

  return (
    <DialogButton style={s.smallButton} onClick={toggle}>
      {playing ? <FaStop size={11} /> : <FaPlay size={11} />} {label ?? "Voice note"}
      {recording.durationSec != null && ` (${formatClock(recording.durationSec)})`}
    </DialogButton>
  );
};
