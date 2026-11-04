import { useQuery } from "@tanstack/react-query";
import { api, useChatList } from "../lib/api";
import { byImportance, missedChats, type Missed, summarize } from "../lib/missed";
import { openChat } from "../lib/nav";
import { Avatar } from "./Avatar";
import { useNames } from "./ChatView";
import { Spinner } from "./kit";

/** LINE's history pages are 100 messages; more than that is no catch-up. */
const MOST = 100;

/** What came in while LAAB was away. Reading this sends no read receipt;
 *  opening a chat does, as it always has. */
export function MissedSheet({ onDone }: { onDone: () => void }) {
  const chats = missedChats(useChatList());
  const key = chats.map((c) => `${c.id}:${c.unread}`).join();
  const { data, isPending } = useQuery({
    queryKey: ["missed", key],
    queryFn: async () => {
      const each = await Promise.all(chats.map(async (c) => summarize(c, await api.messages(c.id, Math.min(c.unread + 20, MOST)))));
      return each.sort(byImportance);
    },
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="px-5 pb-2 text-[13px] text-secondary">ดูหน้านี้ยังไม่ขึ้นว่าอ่านแล้ว จนกว่าจะแตะเข้าแชท</p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {isPending && (
          <div className="grid place-items-center py-10">
            <Spinner size={18} />
          </div>
        )}
        {data?.length === 0 && <div className="py-10 text-center text-[13px] text-secondary">ไม่มีแชทที่พลาด</div>}
        {data?.map((m) => (
          <Row
            key={m.chat.id}
            missed={m}
            onOpen={() => {
              onDone();
              openChat(m.chat.id, { focusComposer: false });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Row({ missed: m, onOpen }: { missed: Missed; onOpen: () => void }) {
  const { name } = useNames(undefined);
  const people = m.senders.slice(0, 3).map(name).join(", ");
  const more = m.senders.length > 3 ? ` และอีก ${m.senders.length - 3} คน` : "";
  const facts = [
    m.photos && `${m.photos} รูป/วิดีโอ`,
    m.files && `${m.files} ไฟล์`,
    m.links && `${m.links} ลิงก์`,
  ].filter(Boolean);
  return (
    <button onClick={onOpen} className="flex w-full items-start gap-3 px-5 py-2.5 text-left active:bg-row-selected">
      <Avatar id={m.chat.id} name={m.chat.name} size={44} picture={m.chat.picture} local={m.chat.avatar} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[15px] font-semibold">{m.chat.name}</span>
          <span className="shrink-0 text-[12px] text-secondary">{m.chat.unread} ข้อความ</span>
          {m.mentioned && <span className="shrink-0 text-[12px] font-semibold text-line-green">@คุณ</span>}
        </div>
        {people && (
          <div className="truncate text-[12.5px] text-secondary">
            จาก {people}
            {more}
          </div>
        )}
        <div className="line-clamp-2 text-[13.5px]">{m.latest}</div>
        {facts.length > 0 && <div className="text-[12px] text-secondary">{facts.join(" · ")}</div>}
      </div>
    </button>
  );
}
