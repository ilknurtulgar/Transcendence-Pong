import type { IPage } from "../types/ipage";
import { ProfileService } from "../services/ProfileService";
import { ws } from "../services/ws";
import { chatStore } from "../services/ChatStore";
import { lang } from "../i18n/lang";

type PresenceState = 'online' | 'offline'

export class ChatPage implements IPage {
    private goTo: (path: string, params?: any) => void;

    private ws = ws;
    private unsubscribeMessage: (() => void) | null = null
    private unsubscribeState: (() => void) | null = null
    private unsubscribeChat: (() => void) | null = null
    private activeChatUserId: number | null = null;
    private myUserId: number | null = null;
    private presence = new Map<number, PresenceState>();

    private friends: Array<{ id: number, alias: string, avatar_url?: string }> = [];
    private friendRequests: Array<{ id: number, alias: string, avatar_url?: string }> = [];

    constructor(goTo: (path: string, params?: any) => void) {
        this.goTo = goTo;
    }

    render(): string {
        return `
        <div class="min-h-screen bg-gray-50">
            <header class="bg-white border-b">
                <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <button id="backBtn" class="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
                            ← ${lang('common.back')}
                        </button>
                        <h1 class="text-xl font-semibold">${lang('common.chat')}</h1>
                    </div>
                </div>
            </header>

            <main class="max-w-6xl mx-auto p-4">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <section class="bg-white rounded-2xl shadow p-4">
                        <div class="flex items-center justify-between mb-3">
                            <h2 class="font-semibold">${lang('chat.friends')}</h2>
                            <button id="refreshPresenceBtn" class="text-xs text-blue-600 hover:underline">${lang('chat.refresh')}</button>
                        </div>

                        <div class="mb-3 flex flex-col sm:flex-row gap-2">
                            <input id="addFriendInput" class="flex-1 border rounded-xl px-3 py-2 min-w-0" placeholder="${lang('chat.addFriend')}" />
                            <button id="addFriendBtn" class="bg-pink-600 text-white px-3 py-2 rounded-xl whitespace-nowrap shrink-0">${lang('chat.addButton')}</button>
                        </div>

                        <div class="mb-3">
                            <div class="flex items-center justify-between">
                                <h3 class="text-sm font-semibold text-gray-700">${lang('chat.pendingRequests')}</h3>
                                <button id="refreshRequestsBtn" class="text-xs text-blue-600 hover:underline">${lang('chat.refresh')}</button>
                            </div>
                            <div id="requestsList" class="mt-2 flex flex-col gap-2"></div>
                        </div>

                        <div id="friendsList" class="flex flex-col gap-2"></div>
                    </section>

                    <section class="bg-white rounded-2xl shadow p-4 md:col-span-2">
                        <div class="flex items-center justify-between mb-3">
                            <h2 id="chatTitle" class="font-semibold">${lang('chat.selectFriend')}</h2>
                        </div>

                        <div id="chatBox" class="h-[520px] overflow-auto border rounded-xl p-3 bg-gray-50"></div>

                        <form id="chatForm" class="mt-3 flex gap-2">
                            <input id="chatInput" class="flex-1 border rounded-xl px-3 py-2" placeholder="${lang('chat.messagePlaceholder')}" />
                            <button class="bg-blue-600 text-white px-4 py-2 rounded-xl">${lang('chat.sendButton')}</button>
                        </form>

                        <p class="text-xs text-gray-500 mt-2">${lang('chat.friendsOnlyNote')}</p>
                    </section>
                </div>
            </main>
        </div>
        `;
    }

