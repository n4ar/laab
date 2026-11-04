import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorText, useChatList } from "../lib/api";
import { downloadModel, modelStatus, type ModelState, onModelEvent, summarizeOnDevice } from "../lib/localAi";
import { byImportance, missedChats, type Missed, summarize, summaryPrompt } from "../lib/missed";
import { openChat } from "../lib/nav";
import { ios } from "../lib/platform";
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
  const model = useModel();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="px-5 pb-2 text-[13px] text-secondary">ดูหน้านี้ยังไม่ขึ้นว่าอ่านแล้ว จนกว่าจะแตะเข้าแชท</p>
      <ModelBar model={model} />
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
            canSummarize={model.state === "ready"}
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

/** The on-device model: there, on its way, or not yet asked for. */
function useModel() {
  const [state, setState] = useState<ModelState | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ios) return;
    modelStatus().then(setState, (e) => setError(errorText(e)));
    const listeners = [
      onModelEvent<{ fraction: number }>("progress", (e) => {
        setState("downloading");
        setFraction(e.fraction);
      }),
      onModelEvent<unknown>("ready", () => setState("ready")),
      onModelEvent<{ message: string }>("failed", (e) => {
        setState("missing");
        setError(e.message);
      }),
    ];
    return () => listeners.forEach((l) => l.then((x) => x.unregister()));
  }, []);
  const start = () => {
    setError(null);
    setState("downloading");
    downloadModel().catch((e) => {
      setState("missing");
      setError(errorText(e));
    });
  };
  return { state, fraction, error, start };
}

function ModelBar({ model }: { model: ReturnType<typeof useModel> }) {
  if (!model.state && !model.error) return null;
  if (model.state === "ready") return null;
  return (
    <div className="mx-5 mb-2 rounded-[10px] bg-field px-3 py-2 text-[13px]">
      {model.state === "downloading" ? (
        <span>กำลังดาวน์โหลดโมเดล{model.fraction != null ? ` ${Math.round(model.fraction * 100)}%` : "…"}</span>
      ) : (
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            สรุปแชทด้วย AI ในเครื่อง ข้อความไม่ออกจาก iPhone ต้องดาวน์โหลดโมเดล 2.6 GB ครั้งเดียว ควรใช้ Wi-Fi
          </span>
          <button onClick={model.start} className="h-8 shrink-0 rounded-md bg-line-green px-3 font-medium text-white">
            ดาวน์โหลด
          </button>
        </div>
      )}
      {model.error && <div className="mt-1 text-badge-red">ไม่สำเร็จ: {model.error}</div>}
    </div>
  );
}

function Row({ missed: m, onOpen, canSummarize }: { missed: Missed; onOpen: () => void; canSummarize: boolean }) {
  const { name } = useNames(undefined);
  const [summary, setSummary] = useState<{ text: string; busy: boolean; error?: string } | null>(null);
  const runSummary = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSummary({ text: "", busy: true });
    summarizeOnDevice(m.chat.id, summaryPrompt(m, name), (text) => setSummary({ text, busy: true })).then(
      () => setSummary((s) => s && { ...s, busy: false }),
      (err) => setSummary({ text: "", busy: false, error: errorText(err) }),
    );
  };
  const people = m.senders.slice(0, 3).map(name).join(", ");
  const more = m.senders.length > 3 ? ` และอีก ${m.senders.length - 3} คน` : "";
  const facts = [
    m.photos && `${m.photos} รูป/วิดีโอ`,
    m.files && `${m.files} ไฟล์`,
    m.links && `${m.links} ลิงก์`,
  ].filter(Boolean);
  return (
    <div role="button" onClick={onOpen} className="flex w-full items-start gap-3 px-5 py-2.5 text-left active:bg-row-selected">
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
        {summary ? (
          <div className="mt-1.5 rounded-lg bg-field px-2.5 py-2 text-[13.5px]" onClick={(e) => e.stopPropagation()}>
            {summary.error ? (
              <span className="text-badge-red">สรุปไม่สำเร็จ: {summary.error}</span>
            ) : (
              <>
                <span className="selectable whitespace-pre-wrap">{summary.text}</span>
                {summary.busy && !summary.text && <Spinner size={14} />}
                {!summary.busy && <div className="mt-1 text-[11.5px] text-secondary">สรุปโดย AI ในเครื่อง อาจผิดพลาดได้</div>}
              </>
            )}
          </div>
        ) : (
          canSummarize &&
          m.messages.length > 0 && (
            <button onClick={runSummary} className="mt-1.5 h-8 rounded-md bg-field px-3 text-[13px] font-medium">
              สรุปด้วย AI
            </button>
          )
        )}
      </div>
    </div>
  );
}
