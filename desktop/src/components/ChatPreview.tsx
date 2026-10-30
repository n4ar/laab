import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { api, errorText, q, useChatList, usePeople, useSession } from "../lib/api";
import { isGroup, isKeepMemo } from "../lib/chatList";
import { openChat } from "../lib/nav";
import { phone } from "../lib/platform";
import { dismissTop, pushDismiss, setUi, ui, useUi } from "../lib/ui";
import { Avatar } from "./Avatar";
import { useNames, useOlder } from "./ChatView";
import { CloseIcon, EyeIcon } from "./Icons";
import type { RowContext } from "./MessageRow";
import { Sheet } from "./Sheet";
import { Timeline } from "./Timeline";

// A preview stays open while the pointer is over the chat list or the
// preview itself. Crossing the gap between them takes a moment, so leaving
// closes it only after a short wait.
let closing: ReturnType<typeof setTimeout> | undefined;

export function showPreview(chatId: string) {
  clearTimeout(closing);
  setUi({ preview: chatId });
}

export function stayInPreview() {
  clearTimeout(closing);
}

export function leavePreview() {
  clearTimeout(closing);
  if (ui.state.preview) closing = setTimeout(() => setUi({ preview: null }), 250);
}

/** With a preview open, hovering another chat previews that one instead. */
export function hoverPreview(chatId: string) {
  clearTimeout(closing);
  if (ui.state.preview && ui.state.preview !== chatId) setUi({ preview: chatId });
}

/** The previewed chat beside the list (a sheet on a phone). It shows the
 *  messages without opening the chat, so LINE gets no read receipt and the
 *  unread count stays. */
export function ChatPreview({ anchor }: { anchor: RefObject<HTMLElement | null> }) {
  const chatId = useUi((s) => s.preview);
  const open = chatId != null;
  const [box, setBox] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!open || phone || !el) return;
    const measure = () => setBox(el.getBoundingClientRect());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, anchor]);
  // Escape closes it like a popover, also with no chat open to catch the key.
  useEffect(() => {
    if (!open) return;
    const undo = pushDismiss(() => setUi({ preview: null }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || !ui.state.preview) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dismissTop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      undo();
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!chatId) return null;
  if (phone)
    return (
      <Sheet open onClose={() => setUi({ preview: null })} className="h-[78vh] w-[calc(100vw-24px)] bg-chat!">
        <PreviewBody chatId={chatId} />
      </Sheet>
    );
  if (!box) return null;
  const width = Math.min(440, window.innerWidth - box.right - 16);
  return createPortal(
    <div
      onMouseEnter={stayInPreview}
      onMouseLeave={leavePreview}
      className="fixed z-40 flex origin-left flex-col overflow-hidden rounded-xl bg-chat text-primary shadow-[0_12px_40px_rgba(0,0,0,0.3)] ring-1 ring-black/10 motion-safe:animate-ghost-in"
      style={{ left: box.right + 6, top: box.top + 6, width, height: Math.min(box.height - 12, 640) }}
    >
      <PreviewBody chatId={chatId} />
    </div>,
    document.body,
  );
}

function PreviewBody({ chatId }: { chatId: string }) {
  const list = useChatList();
  const chat = list?.chats.find((c) => c.id === chatId);
  const session = useSession();
  const people = usePeople();
  const group = isGroup({ id: chatId, kind: chat?.kind ?? "" });
  const { data: messages = [], error, isPending } = useQuery(q.messages(chatId));
  const { data: reads = {} } = useQuery(q.reads(chatId));
  const { data: members } = useQuery({ ...q.members(chatId), enabled: group });
  const older = useOlder(chatId, messages.length);
  const { name, picture } = useNames(members);
  const me = session?.profile?.mid ?? "";
  // Fresh history from LINE. Unlike opening the chat, this sends no read.
  // Wait a little, so sweeping over the list does not fetch every chat.
  useEffect(() => {
    const t = setTimeout(() => api.reloadChat(chatId).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [chatId]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // Read only: no reactions or other actions that would show you were here.
  const ctx: RowContext = useMemo(
    () => ({ chatId, group, me: me || "me", signedIn: false, name, picture, loadMembers: () => {}, find: (id) => byId.get(id) }),
    [chatId, group, me, name, picture, byId],
  );
  const title = isKeepMemo({ id: chatId }, me) ? "Keep Memo" : (chat?.name ?? chatId);
  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-separator pr-2 pl-3">
        <Avatar id={chatId} name={title} size={30} picture={chat?.picture} local={chat?.avatar} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13.5px] font-semibold">
            {title}
            {group && chat?.memberCount ? ` (${chat.memberCount})` : ""}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-secondary">
            <EyeIcon size={11} className="shrink-0" />
            <span className="truncate">ดูอยู่ · ยังไม่ส่งว่าอ่านแล้ว</span>
          </div>
        </div>
        <button
          title="เปิดแชท แล้วส่งว่าอ่านแล้ว"
          onClick={() => openChat(chatId)}
          className="h-7 shrink-0 rounded-md bg-line-green px-3 text-[12px] font-medium text-white"
        >
          เปิดแชท
        </button>
        {phone && (
          <button title="ปิด" onClick={() => setUi({ preview: null })} className="grid h-9 w-9 place-items-center text-secondary">
            <CloseIcon size={18} />
          </button>
        )}
      </div>
      {error && <div className="px-4 py-2 text-[12px] text-badge-red">โหลดข้อความไม่สำเร็จ: {errorText(error)}</div>}
      <Timeline
        messages={messages}
        loading={isPending}
        failed={!!error}
        older={older}
        reads={reads}
        ctx={ctx}
        members={members}
        people={people}
        search={null}
        follows={false}
      />
    </>
  );
}
