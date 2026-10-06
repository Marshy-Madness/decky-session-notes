import { getRunningGame } from "../hooks/useAppLifetime";

// Which game the Desk shows, kept between visits. The radial menu and the button combos point it at a game
// before opening the page.

export const deskGame = {
  /** The game the Desk showed last. */
  last: null as string | null,
  /** The running game the Desk last switched to; a game launched after that takes the Desk over. */
  followed: null as string | null,
};

/** Shows this game's Desk next time the page opens (without a newer game launch taking over). */
export function pointDeskAt(appId: string | null) {
  deskGame.last = appId;
  const running = getRunningGame();
  if (running) deskGame.followed = running.appId;
}
