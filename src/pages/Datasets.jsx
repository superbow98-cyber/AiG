// AiG — Datasets.jsx  (NEW · additive)
// Lists the datasets you own / can access, lets you set sharing visibility
// (Private / Connected users / Public), and opens a live "Chat on Dataset"
// discussion for connected users to talk about the GPR anomaly, XRF elements
// and AI prediction. Realtime via Supabase.
//
// Route: /datasets
import { useState, useEffect, useRef, useCallback } from 'react';
import { Share2, MessageSquare, Lock, Users, Globe, Send, X } from 'lucide-react';
import {
  listDatasets, setDatasetVisibility, listMessages, sendMessage, subscribeMessages,
  getAuthUser, getProfilesByIds,
} from '../lib/db';

const VIS = [
  { v: 'private',   label: 'Private',    Icon: Lock },
  { v: 'connected', label: 'Connected',  Icon: Users },
  { v: 'public',    label: 'Public',     Icon: Globe },
];

function ChatPanel({ dataset, me, onClose }) {
  const [messages, setMessages] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const endRef = useRef(null);

  const loadProfiles = useCallback(async (rows) => {
    const { data } = await getProfilesByIds(rows.map((m) => m.user_id));
    const map = {};
    for (const p of data ?? []) map[p.id] = p;
    setProfiles((prev) => ({ ...prev, ...map }));
  }, []);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const { data } = await listMessages(dataset.dataset_id);
      setMessages(data ?? []);
      loadProfiles(data ?? []);
      unsub = subscribeMessages(dataset.dataset_id, (m) => {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        loadProfiles([m]);
      });
    })();
    return () => unsub();
  }, [dataset.dataset_id, loadProfiles]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    const { error } = await sendMessage(dataset.dataset_id, body);
    if (error) setErr(error.message);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg h-[70vh] flex flex-col border border-[#E8DFA0]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#F0E9B8]">
          <div>
            <h3 className="text-sm font-bold text-stone-800 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#C9971A]" /> {dataset.title || dataset.dataset_id}
            </h3>
            <p className="text-xs text-stone-400">Discuss GPR anomaly · XRF elements · AI prediction</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && <p className="text-center text-xs text-stone-400 mt-6">No messages yet — start the discussion.</p>}
          {messages.map((m) => {
            const mine = m.user_id === me;
            const who = profiles[m.user_id]?.display_name || profiles[m.user_id]?.email || 'user';
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-[#C9971A] text-white' : 'bg-[#F7F3D0] text-stone-700'}`}>
                  {!mine && <p className="text-[10px] font-semibold text-stone-500 mb-0.5">{who}</p>}
                  {m.body}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {err && <p className="px-5 text-xs text-red-600">{err}</p>}
        <form onSubmit={send} className="flex gap-2 p-3 border-t border-[#F0E9B8]">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a message…"
            className="flex-1 px-3 py-2 rounded-lg bg-[#FDFBF0] border border-[#E8DFA0] text-sm outline-none text-stone-700"
          />
          <button type="submit" className="px-3 py-2 rounded-lg text-white" style={{ background: '#C9971A' }}>
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Datasets() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [chat, setChat] = useState(null);
  const [err, setErr] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const user = await getAuthUser();
    setMe(user?.id ?? null);
    const { data, error } = await listDatasets();
    if (error) setErr(error.message);
    setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function changeVis(datasetId, v) {
    const { error } = await setDatasetVisibility(datasetId, v);
    if (error) { setErr(error.message); return; }
    setRows((r) => r.map((d) => (d.dataset_id === datasetId ? { ...d, visibility: v } : d)));
  }

  return (
    <div className="min-h-full p-6" style={{ background: '#FDFBF0' }}>
      <div className="mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#C9971A] bg-[#F7F3D0] border border-[#E8DFA0] px-2 py-0.5 rounded-full">
          Collaborate
        </span>
      </div>
      <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2 mb-1">
        <Share2 className="w-6 h-6 text-[#C9971A]" /> Datasets &amp; Sharing
      </h1>
      <p className="text-stone-500 text-sm mb-6 max-w-2xl">
        Set who can see each dataset, and open a live discussion with connected users.
      </p>

      {err && <div className="mb-4 rounded-lg px-4 py-2 text-sm bg-red-50 border border-red-200 text-red-700">{err}</div>}

      {loading ? (
        <div className="p-10 text-center text-sm text-stone-400">Loading datasets…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#F0E9B8] rounded-2xl p-8 text-center text-sm text-stone-500">
          No datasets yet. Save results (Results → Save All) or run a Batch upload to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((d) => {
            const owner = d.user_id === me;
            return (
              <div key={d.dataset_id} className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-800 truncate">{d.title || d.dataset_id}</p>
                  <p className="text-xs text-stone-400 font-mono truncate">{d.dataset_id}{d.site_id ? ` · ${d.site_id}` : ''}</p>
                </div>

                {/* Visibility selector (owner only) */}
                <div className="flex rounded-lg overflow-hidden border border-[#E8DFA0]">
                  {VIS.map(({ v, label, Icon }) => (
                    <button
                      key={v}
                      disabled={!owner}
                      onClick={() => changeVis(d.dataset_id, v)}
                      className={`px-2.5 py-1.5 text-xs font-medium inline-flex items-center gap-1 transition-colors disabled:opacity-40 ${
                        d.visibility === v ? 'bg-[#C9971A] text-white' : 'bg-[#F7F3D0] text-stone-500 hover:text-stone-900'
                      }`}
                    >
                      <Icon className="w-3 h-3" /> {label}
                    </button>
                  ))}
                </div>

                <button onClick={() => setChat(d)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#E8DFA0] text-stone-700 hover:bg-[#F0E9B8]">
                  <MessageSquare className="w-3.5 h-3.5" /> Chat on Dataset
                </button>
              </div>
            );
          })}
        </div>
      )}

      {chat && <ChatPanel dataset={chat} me={me} onClose={() => setChat(null)} />}
    </div>
  );
}
