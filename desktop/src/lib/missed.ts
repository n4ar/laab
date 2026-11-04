import { unreadTotal } from "./chatList";
import type { Chat, ChatList, Message } from "./types";

/** What a chat's unread messages hold, worked out on this device. */
export interface Missed {
  chat: Chat;
  /** The messages behind it, oldest first. */
  messages: Message[];
  senders: string[];
  mentioned: boolean;
  photos: number;
  files: number;
  links: number;
  latest: string;
}

const LABELS: Record<string, string> = {
  IMAGE: "รูปภาพ",
  VIDEO: "วิดีโอ",
  STICKER: "สติกเกอร์",
  FILE: "ไฟล์",
  AUDIO: "ข้อความเสียง",
};

export const messageLine = (m: Message) => m.text || (m.contentType === "FILE" && m.fileName) || LABELS[m.contentType] || "";

export const missedChats = (list: ChatList | undefined) =>
  (list?.chats ?? []).filter((c) => !c.muted && c.unread > 0).sort((a, b) => b.lastActivity - a.lastActivity);

/** "12 ข้อความใน 3 แชท", or null with nothing missed. */
export function missedLine(list: ChatList | undefined): string | null {
  const total = unreadTotal(list);
  return total > 0 ? `${total > 999 ? "999+" : total} ข้อความใน ${missedChats(list).length} แชท` : null;
}

/** `messages` are the chat's newest, in any order; the last `chat.unread`
 *  that others sent are the ones missed. */
export function summarize(chat: Chat, messages: Message[]): Missed {
  const theirs = messages
    .filter((m) => !m.mine && m.unsent === 0 && m.contentType !== "CHATEVENT")
    .sort((a, b) => a.createdTime - b.createdTime)
    .slice(-chat.unread);
  return {
    chat,
    messages: theirs,
    senders: [...new Set(theirs.flatMap((m) => (m.senderId ? [m.senderId] : [])))],
    mentioned: theirs.some((m) => m.mentionsMe),
    photos: theirs.filter((m) => m.contentType === "IMAGE" || m.contentType === "VIDEO").length,
    files: theirs.filter((m) => m.contentType === "FILE").length,
    links: theirs.filter((m) => m.text.includes("://")).length,
    latest: theirs.length ? messageLine(theirs[theirs.length - 1]) : chat.preview,
  };
}

/** Whoever called you by name first, then the newest. */
export const byImportance = (a: Missed, b: Missed) =>
  Number(b.mentioned) - Number(a.mentioned) || b.chat.lastActivity - a.chat.lastActivity;
