import { lang } from '../i18n/lang'

type WsHandler = (payload: any) => void

type WsStateHandler = (state: 'connecting' | 'open' | 'closed' | 'error') => void

type BufferedInvite = {
    inviteId: string
    lobbyId: string
    fromUserId: number
    fromAlias: string
    expiresAt: number
}

export class WebSocketService {
    private ws: WebSocket | null = null
    private handlers: WsHandler[] = []
    private stateHandlers: WsStateHandler[] = []

    private currentState: 'connecting' | 'open' | 'closed' | 'error' = 'closed'

    private reconnectTimer: number | null = null
    private reconnectAttempts = 0
    private manualClose = false

    private storageListener: ((e: StorageEvent) => void) | null = null
    private logoutEventListener: (() => void) | null = null

    private pendingInviteBuffer: Map<string, BufferedInvite> = new Map()

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return
        }

        this.manualClose = false
        if (this.reconnectTimer) {
            window.clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }

        const wsUrl = this.getUrl()
        this.emitState('connecting')

        this.ws = new WebSocket(wsUrl)

        if (!this.storageListener) {
            this.storageListener = (e: StorageEvent) => {
                if (e.key === 'auth:logout') this.close()
            }
            window.addEventListener('storage', this.storageListener)
        }
        if (!this.logoutEventListener) {
            this.logoutEventListener = () => this.close()
            window.addEventListener('auth:logout', this.logoutEventListener as EventListener)
        }

        this.ws.onopen = () => {
            this.reconnectAttempts = 0
            this.emitState('open')
        }
        this.ws.onclose = (ev) => {
            console.warn(`WebSocket closed: code=${ev.code} reason="${ev.reason}" clean=${ev.wasClean} url=${wsUrl}`)
            this.emitState('closed')

            if (!this.manualClose) {
                this.scheduleReconnect()
            }
        }
        this.ws.onerror = () => this.emitState('error')

        this.ws.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data)
                this.handleGlobalMessage(data)
                for (const h of this.handlers) h(data)
            } catch {
            }
        }
    }

    onMessage(handler: WsHandler) {
        this.handlers.push(handler)
        return () => {
            const idx = this.handlers.indexOf(handler)
            if (idx >= 0) this.handlers.splice(idx, 1)
        }
    }

    onState(handler: WsStateHandler) {
        this.stateHandlers.push(handler)

        try {
            handler(this.currentState)
        } catch {
        }
        return () => {
            const idx = this.stateHandlers.indexOf(handler)
            if (idx >= 0) this.stateHandlers.splice(idx, 1)
        }
    }

    getState() {
        return this.currentState
    }

    send(payload: any) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
        this.ws.send(JSON.stringify(payload))
    }

    close() {
        this.manualClose = true

        if (this.reconnectTimer) {
            window.clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        this.ws?.close()
        this.ws = null

        if (this.storageListener) {
            window.removeEventListener('storage', this.storageListener)
            this.storageListener = null
        }
        if (this.logoutEventListener) {
            window.removeEventListener('auth:logout', this.logoutEventListener as EventListener)
            this.logoutEventListener = null
        }
    }

    private emitState(state: 'connecting' | 'open' | 'closed' | 'error') {
        this.currentState = state
        for (const h of this.stateHandlers) h(state)
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) return

        const attempt = this.reconnectAttempts
        const delay = Math.min(10_000, 500 * Math.pow(2, attempt))
        this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, 10)

        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null
            this.connect()
        }, delay)
    }

    private getUrl() {
        if (window.location.protocol === 'https:') {
            return `wss://${window.location.host}/ws`
        }

        return `ws://${window.location.hostname}:3000/ws`
    }

    private handleGlobalMessage(payload: any) {
        if (!payload || typeof payload.type !== 'string') return

        if (payload.type === 'game/invite/received') {
            const inviteId = String(payload.inviteId || '')
            if (inviteId && !this.isOnGamePage()) {
                this.pendingInviteBuffer.set(inviteId, {
                    inviteId,
                    lobbyId: String(payload.lobbyId || ''),
                    fromUserId: Number(payload.fromUserId),
                    fromAlias: String(payload.fromAlias || ''),
                    expiresAt: Number(payload.expiresAt),
                })
                this.showGlobalInviteToast(String(payload.fromAlias || ''))
            }
        }

        if (payload.type === 'game/invite/expired' || payload.type === 'game/invite/rejected' || payload.type === 'game/invite/accepted') {
            const inviteId = String(payload.inviteId || '')
            if (inviteId) this.pendingInviteBuffer.delete(inviteId)
        }

        if (payload.type === 'match/result/confirm_request') {
            const matchId = payload.matchId ? String(payload.matchId) : ''
            const p1s = Number(payload.player1Score)
            const p2s = Number(payload.player2Score)
            if (!matchId || !Number.isFinite(p1s) || !Number.isFinite(p2s)) return

            try {
                const handledKey = `ws:match_confirm:handled:${matchId}`
                const promptingKey = `ws:match_confirm:prompting:${matchId}`

                const handledAt = Number(window.localStorage.getItem(handledKey) || 0)
                if (Number.isFinite(handledAt) && handledAt > 0 && Date.now() - handledAt < 60_000) {
                    return
                }

                const promptingAt = Number(window.localStorage.getItem(promptingKey) || 0)
                if (Number.isFinite(promptingAt) && promptingAt > 0 && Date.now() - promptingAt < 30_000) {
                    return
                }

                window.localStorage.setItem(promptingKey, String(Date.now()))

                const ok = window.confirm(lang('game.hostScoreConfirm').replace('{{p1}}', String(p1s)).replace('{{p2}}', String(p2s)))

                window.localStorage.setItem(handledKey, String(Date.now()))
                window.localStorage.removeItem(promptingKey)

                this.send({ type: 'match/result/confirm', matchId, accept: ok })
            } catch {
            }
        }
    }

    private isOnGamePage(): boolean {
        return window.location.pathname === '/game'
    }

    private showGlobalInviteToast(fromAlias: string) {
        const existing = document.getElementById('globalInviteToast')
        existing?.remove()

        const toast = document.createElement('div')
        toast.id = 'globalInviteToast'
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            background-color: #2563eb; color: white;
            padding: 12px 24px; border-radius: 8px;
            z-index: 10000; cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            animation: fadeIn .2s ease;
        `
        toast.textContent = lang('game.inviteReceivedGlobal').replace('{{alias}}', fromAlias)
        toast.addEventListener('click', () => {
            toast.remove()
            window.history.pushState({}, '', '/game')
            window.dispatchEvent(new PopStateEvent('popstate'))
        })
        document.body.appendChild(toast)
        setTimeout(() => toast.remove(), 8000)
    }

    getPendingInvites(): Map<string, BufferedInvite> {
        const invites = new Map(this.pendingInviteBuffer)
        this.pendingInviteBuffer.clear()
        return invites
    }
}