    async mount(): Promise<void> {
        chatStore.init()

        try {
            const me = await ProfileService.profileData()
            if (!me || !me.user) {
                this.goTo('/login')
                return
            }
        } catch {
            this.goTo('/login')
            return
        }

        const backBtn = document.getElementById('backBtn') as HTMLButtonElement
        const friendsListEl = document.getElementById('friendsList')
        const requestsListEl = document.getElementById('requestsList')
        const refreshPresenceBtn = document.getElementById('refreshPresenceBtn') as HTMLButtonElement
        const refreshRequestsBtn = document.getElementById('refreshRequestsBtn') as HTMLButtonElement

        const addFriendInput = document.getElementById('addFriendInput') as HTMLInputElement
        const addFriendBtn = document.getElementById('addFriendBtn') as HTMLButtonElement

        const chatBox = document.getElementById('chatBox')
        const chatForm = document.getElementById('chatForm') as HTMLFormElement
        const chatInput = document.getElementById('chatInput') as HTMLInputElement
        const chatTitle = document.getElementById('chatTitle')

        const updateFriendSelectionUI = (selectedPeerId: number) => {
            if (!friendsListEl) return
            const buttons = friendsListEl.querySelectorAll('button[data-peer-id]')
            buttons.forEach((b) => {
                if (b instanceof HTMLElement) {
                    b.style.backgroundColor = ''
                    b.style.borderColor = ''
                }
            })
            const selected = friendsListEl.querySelector(`button[data-peer-id="${String(selectedPeerId)}"]`)
            if (selected instanceof HTMLElement) {
                selected.style.backgroundColor = '#fef08a'
                selected.style.borderColor = '#eab308'
            }
        }

        const handleFriendSelect = (ev: Event) => {
            if (!friendsListEl) return

            let target: any = (ev as any).target
            if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement

            const btn = (target && typeof target.closest === 'function')
                ? (target.closest('button[data-peer-id]') as HTMLButtonElement | null)
                : null

            if (!btn) {
                try {
                    if (target && friendsListEl.contains(target)) {
                        appendSystem(lang('chat.friendsOnlyNote'))
                    }
                } catch {
                }
                return
            }

            ev.preventDefault()
                ; (ev as any).stopPropagation?.()

            const id = Number(btn.dataset.peerId)
            if (!Number.isFinite(id) || id <= 0) return

            const friend = this.friends.find((f) => Number(f.id) === Number(id))
            this.activeChatUserId = id
            chatStore.setActivePeer(id)
            if (chatTitle) {
                const alias = friend?.alias
                if (alias) {
                    chatTitle.textContent = '';
                    chatTitle.appendChild(document.createTextNode(`${lang('common.chat')}: `));
                    const usernameSpan = document.createElement('span');
                    usernameSpan.className = 'cursor-pointer hover:text-blue-600';
                    usernameSpan.textContent = alias;
                    usernameSpan.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.goTo(`/profile/${encodeURIComponent(alias)}`);
                    });
                    chatTitle.appendChild(usernameSpan);
                } else {
                    chatTitle.textContent = `${lang('common.chat')}: ${id}`
                }
            }
            appendSystem(`${lang('chat.selected')}: ${friend?.alias || id}`)
            renderFriends()
            syncFriendsSelection()
            renderConversation()
        }

        const mainElement = document.querySelector('main')
        mainElement?.addEventListener('pointerdown', handleFriendSelect, true)
        mainElement?.addEventListener('click', handleFriendSelect)

        const appendSystem = (line: string) => {
            if (!chatBox) return
            const last = chatBox.lastElementChild
            if (last && last.classList.contains('text-gray-500') && last.textContent === line) return
            const div = document.createElement('div')
            div.className = 'text-xs text-gray-500 py-1'
            div.textContent = line
            chatBox.appendChild(div)
            chatBox.scrollTop = chatBox.scrollHeight
        }

        const showToast = (message: string) => {
            const existing = document.getElementById('chatToast')
            existing?.remove()

            const toast = document.createElement('div')
            toast.id = 'chatToast'
            toast.className = 'fixed bottom-6 right-6 bg-red-600 text-white px-4 py-3 rounded-xl shadow-lg text-sm z-50'
            toast.textContent = message
            document.body.appendChild(toast)

            setTimeout(() => {
                toast.remove()
            }, 2000)
        }

        const renderConversation = () => {
            if (!chatBox) return
            chatBox.innerHTML = ''

            if (!this.activeChatUserId) {
                appendSystem(lang('chat.selectFriend'))
                return
            }

            const msgs = chatStore.getConversation(this.activeChatUserId)
            for (const m of msgs) {
                const myId = this.myUserId ?? chatStore.getMyUserId()
                const isMe = myId != null ? m.fromUserId === myId : (m.fromUserId !== this.activeChatUserId)
                const row = document.createElement('div')
                row.className = `py-1 flex ${isMe ? 'justify-end' : 'justify-start'}`

                const bubble = document.createElement('div')
                bubble.className = `max-w-[80%] px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-blue-600 text-white' : 'bg-white border text-gray-800'}`
                bubble.textContent = m.text

                row.appendChild(bubble)
                chatBox.appendChild(row)
            }

            chatBox.scrollTop = chatBox.scrollHeight
        }

        const renderRequests = () => {
            if (!requestsListEl) return
            requestsListEl.innerHTML = ''

            if (!this.friendRequests.length) {
                const empty = document.createElement('div')
                empty.className = 'text-xs text-gray-400'
                empty.textContent = lang('chat.noRequests'),
                    requestsListEl.appendChild(empty)
                return
            }

            for (const r of this.friendRequests) {
                const row = document.createElement('div')
                row.className = 'w-full border rounded-xl px-3 py-2 flex items-center justify-between'
                
                const aliasSpan = document.createElement('span');
                aliasSpan.className = 'font-medium text-sm';
                aliasSpan.textContent = r.alias;
                
                const acceptBtn = document.createElement('button');
                acceptBtn.className = 'acceptBtn text-xs bg-green-600 text-white px-2 py-1 rounded-lg';
                acceptBtn.dataset.id = String(r.id);
                acceptBtn.textContent = lang('chat.accept');
                
                row.appendChild(aliasSpan);
                row.appendChild(acceptBtn);
                requestsListEl.appendChild(row)
            }

            requestsListEl.querySelectorAll('button.acceptBtn').forEach((btn) => {
                btn.addEventListener('click', async (e) => {
                    const id = Number((e.currentTarget as HTMLButtonElement).dataset.id)
                    if (!Number.isFinite(id)) return
                    await ProfileService.acceptFriendRequest(id)
                    await refreshFriendsAndRequests()
                })
            })
        }

        const renderFriends = () => {
            if (!friendsListEl) return
            friendsListEl.innerHTML = ''

            if (!this.friends.length) {
                const empty = document.createElement('div')
                empty.className = 'text-xs text-gray-400'
                empty.textContent = lang('game.noFriends')
                friendsListEl.appendChild(empty)
                return
            }

            for (const f of this.friends) {
                const rawStatus = this.presence.get(f.id) || 'offline';

                const statusLabel = rawStatus === 'online' ? lang('chat.online') : lang('chat.offline');
                const unread = chatStore.getUnread(f.id)
                const row = document.createElement('button')
                row.type = 'button'
                row.dataset.peerId = String(f.id)
                row.style.pointerEvents = 'auto'
                row.className = `w-full text-left border rounded-xl px-3 py-2 hover:bg-gray-50 flex items-center justify-between`
                
                const aliasSpan = document.createElement('span');
                aliasSpan.className = 'font-medium';
                aliasSpan.textContent = f.alias;
                
                const rightSection = document.createElement('span');
                rightSection.className = 'flex items-center gap-2';
                
                if (unread > 0) {
                    const unreadBadge = document.createElement('span');
                    unreadBadge.className = 'text-[11px] px-2 py-0.5 rounded-full bg-red-600 text-white';
                    unreadBadge.textContent = String(unread);
                    rightSection.appendChild(unreadBadge);
                }
                
                const statusSpan = document.createElement('span');
                statusSpan.className = `text-xs ${rawStatus === 'online' ? 'text-green-600' : 'text-gray-400'}`;
                statusSpan.textContent = statusLabel;
                rightSection.appendChild(statusSpan);
                
                row.appendChild(aliasSpan);
                row.appendChild(rightSection);
                friendsListEl.appendChild(row)
            }
        }

        const syncFriendsSelection = () => {
            if (this.activeChatUserId != null) {
                updateFriendSelectionUI(this.activeChatUserId)
            }
        }

        backBtn?.addEventListener('click', () => this.goTo('/home'))

        const refreshFriendsAndRequests = async () => {
            try {
                const friendsRes = await ProfileService.getFriends()
                const rawFriends = friendsRes?.friends || []
                const byId = new Map<number, { id: number, alias: string, avatar_url?: string }>()
                for (const f of rawFriends) {
                    const id = Number((f as any)?.id)
                    const alias = (f as any)?.alias
                    if (!Number.isFinite(id) || id <= 0) continue
                    if (typeof alias !== 'string' || !alias.trim()) continue
                    if (!byId.has(id)) {
                        byId.set(id, {
                            id,
                            alias: String(alias),
                            avatar_url: typeof (f as any)?.avatar_url === 'string' ? (f as any).avatar_url : undefined,
                        })
                    }
                }
                this.friends = Array.from(byId.values())

                for (const f of this.friends) {
                    if (!this.presence.has(f.id)) this.presence.set(f.id, 'offline')
                }

                const reqRes = await ProfileService.getFriendRequests()
                this.friendRequests = reqRes?.requests || []

                renderRequests()
                renderFriends()
                syncFriendsSelection()

                this.ws.send({ type: 'presence/request' })
            } catch {
                appendSystem(lang('chat.friendsLoadError'))
            }
        }

        await refreshFriendsAndRequests()

        this.unsubscribeChat?.()
        this.unsubscribeChat = chatStore.onChange(() => {
            renderFriends()
            renderConversation()
            syncFriendsSelection()
        })

        this.unsubscribeState?.()
        this.unsubscribeMessage?.()

        this.unsubscribeState = this.ws.onState((_s) => {
        })

        this.unsubscribeMessage = this.ws.onMessage((payload) => {
            if (!payload || typeof payload.type !== 'string') return

            if (payload.type === 'hello') {
                if (payload.user && typeof payload.user.id === 'number') {
                    this.myUserId = payload.user.id
                }
                appendSystem(lang('chat.wsConnected'))

                this.ws.send({ type: 'presence/request' })
                return
            }

            if (payload.type === 'presence/initial' && Array.isArray(payload.presence)) {
                for (const p of payload.presence) {
                    if (typeof p.userId === 'number' && (p.status === 'online' || p.status === 'offline')) {
                        this.presence.set(p.userId, p.status)
                    }
                }
                renderFriends()
                syncFriendsSelection()
                return
            }

            if (payload.type === 'presence/update') {
                if (typeof payload.userId === 'number' && (payload.status === 'online' || payload.status === 'offline')) {
                    this.presence.set(payload.userId, payload.status)
                    renderFriends()
                    syncFriendsSelection()
                }
                return
            }

            if (payload.type === 'error') {
                appendSystem(`Hata: ${payload.error}`)
                return
            }
        })

        this.ws.connect()

        refreshPresenceBtn?.addEventListener('click', () => {
            this.ws.send({ type: 'presence/request' })
        })

        refreshRequestsBtn?.addEventListener('click', async () => {
            await refreshFriendsAndRequests()
        })

        addFriendBtn?.addEventListener('click', async (e) => {
            e.preventDefault()
            const alias = addFriendInput?.value?.trim()
            if (!alias) {
                appendSystem(lang('chat.emptyAlias'))
                return
            }
            try {
                await ProfileService.addFriend(alias)
                addFriendInput.value = ''
                await refreshFriendsAndRequests()
                appendSystem(lang('chat.requestSent'))
            } catch (error) {
                const errorKey = (error as Error).message;
                appendSystem(lang(errorKey) || errorKey);
            }
        })

        chatForm?.addEventListener('submit', (e) => {
            e.preventDefault()
            const toUserId = this.activeChatUserId
            const text = chatInput?.value?.trim()

            if (toUserId == null) {
                appendSystem(lang('chat.selectFriendBeforeSend'))
                return
            }
            if (!text) return

            chatStore.addOptimisticOutgoing(toUserId, text)
            renderConversation()

            this.ws.send({ type: 'chat/send', toUserId, text })
            chatInput.value = ''
        })

        renderConversation()
    }

    unmount(): void {
        this.unsubscribeState?.()
        this.unsubscribeState = null
        this.unsubscribeMessage?.()
        this.unsubscribeMessage = null

        this.unsubscribeChat?.()
        this.unsubscribeChat = null

        chatStore.setActivePeer(null)
    }
}