import { cancel, isPermissionGranted, requestPermission, Schedule, sendNotification } from "@tauri-apps/plugin-notification";

// iOS itself delivers these, so they arrive even with LAAB closed.

const KEY = "chatReminders";
type Reminders = Record<string, { id: number; at: number }>;

function load(): Reminders {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Reminders;
  } catch {
    return {};
  }
}

const store = (r: Reminders) => localStorage.setItem(KEY, JSON.stringify(r));

/** When a chat's reminder will fire, if it has one still to come. */
export function reminderOf(chatId: string, now = Date.now()): number | null {
  const at = load()[chatId]?.at;
  return at && at > now ? at : null;
}

export async function allowNotifications(): Promise<boolean> {
  return (await isPermissionGranted()) || (await requestPermission()) === "granted";
}

/** Set a chat's one reminder, replacing any earlier one. */
export async function remind(chatId: string, chatName: string, at: Date) {
  if (!(await allowNotifications())) throw new Error("เปิดการแจ้งเตือนของ LAAB ใน Settings ก่อน");
  await cancelReminder(chatId);
  const id = at.getTime() % 2_000_000_000;
  sendNotification({
    id,
    title: chatName,
    body: "ถึงเวลาตอบแชทนี้แล้ว",
    schedule: Schedule.at(at),
    extra: { chatId },
  });
  store({ ...load(), [chatId]: { id, at: at.getTime() } });
}

/** Called on replying too: answering a chat settles its reminder. */
export async function cancelReminder(chatId: string) {
  const { [chatId]: old, ...rest } = load();
  if (!old) return;
  store(rest);
  await cancel([old.id]);
}
