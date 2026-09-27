export type NoteType = "quick" | "checklist" | "death" | "milestone" | "hint";

export interface Note {
  id: string;
  runProfileId: string;
  sessionId?: string;
  type: NoteType;
  tags: string[];
  body: string;
  screenshotPath?: string;
  pinned: boolean;
  archived: boolean;
  timestamp: number;
}

export interface Session {
  id: string;
  runProfileId: string;
  start: number;
  end?: number;
  moodRating?: number;
  summary?: string;
}

export interface RunProfile {
  id: string;
  appId: string;
  label: string;
  createdAt: number;
}

export interface Settings {
  breakReminderMinutes?: number;
  syncPath?: string;
}
