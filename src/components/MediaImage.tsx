import { CSSProperties, FC, useEffect, useState } from "react";
import { backend } from "../api/backend";

const cache = new Map<string, Promise<string | null>>();

export function loadMedia(appId: string, file: string): Promise<string | null> {
  const key = `${appId}/${file}`;
  if (!cache.has(key)) cache.set(key, backend.getMedia(appId, file));
  return cache.get(key)!;
}

export const MediaImage: FC<{ appId: string; file: string; style?: CSSProperties }> = ({ appId, file, style }) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadMedia(appId, file).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [appId, file]);

  return src ? (
    <img src={src} style={{ objectFit: "cover", borderRadius: "4px", display: "block", ...style }} />
  ) : (
    <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: "4px", ...style }} />
  );
};
