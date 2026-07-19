// AiG — Connections.jsx  (NEW · additive)
// "Connect User" — search a researcher, send a connection request, accept
// incoming requests. Connected users can later share datasets (see Datasets).
//
// Route: /connections
import { useState, useEffect, useRef, useCallback } from 'react';
import { UserPlus, Search, Check, Clock, Users, MessageSquare, Send, X } from 'lucide-react';
import {
  searchProfiles, sendConnection, acceptConnection, listConnections, getProfilesByIds,
  listDirectMessages, sendDirectMessage, subscribeDirectMessages,
} from '../lib/db';

function Avatar({ email }) {
  const initials = (email || '?').split('@')[0].slice(0, 2).toUpperCase();
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#C9971A] text-white text-xs font-bold shrink-0">
      {initials}
    </span>
  );
}

// Private 1:1 chat between two accepted connections — separate from the
// dataset-scoped chat in Datasets.jsx (that one's tied to a dataset, this
// one is a general conversation between two people, live via Realtime).
function DMChatPanel({ me, otherId, otherLabel, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const { data, error } = await listDirectMessages(otherId);
      if (error) { setErr(error.message); return; }
      setMessages(data ?? []);
      unsub = subscribeDirectMessages(me, otherId, (m) => {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      });
    })();
    return () => unsub();
  }, [me, otherId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    const { error } = await sendDirectMessage(otherId, body);
    if (error) setErr(error.message);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg h-[70vh] flex flex-col border border-[#E8DFA0]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#F0E9B8]">
          <h3 className="text-sm font-bold text-stone-800 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#C9971A]" /> {otherLabel}
          </h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && <p className="text-center text-xs text-stone-400 mt-6">No messages yet — say hello.</p>}
          {messages.map((m) => {
            const mine = m.sender_id === me;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-[#C9971A] text-white' : 'bg-[#F7F3D0] text-stone-700'}`}>
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

export default function Connections() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [conns, setConns] = useState({ incoming: [], outgoing: [], accepted: [], me: null });
  const [profiles, setProfiles] = useState({});
  const [msg, setMsg] = useState(null);
  const [chatWith, setChatWith] = useState(null); // { id, label } or null

  const refresh = useCallback(async () => {
    const c = await listConnections();
    setConns(c);
    const ids = [
      ...c.incoming.map((r) => r.requester_id),
      ...c.outgoing.map((r) => r.addressee_id),
      ...c.accepted.flatMap((r) => [r.requester_id, r.addressee_id]),
    ];
    const { data } = await getProfilesByIds(ids);
    const map = {};
    for (const p of data ?? []) map[p.id] = p;
    setProfiles(map);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function doSearch(e) {
    e?.preventDefault();
    setSearching(true);
    setMsg(null);
    const { data, error } = await searchProfiles(query);
    setSearching(false);
    if (error) { setMsg(error.message); return; }
    setResults((data ?? []).filter((p) => p.id !== conns.me));
  }

  async function connect(userId) {
    setMsg(null);
    const { error } = await sendConnection(userId);
    if (error) { setMsg(error.message); return; }
    setMsg('Connection request sent.');
    refresh();
  }

  async function accept(id) {
    const { error } = await acceptConnection(id);
    if (error) { setMsg(error.message); return; }
    refresh();
  }

  const other = (r) => (r.requester_id === conns.me ? r.addressee_id : r.requester_id);

  return (
    <div className="min-h-full p-6" style={{ background: '#FDFBF0' }}>
      <div className="mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#C9971A] bg-[#F7F3D0] border border-[#E8DFA0] px-2 py-0.5 rounded-full">
          Collaborate
        </span>
      </div>
      <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2 mb-1">
        <Users className="w-6 h-6 text-[#C9971A]" /> Connect Researchers
      </h1>
      <p className="text-stone-500 text-sm mb-6 max-w-2xl">
        Find another AiG user, send a connection request, and share datasets once connected.
      </p>

      {msg && (
        <div className="mb-4 rounded-lg px-4 py-2 text-sm bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700">{msg}</div>
      )}

      {/* Search */}
      <form onSubmit={doSearch} className="flex gap-2 mb-6 max-w-lg">
        <div className="flex-1 flex items-center gap-2 bg-white border border-[#E8DFA0] rounded-lg px-3">
          <Search className="w-4 h-4 text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email or name…"
            className="flex-1 py-2 text-sm bg-transparent outline-none text-stone-700"
          />
        </div>
        <button type="submit" disabled={searching}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#C9971A' }}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {/* Search results */}
      {results.length > 0 && (
        <div className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm mb-6 divide-y divide-[#F0E9B8]">
          {results.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar email={p.email} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-700 truncate">{p.display_name || p.email}</p>
                <p className="text-xs text-stone-400 truncate">{p.email}</p>
              </div>
              <button onClick={() => connect(p.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: '#C9971A' }}>
                <UserPlus className="w-3.5 h-3.5" /> Connect
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-5">
        {/* Incoming */}
        <div className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#F0E9B8] text-sm font-semibold text-stone-700">Incoming requests</div>
          {conns.incoming.length === 0 ? (
            <p className="px-4 py-6 text-xs text-stone-400 text-center">None</p>
          ) : conns.incoming.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-4 py-2.5 border-b border-[#F0E9B8] last:border-0">
              <Avatar email={profiles[other(r)]?.email} />
              <span className="flex-1 text-xs text-stone-600 truncate">{profiles[other(r)]?.email || other(r)}</span>
              <button onClick={() => accept(r.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-white" style={{ background: '#C9971A' }}>
                <Check className="w-3 h-3" /> Accept
              </button>
            </div>
          ))}
        </div>

        {/* Outgoing */}
        <div className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#F0E9B8] text-sm font-semibold text-stone-700">Pending sent</div>
          {conns.outgoing.length === 0 ? (
            <p className="px-4 py-6 text-xs text-stone-400 text-center">None</p>
          ) : conns.outgoing.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-4 py-2.5 border-b border-[#F0E9B8] last:border-0">
              <Avatar email={profiles[other(r)]?.email} />
              <span className="flex-1 text-xs text-stone-600 truncate">{profiles[other(r)]?.email || other(r)}</span>
              <span className="inline-flex items-center gap-1 text-xs text-stone-400"><Clock className="w-3 h-3" /> pending</span>
            </div>
          ))}
        </div>

        {/* Connected */}
        <div className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#F0E9B8] text-sm font-semibold text-stone-700">Connected</div>
          {conns.accepted.length === 0 ? (
            <p className="px-4 py-6 text-xs text-stone-400 text-center">None yet</p>
          ) : conns.accepted.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-4 py-2.5 border-b border-[#F0E9B8] last:border-0">
              <Avatar email={profiles[other(r)]?.email} />
              <span className="flex-1 text-xs text-stone-600 truncate">{profiles[other(r)]?.email || other(r)}</span>
              <button
                onClick={() => setChatWith({
                  id: other(r),
                  label: profiles[other(r)]?.display_name || profiles[other(r)]?.email || 'user',
                })}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-white"
                style={{ background: '#C9971A' }}
              >
                <MessageSquare className="w-3 h-3" /> Chat
              </button>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            </div>
          ))}
        </div>
      </div>

      {chatWith && (
        <DMChatPanel
          me={conns.me}
          otherId={chatWith.id}
          otherLabel={chatWith.label}
          onClose={() => setChatWith(null)}
        />
      )}
    </div>
  );
}
