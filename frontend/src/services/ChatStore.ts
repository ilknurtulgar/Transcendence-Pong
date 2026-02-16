import { ws } from "./ws";

export type ChatMessage = {
  fromUserId: number;
  toUserId: number;
  text: string;
  ts: number;
};

type Listener = () => void;

type Persisted = {
  version: 1;
  conversations: Record<string, ChatMessage[]>;
  unreadByPeer: Record<string, number>;
};

const STORAGE_KEY = "chat:store:v1";
const MAX_PER_PEER = 50;

class ChatStore {
  private initialized = false;
  private listeners: Listener[] = [];

  private myUserId: number | null = null;
  private activePeerUserId: number | null = null;

  private conversations = new Map<number, ChatMessage[]>();
  private unreadByPeer = new Map<number, number>();

  private lastSentFingerprintByPeer = new Map<number, string>();

  private persistTimer: number | null = null;

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.hydrate();

    ws.onMessage((payload: any) => {
      if (!payload || typeof payload.type !== "string") return;

      if (payload.type === "hello") {
        if (payload.user && typeof payload.user.id === "number") {
          this.myUserId = payload.user.id;
          this.emit();
        }
        return;
      }

      if (payload.type !== "chat/message") return;

      const fromUserId = Number(payload.fromUserId);
      const toUserId = Number(payload.toUserId);
      const text = String(payload.text || "");
      const ts = Number(payload.ts) || Date.now();

      if (!Number.isFinite(fromUserId) || !Number.isFinite(toUserId) || !text) return;

      const peerUserId = this.resolvePeer(fromUserId, toUserId);
      if (peerUserId == null) return;

      if (this.myUserId != null && fromUserId === this.myUserId) {
        const fp = `${fromUserId}|${toUserId}|${text}`;
        const last = this.lastSentFingerprintByPeer.get(peerUserId);
        if (last === fp) {
          this.lastSentFingerprintByPeer.delete(peerUserId);
          return;
        }
      }

      this.pushMessage(peerUserId, { fromUserId, toUserId, text, ts }, true);
    });
  }

  onChange(listener: Listener) {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  setActivePeer(peerUserId: number | null) {
    this.activePeerUserId = peerUserId;
    if (peerUserId != null) this.markRead(peerUserId);
    this.emit();
  }

  getActivePeer() {
    return this.activePeerUserId;
  }

  getMyUserId() {
    return this.myUserId;
  }

  getConversation(peerUserId: number): ChatMessage[] {
    return this.conversations.get(peerUserId) || [];
  }

  getUnread(peerUserId: number): number {
    return this.unreadByPeer.get(peerUserId) || 0;
  }

  getTotalUnread(): number {
    let total = 0;
    for (const v of this.unreadByPeer.values()) total += v;
    return total;
  }

  markRead(peerUserId: number) {
    if (!Number.isFinite(peerUserId)) return;
    if ((this.unreadByPeer.get(peerUserId) || 0) === 0) return;
    this.unreadByPeer.set(peerUserId, 0);
    this.schedulePersist();
    this.emit();
  }

  addOptimisticOutgoing(toUserId: number, text: string) {
    const myId = this.myUserId;
    if (myId == null) return;

    const peerUserId = toUserId;
    const msg: ChatMessage = { fromUserId: myId, toUserId, text, ts: Date.now() };

    this.pushMessage(peerUserId, msg, false);
    this.lastSentFingerprintByPeer.set(peerUserId, `${myId}|${toUserId}|${text}`);
  }

  private resolvePeer(fromUserId: number, toUserId: number): number | null {
    if (this.myUserId == null) {
      return fromUserId;
    }
    return fromUserId === this.myUserId ? toUserId : fromUserId;
  }

  private pushMessage(peerUserId: number, msg: ChatMessage, countUnread: boolean) {
    if (!this.conversations.has(peerUserId)) this.conversations.set(peerUserId, []);
    const list = this.conversations.get(peerUserId)!;
    list.push(msg);

    if (list.length > MAX_PER_PEER) {
      list.splice(0, list.length - MAX_PER_PEER);
    }

    if (countUnread) {
      const isActive = this.activePeerUserId != null && Number(this.activePeerUserId) === Number(peerUserId);
      if (!isActive) {
        this.unreadByPeer.set(peerUserId, (this.unreadByPeer.get(peerUserId) || 0) + 1);
      }
    }

    this.schedulePersist();
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();

    const total = this.getTotalUnread();
    if (total > 0) document.title = `(${total}) Transcendence`;
    else document.title = "Transcendence";
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 250);
  }

  private persist() {
    try {
      const convObj: Record<string, ChatMessage[]> = {};
      for (const [peerId, msgs] of this.conversations.entries()) {
        convObj[String(peerId)] = msgs;
      }

      const unreadObj: Record<string, number> = {};
      for (const [peerId, n] of this.unreadByPeer.entries()) {
        if (n > 0) unreadObj[String(peerId)] = n;
      }

      const data: Persisted = { version: 1, conversations: convObj, unreadByPeer: unreadObj };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
    }
  }

  private hydrate() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Persisted;
      if (!parsed || parsed.version !== 1) return;

      if (parsed.conversations && typeof parsed.conversations === "object") {
        for (const [peerIdStr, msgs] of Object.entries(parsed.conversations)) {
          const peerId = Number(peerIdStr);
          if (!Number.isFinite(peerId) || !Array.isArray(msgs)) continue;
          const clean = msgs
            .map((m) => ({
              fromUserId: Number((m as any).fromUserId),
              toUserId: Number((m as any).toUserId),
              text: String((m as any).text || ""),
              ts: Number((m as any).ts) || Date.now(),
            }))
            .filter((m) => Number.isFinite(m.fromUserId) && Number.isFinite(m.toUserId) && !!m.text)
            .slice(-MAX_PER_PEER);
          this.conversations.set(peerId, clean);
        }
      }

      if (parsed.unreadByPeer && typeof parsed.unreadByPeer === "object") {
        for (const [peerIdStr, n] of Object.entries(parsed.unreadByPeer)) {
          const peerId = Number(peerIdStr);
          const num = Number(n);
          if (!Number.isFinite(peerId) || !Number.isFinite(num) || num <= 0) continue;
          this.unreadByPeer.set(peerId, num);
        }
      }
    } catch {
    }
  }
}

export const chatStore = new ChatStore();
