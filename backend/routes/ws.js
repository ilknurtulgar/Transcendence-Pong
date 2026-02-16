const fp = require('fastify-plugin')

function safeJsonParse(text) {
    try {
        return { ok: true, value: JSON.parse(text) }
    } catch {
        return { ok: false, value: null }
    }
}

function nowMs() {
    return Date.now()
}

function createRateLimiter({ burst = 10, refillPerSecond = 5 } = {}) {
    let tokens = burst
    let last = nowMs()

    return {
        allow() {
            const t = nowMs()
            const elapsed = (t - last) / 1000
            last = t
            tokens = Math.min(burst, tokens + elapsed * refillPerSecond)
            if (tokens >= 1) {
                tokens -= 1
                return true
            }
            return false
        }
    }
}

async function wsRoutes(fastify, options) {
    const db = options.db

    const socketsByUserId = new Map()

    const userInfoByUserId = new Map()

    const gameStateByUserId = new Map()

    const lobbyIdByHostUserId = new Map()

    const lobbyIdByMemberUserId = new Map()

    const lobbiesById = new Map()

    const invitesById = new Map()

    const pendingInviteIdByPair = new Map()

    const tournamentsByLobbyId = new Map()

    function isPowerOfTwo(n) {
        return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
    }

    function createTournamentBracket(participantUserIds) {
        const ids = Array.from(participantUserIds)
        const n = ids.length

        const matchesById = new Map()
        const order = []

        const newMatch = (stage, slot1, slot2) => {
            const id = randomId()
            const m = {
                id,
                stage,
                slot1,
                slot2,
                player1Id: null,
                player2Id: null,
                winnerId: null,
                loserId: null,
                player1Score: null,
                player2Score: null,
                completed: false,
            }
            matchesById.set(id, m)
            order.push(id)
            return id
        }

        if (n === 6) {
            const qf1 = newMatch('QUARTERFINAL', { type: 'user', ref: ids[1] }, { type: 'user', ref: ids[2] })
            const qf2 = newMatch('QUARTERFINAL', { type: 'user', ref: ids[3] }, { type: 'user', ref: ids[4] })
            const semi1 = newMatch('SEMIFINAL', { type: 'user', ref: ids[0] }, { type: 'winner', ref: qf1 })
            const semi2 = newMatch('SEMIFINAL', { type: 'winner', ref: qf2 }, { type: 'user', ref: ids[5] })
            const third = newMatch('THIRD_PLACE', { type: 'loser', ref: semi1 }, { type: 'loser', ref: semi2 })
            const final = newMatch('FINAL', { type: 'winner', ref: semi1 }, { type: 'winner', ref: semi2 })
            return { matchesById, order, finalMatchId: final, thirdPlaceMatchId: third }
        }

        if (!isPowerOfTwo(n)) {
            return { error: 'unsupported_size' }
        }

        const roundIds = []
        let currentRound = []

        for (let i = 0; i < n; i += 2) {
            currentRound.push(newMatch('ROUND1', { type: 'user', ref: ids[i] }, { type: 'user', ref: ids[i + 1] }))
        }
        roundIds.push(currentRound)

        let stage = 'ROUND'
        while (currentRound.length > 1) {
            const nextRound = []
            for (let i = 0; i < currentRound.length; i += 2) {
                nextRound.push(newMatch(stage, { type: 'winner', ref: currentRound[i] }, { type: 'winner', ref: currentRound[i + 1] }))
            }
            roundIds.push(nextRound)
            currentRound = nextRound
        }

        const finalMatchId = currentRound[0]

        const semifinalRound = roundIds.length >= 2 ? roundIds[roundIds.length - 2] : []
        for (const mid of semifinalRound) {
            const m = matchesById.get(mid)
            if (m) m.stage = 'SEMIFINAL'
        }
        const finalMatch = matchesById.get(finalMatchId)
        if (finalMatch) finalMatch.stage = 'FINAL'

        const firstRound = roundIds[0] || []
        for (const mid of firstRound) {
            const m = matchesById.get(mid)
            if (m) m.stage = 'ROUND1'
        }

        const thirdPlaceMatchId = semifinalRound.length === 2
            ? newMatch('THIRD_PLACE', { type: 'loser', ref: semifinalRound[0] }, { type: 'loser', ref: semifinalRound[1] })
            : null

        return { matchesById, order, finalMatchId, thirdPlaceMatchId }
    }

    function resolveTournamentMatchPlayers(tournament) {
        const bracket = tournament.bracket
        if (!bracket || !bracket.matchesById) return

        for (const mid of bracket.order) {
            const m = bracket.matchesById.get(mid)
            if (!m) continue

            const resolveSlot = (slot) => {
                if (!slot || !slot.type) return null
                if (slot.type === 'user') return Number(slot.ref)

                const refMatch = bracket.matchesById.get(String(slot.ref))
                if (!refMatch || !refMatch.completed) return null
                if (slot.type === 'winner') return Number(refMatch.winnerId)
                if (slot.type === 'loser') return Number(refMatch.loserId)
                return null
            }

            if (!m.player1Id) m.player1Id = resolveSlot(m.slot1)
            if (!m.player2Id) m.player2Id = resolveSlot(m.slot2)
        }
    }

    function getNextReadyTournamentMatch(tournament) {
        const bracket = tournament.bracket
        if (!bracket || !bracket.matchesById) return null
        resolveTournamentMatchPlayers(tournament)

        for (const mid of bracket.order) {
            const m = bracket.matchesById.get(mid)
            if (!m) continue
            if (m.completed) continue
            if (Number.isFinite(Number(m.player1Id)) && Number.isFinite(Number(m.player2Id)) && m.player1Id && m.player2Id) {
                return m
            }
        }
        return null
    }

    function tournamentToStatePayload(lobbyId, tournament) {
        const bracket = tournament.bracket
        const matches = []
        if (bracket && bracket.matchesById) {
            for (const mid of bracket.order) {
                const m = bracket.matchesById.get(mid)
                if (!m) continue
                matches.push({
                    matchId: m.id,
                    stage: m.stage,
                    player1Id: m.player1Id,
                    player2Id: m.player2Id,
                    player1Score: m.player1Score,
                    player2Score: m.player2Score,
                    winnerId: m.winnerId,
                    completed: !!m.completed,
                })
            }
        }
        return {
            type: 'tournament/state',
            lobbyId,
            tournamentId: tournament.id,
            participantUserIds: tournament.participantUserIds,
            activeMatch: tournament.activeMatch || null,
            finished: !!tournament.finished,
            matches,
        }
    }

    function getActiveTournamentMatch(lobbyId) {
        const t = tournamentsByLobbyId.get(lobbyId)
        return t && t.activeMatch ? t.activeMatch : null
    }

    function getActiveOnlineMatch(lobbyId) {
        const lobby = lobbiesById.get(lobbyId)
        return lobby && lobby.activeOnlineMatch ? lobby.activeOnlineMatch : null
    }

    function isLobbyLockedByActiveMatch(lobbyId) {
        return !!getActiveTournamentMatch(lobbyId) || !!getActiveOnlineMatch(lobbyId)
    }

    async function persistVerifiedMatch({ mode, player1Id, player2Id, player1Score, player2Score, winnerId, tournamentId = null, stage = null }) {
        const dbMatchId = await db.execute(
            `INSERT INTO matches (mode, player1_id, player2_id, opponent_label, player1_score, player2_score, winner_id, is_verified, tournament_id, stage)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [mode, player1Id, player2Id, null, player1Score, player2Score, winnerId, 1, tournamentId, stage]
        )

        if (player1Score !== player2Score) {
            if (player1Score > player2Score) {
                await db.execute('UPDATE users SET wins = wins + 1 WHERE id = ?', [player1Id])
                await db.execute('UPDATE users SET losses = losses + 1 WHERE id = ?', [player2Id])
            } else {
                await db.execute('UPDATE users SET losses = losses + 1 WHERE id = ?', [player1Id])
                await db.execute('UPDATE users SET wins = wins + 1 WHERE id = ?', [player2Id])
            }
        }

        return dbMatchId
    }

    async function forfeitActiveOnlineMatch(lobbyId, loserUserId, reason = 'left') {
        const lobby = lobbiesById.get(lobbyId)
        if (!lobby || !lobby.activeOnlineMatch || !lobby.memberUserIds || lobby.memberUserIds.size !== 2) return false

        const matchId = String(lobby.activeOnlineMatch.matchId || '')
        if (!matchId) return false

        if (!lobby.activeOnlineMatch.beganAt) {
            const matchKey = `${lobbyId}:${matchId}`
            lobby.activeOnlineMatch = null
            pendingMatchResultsByKey.delete(matchKey)
            const to = pendingMatchTimeoutsByKey.get(matchKey)
            if (to) {
                clearTimeout(to)
                pendingMatchTimeoutsByKey.delete(matchKey)
            }
            broadcastLobbyToMembers(lobbyId, {
                type: 'game/match/cancelled',
                lobbyId,
                matchId,
                reason: `cancelled_${reason}`
            })

            await unlockLobbyMembers(lobbyId)
            return true
        }

        const members = Array.from(lobby.memberUserIds)

        const player1Id = lobby.hostUserId
        const player2Id = members.find(id => id !== player1Id)
        if (!player2Id) return false

        const matchKey = `${lobbyId}:${matchId}`
        const pending = pendingMatchResultsByKey.get(matchKey)
        let player1Score, player2Score, winnerId

        if (pending && pending.kind === 'host_confirm' &&
            Number.isFinite(pending.player1Score) && Number.isFinite(pending.player2Score)) {
            player1Score = pending.player1Score
            player2Score = pending.player2Score
            winnerId = null
            if (player1Score > player2Score) winnerId = player1Id
            else if (player2Score > player1Score) winnerId = player2Id
        } else {
            const winnerUserId = members.find(id => id !== loserUserId)
            if (!winnerUserId) return false
            player1Score = 0
            player2Score = 0
            if (winnerUserId === player1Id) player1Score = 1
            else player2Score = 1
            winnerId = winnerUserId
        }

        lobby.activeOnlineMatch = null
        pendingMatchResultsByKey.delete(matchKey)
        const to = pendingMatchTimeoutsByKey.get(matchKey)
        if (to) {
            clearTimeout(to)
            pendingMatchTimeoutsByKey.delete(matchKey)
        }

        const dbMatchId = await persistVerifiedMatch({
            mode: 'ONLINE',
            player1Id,
            player2Id,
            player1Score,
            player2Score,
            winnerId,
            tournamentId: null,
            stage: null,
        })

        broadcastLobbyToMembers(lobbyId, {
            type: 'match/result/confirmed',
            lobbyId,
            tournamentId: null,
            matchId,
            dbMatchId,
            player1Id,
            player2Id,
            player1Score,
            player2Score,
            winnerId,
            reason: `forfeit_${reason}`
        })

        await unlockLobbyMembers(lobbyId)

        return true
    }

    async function forfeitActiveTournamentMatch(lobbyId, loserUserId, reason = 'left') {
        const tournament = tournamentsByLobbyId.get(lobbyId)
        if (!tournament || !tournament.activeMatch) return false

        const matchId = String(tournament.activeMatch.matchId || '')
        const p1 = Number(tournament.activeMatch.player1Id)
        const p2 = Number(tournament.activeMatch.player2Id)
        if (!Number.isFinite(p1) || !Number.isFinite(p2) || !matchId) return false
        if (loserUserId !== p1 && loserUserId !== p2) return false

        const winnerUserId = loserUserId === p1 ? p2 : p1
        const stage = tournament.activeMatch.stage ? String(tournament.activeMatch.stage).toUpperCase() : null

        let player1Score = 0
        let player2Score = 0
        if (winnerUserId === p1) player1Score = 1
        else player2Score = 1

        const winnerId = winnerUserId

        try {
            if (tournament.bracket && tournament.bracket.matchesById) {
                const m = tournament.bracket.matchesById.get(String(matchId))
                if (m && !m.completed) {
                    m.completed = true
                    m.player1Id = p1
                    m.player2Id = p2
                    m.player1Score = player1Score
                    m.player2Score = player2Score
                    m.winnerId = winnerId
                    m.loserId = loserUserId
                }
            }
        } catch {
        }

        tournament.activeMatch = null
        pendingMatchResultsByKey.delete(`${lobbyId}:${matchId}`)

        const dbMatchId = await persistVerifiedMatch({
            mode: 'TOURNAMENT',
            player1Id: p1,
            player2Id: p2,
            player1Score,
            player2Score,
            winnerId,
            tournamentId: tournament.id,
            stage,
        })

        broadcastLobbyToMembers(lobbyId, {
            type: 'match/result/confirmed',
            lobbyId,
            tournamentId: tournament.id,
            matchId,
            dbMatchId,
            player1Id: p1,
            player2Id: p2,
            player1Score,
            player2Score,
            winnerId,
            reason: `forfeit_${reason}`
        })

        broadcastLobbyToMembers(lobbyId, tournamentToStatePayload(lobbyId, tournament))

        return true
    }

    async function forfeitAllRemainingTournamentMatches(lobbyId, leavingUserId, reason = 'left') {
        const tournament = tournamentsByLobbyId.get(lobbyId)
        if (!tournament || !tournament.bracket || !tournament.bracket.matchesById) return

        await forfeitActiveTournamentMatch(lobbyId, leavingUserId, reason)

        resolveTournamentMatchPlayers(tournament)

        let didForfeit = true
        while (didForfeit) {
            didForfeit = false
            resolveTournamentMatchPlayers(tournament)

            for (const mid of tournament.bracket.order) {
                const m = tournament.bracket.matchesById.get(mid)
                if (!m || m.completed) continue

                const p1 = Number(m.player1Id)
                const p2 = Number(m.player2Id)

                if (!Number.isFinite(p1) || !Number.isFinite(p2)) continue

                const involves = (p1 === leavingUserId || p2 === leavingUserId)
                if (!involves) continue

                const winnerId = (leavingUserId === p1) ? p2 : p1
                const loserId = leavingUserId

                let player1Score = 0, player2Score = 0
                if (winnerId === p1) player1Score = 1
                else player2Score = 1

                m.completed = true
                m.player1Id = p1
                m.player2Id = p2
                m.player1Score = player1Score
                m.player2Score = player2Score
                m.winnerId = winnerId
                m.loserId = loserId

                tournament.activeMatch = null
                pendingMatchResultsByKey.delete(`${lobbyId}:${mid}`)

                const stage = m.stage ? String(m.stage).toUpperCase() : null

                const dbMatchId = await persistVerifiedMatch({
                    mode: 'TOURNAMENT',
                    player1Id: p1,
                    player2Id: p2,
                    player1Score,
                    player2Score,
                    winnerId,
                    tournamentId: tournament.id,
                    stage,
                })

                broadcastLobbyToMembers(lobbyId, {
                    type: 'match/result/confirmed',
                    lobbyId,
                    tournamentId: tournament.id,
                    matchId: mid,
                    dbMatchId,
                    player1Id: p1,
                    player2Id: p2,
                    player1Score,
                    player2Score,
                    winnerId,
                    reason: `forfeit_${reason}`
                })

                didForfeit = true
                break
            }
        }

        broadcastLobbyToMembers(lobbyId, tournamentToStatePayload(lobbyId, tournament))
    }
    
    const pendingMatchResultsByKey = new Map()

    const pendingMatchTimeoutsByKey = new Map()

    const PENDING_RESULT_TIMEOUT_MS = 30_000

    const disconnectForfeitTimersByUserId = new Map()

    function clearPendingTimeoutsForLobby(lobbyId) {
        try {
            for (const k of pendingMatchTimeoutsByKey.keys()) {
                if (k === lobbyId || (typeof k === 'string' && k.startsWith(`${lobbyId}:`))) {
                    const to = pendingMatchTimeoutsByKey.get(k)
                    if (to) clearTimeout(to)
                    pendingMatchTimeoutsByKey.delete(k)
                }
            }
        } catch {
        }
    }
    
    const DISCONNECT_GRACE_MS = 15_000

    const INVITE_TTL_MS = 30_000

    function randomId() {
        return Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
    }

    function getUserAlias(userId) {
        const info = userInfoByUserId.get(userId)
        return info ? info.alias : null
    }

    function getGameState(userId) {
        return gameStateByUserId.get(userId) || 'inLobby'
    }

    function setGameStateInternal(userId, newState) {
        if (newState !== 'inLobby' && newState !== 'inGame') return false
        gameStateByUserId.set(userId, newState)
        return true
    }

    async function setGameStateAndNotify(userId, newState) {
        const ok = setGameStateInternal(userId, newState)
        if (!ok) return false
        await notifyFriendsGameState(userId)
        notifyUserGameState(userId)
        return true
    }

    async function unlockLobbyMembers(lobbyId) {
        const lobby = lobbiesById.get(lobbyId)
        if (!lobby || !lobby.memberUserIds) return
        for (const uid of lobby.memberUserIds) {
            await setGameStateAndNotify(uid, 'inLobby')
        }
    }

    function unlockLobbyMembersFireAndForget(lobbyId) {
        const lobby = lobbiesById.get(lobbyId)
        if (!lobby || !lobby.memberUserIds) return
        for (const uid of lobby.memberUserIds) {
            setGameStateInternal(uid, 'inLobby')
            void notifyFriendsGameState(uid)
            notifyUserGameState(uid)
        }
    }

    async function getFriendIds(userId) {
        const rows = await db.queryAll(
            `SELECT DISTINCT
                CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS id
             FROM friends
             WHERE status = 'accepted'
               AND (user_id = ? OR friend_id = ?)
               AND user_id != friend_id`,
            [userId, userId, userId]
        )
        return rows.map(r => r.id)
    }

    async function isBlockedEitherWay(a, b) {
        const row = await db.query(
            `SELECT user_id, friend_id
             FROM friends
             WHERE status = 'blocked'
               AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
            [a, b, b, a]
        )
        return !!row
    }

    async function areFriends(a, b) {
        const row = await db.query(
            `SELECT 1 AS ok
             FROM friends
             WHERE status = 'accepted'
               AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
            [a, b, b, a]
        )
        return !!row
    }

    function send(ws, payload) {
        try {
            ws.send(JSON.stringify(payload))
        } catch {
        }
    }

    function broadcastToUser(userId, payload) {
        const set = socketsByUserId.get(userId)
        if (!set) return
        for (const ws of set) {
            send(ws, payload)
        }
    }

    function markOnline(userId, ws) {
        let set = socketsByUserId.get(userId)
        const wasOnline = !!set && set.size > 0
        if (!set) {
            set = new Set()
            socketsByUserId.set(userId, set)
        }
        set.add(ws)
        return { wasOnline }
    }

    function markOffline(userId, ws) {
        const set = socketsByUserId.get(userId)
        if (!set) return { becameOffline: false }
        set.delete(ws)
        if (set.size === 0) {
            socketsByUserId.delete(userId)
            return { becameOffline: true }
        }
        return { becameOffline: false }
    }

    async function notifyFriendsPresence(userId, status) {
        const friendIds = await getFriendIds(userId)
        for (const friendId of friendIds) {
            broadcastToUser(friendId, {
                type: 'presence/update',
                userId,
                status,
                gameState: getGameState(userId)
            })
        }
    }

    async function notifyFriendsGameState(userId) {
        const friendIds = await getFriendIds(userId)
        for (const friendId of friendIds) {
            broadcastToUser(friendId, {
                type: 'presence/update',
                userId,
                status: socketsByUserId.has(userId) ? 'online' : 'offline',
                gameState: getGameState(userId)
            })
        }
    }

    function notifyUserGameState(userId) {
        broadcastToUser(userId, {
            type: 'game/state/update',
            state: getGameState(userId)
        })
    }

    async function sendInitialPresence(ws, userId) {
        const friendIds = await getFriendIds(userId)
        const presence = friendIds.map(fid => ({
            userId: fid,
            status: socketsByUserId.has(fid) ? 'online' : 'offline',
            gameState: getGameState(fid)
        }))

        send(ws, {
            type: 'presence/initial',
            presence
        })
    }

    function maybeResendPendingHostConfirm(ws, userId) {
        try {
            const lobbyId = getLobbyIdForUser(userId)
            if (!lobbyId) return
            const lobby = lobbiesById.get(lobbyId)
            if (!lobby || !lobby.activeOnlineMatch || !lobby.activeOnlineMatch.hostOnly) return

            const matchId = String(lobby.activeOnlineMatch.matchId || '')
            if (!matchId) return

            const matchKey = `${lobbyId}:${matchId}`
            const pending = pendingMatchResultsByKey.get(matchKey)
            if (!pending || pending.kind !== 'host_confirm') return
            if (Number(pending.opponentUserId) !== Number(userId)) return

            send(ws, {
                type: 'match/result/confirm_request',
                lobbyId,
                matchId,
                player1Id: pending.player1Id,
                player2Id: pending.player2Id,
                player1Score: pending.player1Score,
                player2Score: pending.player2Score,
                reason: 'resend_on_reconnect'
            })
        } catch {
        }
    }

    function scheduleInviteExpiry(inviteId) {
        setTimeout(() => {
            const invite = invitesById.get(inviteId)
            if (!invite) return
            if (invite.status !== 'pending') return
            invite.status = 'expired'
            invitesById.delete(inviteId)

            const pairKey = `${invite.fromUserId}:${invite.toUserId}`
            if (pendingInviteIdByPair.get(pairKey) === inviteId) {
                pendingInviteIdByPair.delete(pairKey)
            }
            broadcastToUser(invite.fromUserId, { type: 'game/invite/expired', inviteId })
            broadcastToUser(invite.toUserId, { type: 'game/invite/expired', inviteId })
        }, INVITE_TTL_MS)
    }

    function ensureLobbyForHost(hostUserId) {
        const existingId = lobbyIdByHostUserId.get(hostUserId)
        if (existingId && lobbiesById.has(existingId)) {
            lobbyIdByMemberUserId.set(hostUserId, existingId)
            return existingId
        }

        const lobbyId = randomId()
        lobbiesById.set(lobbyId, {
            id: lobbyId,
            hostUserId,
            memberUserIds: new Set([hostUserId]),
            createdAt: nowMs()
        })
        lobbyIdByHostUserId.set(hostUserId, lobbyId)
        lobbyIdByMemberUserId.set(hostUserId, lobbyId)
        return lobbyId
    }

    function getLobbyIdForUser(userId) {
        const direct = lobbyIdByMemberUserId.get(userId)
        if (direct && lobbiesById.has(direct)) return direct

        for (const [lobbyId, lobby] of lobbiesById.entries()) {
            if (!lobby) continue
            if (Number(lobby.hostUserId) === Number(userId) || (lobby.memberUserIds && lobby.memberUserIds.has(userId))) {
                try {
                    lobby.memberUserIds.add(userId)
                } catch {
                }
                lobbyIdByMemberUserId.set(userId, lobbyId)
                if (Number(lobby.hostUserId) === Number(userId)) {
                    lobbyIdByHostUserId.set(userId, lobbyId)
                }
                return lobbyId
            }
        }

        return null
    }

    function getHostedLobbyId(userId) {
        const direct = lobbyIdByHostUserId.get(userId)
        if (direct && lobbiesById.has(direct)) {
            const lobby = lobbiesById.get(direct)
            if (lobby && lobby.hostUserId === userId) return direct
        }

        const memberLobbyId = getLobbyIdForUser(userId)
        if (memberLobbyId) {
            const lobby = lobbiesById.get(memberLobbyId)
            if (lobby && lobby.hostUserId === userId) {
                lobbyIdByHostUserId.set(userId, memberLobbyId)
                return memberLobbyId
            }
        }

        return findHostedLobbyIdByScan(userId)
    }

    function findHostedLobbyIdByScan(userId) {
        for (const [lobbyId, lobby] of lobbiesById.entries()) {
            if (!lobby) continue
            if (Number(lobby.hostUserId) === Number(userId)) {
                try {
                    lobby.memberUserIds.add(userId)
                } catch {
                }
                lobbyIdByHostUserId.set(userId, lobbyId)
                lobbyIdByMemberUserId.set(userId, lobbyId)
                return lobbyId
            }
        }
        return null
    }

    function broadcastLobbyToMembers(lobbyId, payload) {
        const lobby = lobbiesById.get(lobbyId)
        if (!lobby) return
        for (const memberUserId of lobby.memberUserIds) {
            broadcastToUser(memberUserId, payload)
        }
    }

    function broadcastLobbySnapshot(lobbyId) {
        const snapshot = getLobbySnapshot(lobbyId)
        if (!snapshot) return
        broadcastLobbyToMembers(lobbyId, { type: 'game/lobby/update', lobby: snapshot })
    }

    async function closeLobby(lobbyId, reason = 'closed') {
        const lobby = lobbiesById.get(lobbyId)
        if (!lobby) return

        tournamentsByLobbyId.delete(lobbyId)
        pendingMatchResultsByKey.delete(lobbyId)
        clearPendingTimeoutsForLobby(lobbyId)
        for (const k of pendingMatchResultsByKey.keys()) {
            if (typeof k === 'string' && k.startsWith(`${lobbyId}:`)) {
                pendingMatchResultsByKey.delete(k)
            }
        }

        if (lobby.activeOnlineMatch) {
            lobby.activeOnlineMatch = null
        }

        const members = Array.from(lobby.memberUserIds)
        if (!members.includes(lobby.hostUserId)) members.push(lobby.hostUserId)

        lobbiesById.delete(lobbyId)
        lobbyIdByHostUserId.delete(lobby.hostUserId)
        for (const uid of members) {
            if (lobbyIdByMemberUserId.get(uid) === lobbyId) {
                lobbyIdByMemberUserId.delete(uid)
            }
        }

        for (const uid of members) {
            await setGameStateAndNotify(uid, 'inLobby')
        }

        for (const uid of members) {
            broadcastToUser(uid, { type: 'game/lobby/closed', lobbyId, reason })
        }
    }

    function getLobbySnapshot(lobbyId) {
        const lobby = lobbiesById.get(lobbyId)
        if (!lobby) return null

        const members = Array.from(lobby.memberUserIds).map(id => ({
            id,
            alias: getUserAlias(id) || String(id)
        }))

        let activeOnlineMatch = null
        if (lobby.activeOnlineMatch && lobby.activeOnlineMatch.matchId) {
            const codes = {}
            try {
                if (lobby.activeOnlineMatch.codesByUserId && lobby.activeOnlineMatch.codesByUserId instanceof Map) {
                    for (const [uid, code] of lobby.activeOnlineMatch.codesByUserId.entries()) {
                        codes[String(uid)] = String(code)
                    }
                }
            } catch {
            }

            activeOnlineMatch = {
                matchId: String(lobby.activeOnlineMatch.matchId),
                hostUserId: lobby.hostUserId,
                hostOnly: !!lobby.activeOnlineMatch.hostOnly,
                phase: lobby.activeOnlineMatch.beganAt ? 'began' : 'created',
                beganAt: lobby.activeOnlineMatch.beganAt || null,
                codes,
            }
        }

        return {
            lobbyId: lobby.id,
            hostUserId: lobby.hostUserId,
            members,
            activeOnlineMatch,
        }
    }
    
    
    fastify.get('/ws', {
        websocket: true,
        preHandler: [fastify.authenticate]
    }, async (connection, request) => {
        const ws = (connection && connection.socket) ? connection.socket : connection

        if (!ws || typeof ws.on !== 'function' || typeof ws.send !== 'function') {
            request.log.error({ connection }, 'WebSocket upgrade not established')
            return
        }
        const userId = request.user.id
        const alias = request.user.alias

        userInfoByUserId.set(userId, { id: userId, alias })
        if (!gameStateByUserId.has(userId)) {
            gameStateByUserId.set(userId, 'inLobby')
        }

        const existingHostLobbyId = lobbyIdByHostUserId.get(userId)
        if (existingHostLobbyId && lobbiesById.has(existingHostLobbyId)) {
            lobbyIdByMemberUserId.set(userId, existingHostLobbyId)
        }

        if (!lobbyIdByHostUserId.get(userId) || !lobbyIdByMemberUserId.get(userId)) {
            try {
                for (const [lid, lobby] of lobbiesById.entries()) {
                    if (!lobby) continue
                    if (Number(lobby.hostUserId) === Number(userId)) {
                        lobbyIdByHostUserId.set(userId, lid)
                        lobbyIdByMemberUserId.set(userId, lid)
                        if (lobby.memberUserIds && lobby.memberUserIds instanceof Set) {
                            lobby.memberUserIds.add(userId)
                        }
                        break
                    }
                }
            } catch {
            }
        }

        const limiter = createRateLimiter({ burst: 12, refillPerSecond: 6 })

        ws.isAlive = true
        ws.on('pong', () => {
            ws.isAlive = true
        })
        const heartbeat = setInterval(() => {
            try {
                if (ws.isAlive === false) {
                    ws.terminate()
                    return
                }
                ws.isAlive = false
                ws.ping()
            } catch {
            }
        }, 15_000)

        const { wasOnline } = markOnline(userId, ws)

        const pendingDisconnectTimer = disconnectForfeitTimersByUserId.get(userId)
        if (pendingDisconnectTimer) {
            clearTimeout(pendingDisconnectTimer)
            disconnectForfeitTimersByUserId.delete(userId)
        }

        send(ws, {
            type: 'hello',
            user: { id: userId, alias }
        })

        await sendInitialPresence(ws, userId)

        maybeResendPendingHostConfirm(ws, userId)

        if (!wasOnline) {
            await notifyFriendsPresence(userId, 'online')
        }

        ws.on('message', async (raw) => {
            if (!limiter.allow()) {
                return send(ws, { type: 'error', error: 'rate_limited' })
            }

            const text = raw.toString('utf8')
            const parsed = safeJsonParse(text)
            if (!parsed.ok || !parsed.value || typeof parsed.value.type !== 'string') {
                return send(ws, { type: 'error', error: 'bad_message' })
            }

            const msg = parsed.value

            try {
                if (msg.type === 'presence/request') {
                    await sendInitialPresence(ws, userId)
                    return
                }

                if (msg.type === 'game/state/get') {
                    return send(ws, { type: 'game/state/ack', state: getGameState(userId) })
                }

                if (msg.type === 'game/state') {
                    const state = msg.state
                    const ok = await setGameStateAndNotify(userId, state)
                    if (!ok) return send(ws, { type: 'error', error: 'invalid_game_state' })
                    return send(ws, { type: 'game/state/ack', state: getGameState(userId) })
                }

                if (msg.type === 'game/page/enter') {
                    for (const [inviteId, invite] of invitesById.entries()) {
                        if (Number(invite.toUserId) === Number(userId) && invite.status === 'pending' && invite.expiresAt > nowMs()) {
                            const fromAlias = getUserAlias(invite.fromUserId)
                            send(ws, {
                                type: 'game/invite/received',
                                inviteId,
                                lobbyId: invite.lobbyId,
                                fromUserId: invite.fromUserId,
                                fromAlias: fromAlias || String(invite.fromUserId),
                                expiresAt: invite.expiresAt
                            })
                        }
                    }
                    for (const [inviteId, invite] of invitesById.entries()) {
                        if (Number(invite.fromUserId) === Number(userId) && invite.status === 'pending' && invite.expiresAt > nowMs()) {
                            send(ws, {
                                type: 'game/invite/sent',
                                inviteId,
                                lobbyId: invite.lobbyId,
                                toUserId: invite.toUserId,
                                expiresAt: invite.expiresAt
                            })
                        }
                    }
                    send(ws, { type: 'game/state/ack', state: getGameState(userId) })
                    const entryLobbyId = getLobbyIdForUser(userId)
                    if (entryLobbyId) {
                        const snapshot = getLobbySnapshot(entryLobbyId)
                        send(ws, { type: 'game/lobby/snapshot', lobby: snapshot })
                        maybeResendPendingHostConfirm(ws, userId)

                        const tournament = tournamentsByLobbyId.get(entryLobbyId)
                        if (tournament && !tournament.finished) {
                            send(ws, tournamentToStatePayload(entryLobbyId, tournament))
                        }
                    } else {
                        send(ws, { type: 'game/lobby/snapshot', lobby: null })
                    }
                    return
                }

                if (msg.type === 'game/page/leave') {

                    const pageLeaveLobbyId = getLobbyIdForUser(userId)
                    const pageLeaveHostLobbyId = getHostedLobbyId(userId)

                    if (pageLeaveLobbyId) {
                        const pageLeaveLobby = lobbiesById.get(pageLeaveLobbyId)

                        const hasActiveOnlineMatch = !!(pageLeaveLobby && pageLeaveLobby.activeOnlineMatch && pageLeaveLobby.activeOnlineMatch.beganAt)
                        const hasActiveTournamentMatch = !!(tournamentsByLobbyId.get(pageLeaveLobbyId)?.activeMatch)

                        if (hasActiveOnlineMatch || hasActiveTournamentMatch) {
                            try {
                                await forfeitAllRemainingTournamentMatches(pageLeaveLobbyId, userId, 'page_leave')
                                await forfeitActiveOnlineMatch(pageLeaveLobbyId, userId, 'page_leave')
                            } catch (err) {
                                request.log.error({ err }, 'forfeit on page leave failed')
                            }
                        }

                        if (pageLeaveLobby && Number(pageLeaveLobby.hostUserId) === Number(userId)) {
                            await closeLobby(pageLeaveLobbyId, 'host_left')
                        } else if (pageLeaveLobby) {
                            pageLeaveLobby.memberUserIds.delete(userId)
                            lobbyIdByMemberUserId.delete(userId)
                            await setGameStateAndNotify(userId, 'inLobby')
                            broadcastToUser(userId, { type: 'game/lobby/left', ok: true, lobbyId: pageLeaveLobbyId })
                            broadcastLobbySnapshot(pageLeaveLobbyId)
                        } else {
                            lobbyIdByMemberUserId.delete(userId)
                            await setGameStateAndNotify(userId, 'inLobby')
                        }
                    } else if (pageLeaveHostLobbyId) {
                        const hostedLobby = lobbiesById.get(pageLeaveHostLobbyId)
                        const hasActiveOnlineMatch = !!(hostedLobby && hostedLobby.activeOnlineMatch && hostedLobby.activeOnlineMatch.beganAt)
                        const hasActiveTournamentMatch = !!(tournamentsByLobbyId.get(pageLeaveHostLobbyId)?.activeMatch)

                        if (hasActiveOnlineMatch || hasActiveTournamentMatch) {
                            try {
                                await forfeitAllRemainingTournamentMatches(pageLeaveHostLobbyId, userId, 'page_leave')
                                await forfeitActiveOnlineMatch(pageLeaveHostLobbyId, userId, 'page_leave')
                            } catch (err) {
                                request.log.error({ err }, 'forfeit on page leave (host) failed')
                            }
                        }
                        await closeLobby(pageLeaveHostLobbyId, 'host_left')
                    } else {
                        await setGameStateAndNotify(userId, 'inLobby')
                    }

                    const inviteIdsToRemove = []
                    for (const [inviteId, invite] of invitesById.entries()) {
                        if ((Number(invite.fromUserId) === Number(userId) || Number(invite.toUserId) === Number(userId)) && invite.status === 'pending') {
                            inviteIdsToRemove.push(inviteId)
                        }
                    }
                    for (const inviteId of inviteIdsToRemove) {
                        const invite = invitesById.get(inviteId)
                        if (!invite) continue
                        invite.status = 'cancelled'
                        invitesById.delete(inviteId)
                        const pairKey = `${invite.fromUserId}:${invite.toUserId}`
                        if (pendingInviteIdByPair.get(pairKey) === inviteId) {
                            pendingInviteIdByPair.delete(pairKey)
                        }
                        broadcastToUser(invite.fromUserId, { type: 'game/invite/expired', inviteId })
                        broadcastToUser(invite.toUserId, { type: 'game/invite/expired', inviteId })
                    }

                    send(ws, { type: 'game/page/left', ok: true })
                    return
                }

                if (msg.type === 'game/invite/send') {
                    const toUserId = Number(msg.toUserId)
                    if (!Number.isFinite(toUserId) || toUserId <= 0) {
                        return send(ws, { type: 'error', error: 'invalid_to' })
                    }
                    if (toUserId === userId) {
                        return send(ws, { type: 'error', error: 'cannot_invite_self' })
                    }

                    const pairKey = `${userId}:${toUserId}`
                    const existingInviteId = pendingInviteIdByPair.get(pairKey)
                    if (existingInviteId) {
                        const existing = invitesById.get(existingInviteId)
                        if (existing && existing.status === 'pending' && existing.expiresAt > nowMs()) {
                            return send(ws, {
                                type: 'error',
                                error: 'invite_already_pending',
                                inviteId: existingInviteId,
                                expiresAt: existing.expiresAt,
                            })
                        }
                        pendingInviteIdByPair.delete(pairKey)
                    }

                    const myLobbyId = getLobbyIdForUser(userId)
                    const myHostLobbyId = getHostedLobbyId(userId) || null
                    if (myLobbyId && myHostLobbyId && myLobbyId !== myHostLobbyId) {
                        return send(ws, { type: 'error', error: 'already_in_lobby' })
                    }
                    if (myLobbyId && !myHostLobbyId) {
                        return send(ws, { type: 'error', error: 'already_in_lobby' })
                    }

                    if (getGameState(userId) === 'inGame') {
                        return send(ws, { type: 'error', error: 'already_in_game' })
                    }

                    const friends = await areFriends(userId, toUserId)
                    if (!friends) {
                        return send(ws, { type: 'error', error: 'not_friends' })
                    }

                    const blocked = await isBlockedEitherWay(userId, toUserId)
                    if (blocked) {
                        return send(ws, { type: 'error', error: 'blocked' })
                    }

                    const targetOnline = socketsByUserId.has(toUserId)
                    if (!targetOnline) {
                        return send(ws, { type: 'error', error: 'user_offline' })
                    }

                    if (getGameState(toUserId) === 'inGame') {
                        return send(ws, { type: 'error', error: 'user_in_game' })
                    }

                    const targetLobbyId = getLobbyIdForUser(toUserId)
                    if (targetLobbyId) {
                        return send(ws, { type: 'error', error: 'user_in_lobby' })
                    }

                    const lobbyId = ensureLobbyForHost(userId)
                    const inviteId = randomId()
                    const invite = {
                        id: inviteId,
                        lobbyId,
                        fromUserId: userId,
                        toUserId,
                        createdAt: nowMs(),
                        expiresAt: nowMs() + INVITE_TTL_MS,
                        status: 'pending'
                    }

                    invitesById.set(inviteId, invite)
                    pendingInviteIdByPair.set(pairKey, inviteId)
                    scheduleInviteExpiry(inviteId)

                    broadcastToUser(toUserId, {
                        type: 'game/invite/received',
                        inviteId,
                        lobbyId,
                        fromUserId: userId,
                        fromAlias: alias,
                        expiresAt: invite.expiresAt
                    })

                    return send(ws, {
                        type: 'game/invite/sent',
                        inviteId,
                        lobbyId,
                        toUserId,
                        expiresAt: invite.expiresAt
                    })
                }

                if (msg.type === 'game/invite/accept' || msg.type === 'game/invite/reject') {
                    const inviteId = String(msg.inviteId || '')
                    const invite = invitesById.get(inviteId)
                    if (!invite) {
                        return send(ws, { type: 'error', error: 'invite_not_found' })
                    }
                    if (invite.toUserId !== userId) {
                        return send(ws, { type: 'error', error: 'not_invited_user' })
                    }
                    if (invite.status !== 'pending') {
                        return send(ws, { type: 'error', error: 'invite_not_pending' })
                    }

                    if (msg.type === 'game/invite/reject') {
                        invite.status = 'rejected'
                        invitesById.delete(inviteId)

                        const pairKey = `${invite.fromUserId}:${invite.toUserId}`
                        if (pendingInviteIdByPair.get(pairKey) === inviteId) {
                            pendingInviteIdByPair.delete(pairKey)
                        }

                        broadcastToUser(invite.fromUserId, { type: 'game/invite/rejected', inviteId, byUserId: userId })
                        broadcastToUser(invite.toUserId, { type: 'game/invite/rejected', inviteId, byUserId: userId })
                        return
                    }

                    if (getGameState(userId) === 'inGame') {
                        return send(ws, { type: 'error', error: 'already_in_game' })
                    }

                    const currentLobbyId = getLobbyIdForUser(userId)
                    if (currentLobbyId && currentLobbyId !== invite.lobbyId) {
                        return send(ws, { type: 'error', error: 'already_in_lobby' })
                    }

                    invite.status = 'accepted'
                    invitesById.delete(inviteId)

                    {
                        const pairKey = `${invite.fromUserId}:${invite.toUserId}`
                        if (pendingInviteIdByPair.get(pairKey) === inviteId) {
                            pendingInviteIdByPair.delete(pairKey)
                        }
                    }

                    const lobby = lobbiesById.get(invite.lobbyId)
                    if (!lobby) {
                        return send(ws, { type: 'error', error: 'lobby_not_found' })
                    }

                    lobby.memberUserIds.add(userId)
                    lobbyIdByMemberUserId.set(userId, invite.lobbyId)

                    await setGameStateAndNotify(userId, 'inGame')

                    if (lobby.hostUserId) {
                        await setGameStateAndNotify(lobby.hostUserId, 'inGame')
                    }

                    const snapshot = getLobbySnapshot(invite.lobbyId)

                    broadcastToUser(invite.fromUserId, {
                        type: 'game/invite/accepted',
                        inviteId,
                        lobbyId: invite.lobbyId,
                        byUserId: userId,
                        byAlias: alias,
                        lobby: snapshot
                    })

                    broadcastToUser(invite.toUserId, {
                        type: 'game/invite/accepted',
                        inviteId,
                        lobbyId: invite.lobbyId,
                        byUserId: userId,
                        byAlias: alias,
                        lobby: snapshot
                    })

                    broadcastLobbySnapshot(invite.lobbyId)

                    return
                }

                if (msg.type === 'game/lobby/leave') {
                    let lobbyId = getLobbyIdForUser(userId)
                    if (!lobbyId) {
                        const hostedLobbyId = getHostedLobbyId(userId)
                        if (hostedLobbyId) {
                            await closeLobby(hostedLobbyId, 'host_left')
                            return
                        }
                        await setGameStateAndNotify(userId, 'inLobby')
                        return send(ws, { type: 'game/lobby/left', ok: true })
                    }

                    const activeTournament = tournamentsByLobbyId.get(lobbyId)
                    if (activeTournament && !activeTournament.finished) {
                        send(ws, { type: 'game/lobby/leave/warning', reason: 'tournament_active', tournamentId: activeTournament.id })
                    }

                    const lobby = lobbiesById.get(lobbyId)
                    if (!lobby) {
                        lobbyIdByMemberUserId.delete(userId)
                        await setGameStateAndNotify(userId, 'inLobby')
                        return send(ws, { type: 'game/lobby/left', ok: true })
                    }

                    try {
                        await forfeitAllRemainingTournamentMatches(lobbyId, userId, 'left')
                        await forfeitActiveOnlineMatch(lobbyId, userId, 'left')
                    } catch (err) {
                        request.log.error({ err }, 'forfeit on leave failed')
                    }

                    if (lobby.hostUserId === userId) {
                        await closeLobby(lobbyId, 'host_left')
                        return
                    }

                    lobby.memberUserIds.delete(userId)
                    lobbyIdByMemberUserId.delete(userId)
                    await setGameStateAndNotify(userId, 'inLobby')

                    broadcastToUser(userId, { type: 'game/lobby/left', ok: true, lobbyId })
                    broadcastLobbySnapshot(lobbyId)
                    return
                }

                if (msg.type === 'game/lobby/close') {
                    const lobbyId = getHostedLobbyId(userId)
                    if (!lobbyId) {
                        return send(ws, { type: 'error', error: 'no_lobby' })
                    }

                    try {
                        await forfeitAllRemainingTournamentMatches(lobbyId, userId, 'closed')
                        await forfeitActiveOnlineMatch(lobbyId, userId, 'closed')
                    } catch (err) {
                        request.log.error({ err }, 'forfeit on close failed')
                    }
                    await closeLobby(lobbyId, 'host_closed')
                    return
                }

                if (msg.type === 'game/lobby/snapshot') {
                    const lobbyId = getHostedLobbyId(userId)
                    if (!lobbyId) {
                        return send(ws, { type: 'error', error: 'no_lobby' })
                    }
                    const snapshot = getLobbySnapshot(lobbyId)
                    if (!snapshot) {
                        return send(ws, { type: 'error', error: 'no_lobby' })
                    }
                    send(ws, { type: 'game/lobby/snapshot', lobby: snapshot })
                    maybeResendPendingHostConfirm(ws, userId)
                    return
                }

                if (msg.type === 'game/lobby/get') {
                    const lobbyId = getLobbyIdForUser(userId)
                    if (!lobbyId) {
                        send(ws, { type: 'game/lobby/snapshot', lobby: null })
                        return
                    }
                    const snapshot = getLobbySnapshot(lobbyId)
                    send(ws, { type: 'game/lobby/snapshot', lobby: snapshot })
                    maybeResendPendingHostConfirm(ws, userId)
                    return
                }

                if (msg.type === 'game/match/start') {
                    const lobbyId = getHostedLobbyId(userId) || null
                    if (!lobbyId) return send(ws, { type: 'error', error: 'no_lobby' })

                    const lobby = lobbiesById.get(lobbyId)
                    if (!lobby) return send(ws, { type: 'error', error: 'lobby_not_found' })

                    if (lobby.hostUserId !== userId) {
                        return send(ws, { type: 'error', error: 'not_host' })
                    }

                    if (!lobby.memberUserIds || lobby.memberUserIds.size !== 2) {
                        return send(ws, { type: 'error', error: 'invalid_lobby_size' })
                    }

                    if (isLobbyLockedByActiveMatch(lobbyId)) {
                        return send(ws, { type: 'error', error: 'match_in_progress' })
                    }

                    const existingTournament = tournamentsByLobbyId.get(lobbyId)
                    if (existingTournament && !existingTournament.finished) {
                        return send(ws, { type: 'error', error: 'tournament_active' })
                    }

                    const matchId = randomId()
                    const members = Array.from(lobby.memberUserIds)
                    const codesByUserId = new Map()
                    for (const uid of members) {
                        const code = String(Math.floor(100000 + Math.random() * 900000))
                        codesByUserId.set(uid, code)
                    }

                    const readyByUserId = new Map()
                    for (const uid of members) readyByUserId.set(uid, false)

                    lobby.activeOnlineMatch = {
                        matchId,
                        codesByUserId,
                        readyByUserId,
                        hostOnly: true,
                        startedAt: nowMs(),
                        beganAt: null,
                    }

                    const codes = {}
                    for (const [uid, code] of codesByUserId.entries()) {
                        codes[String(uid)] = code
                    }

                    broadcastLobbyToMembers(lobbyId, {
                        type: 'game/match/start',
                        lobbyId,
                        hostUserId: userId,
                        matchId,
                        hostOnly: true,
                        codes,
                        phase: 'created',
                        ts: nowMs()
                    })
                    return
                }

                if (msg.type === 'game/match/ready') {
                    const lobbyId = getLobbyIdForUser(userId)
                    if (!lobbyId) return send(ws, { type: 'error', error: 'no_lobby' })

                    const lobby = lobbiesById.get(lobbyId)
                    if (!lobby || !lobby.activeOnlineMatch) return send(ws, { type: 'error', error: 'no_active_match' })
                    if (!lobby.memberUserIds || lobby.memberUserIds.size !== 2 || !lobby.memberUserIds.has(userId)) {
                        return send(ws, { type: 'error', error: 'invalid_lobby_size' })
                    }

                    const matchId = String(msg.matchId || '')
                    if (!matchId || String(lobby.activeOnlineMatch.matchId) !== matchId) {
                        return send(ws, { type: 'error', error: 'match_mismatch' })
                    }

                    const readyMap = lobby.activeOnlineMatch.readyByUserId
                    if (!(readyMap instanceof Map)) {
                        return send(ws, { type: 'error', error: 'server_error' })
                    }
                    readyMap.set(userId, true)

                    send(ws, { type: 'game/match/ready/ack', lobbyId, matchId, ok: true })

                    let allReady = true
                    for (const uid of lobby.memberUserIds) {
                        if (!readyMap.get(uid)) allReady = false
                    }
                    if (!allReady) return

                    if (!lobby.activeOnlineMatch.beganAt) {
                        lobby.activeOnlineMatch.beganAt = nowMs()
                    }

                    const codes = {}
                    for (const [uid, code] of lobby.activeOnlineMatch.codesByUserId.entries()) {
                        codes[String(uid)] = code
                    }

                    const hostId = Number(lobby.hostUserId)
                    const members = Array.from(lobby.memberUserIds)
                    const opponentId = members.find(id => Number(id) !== hostId)
                    if (!opponentId) {
                        return send(ws, { type: 'error', error: 'no_opponent' })
                    }

                    broadcastToUser(hostId, {
                        type: 'game/match/begin',
                        lobbyId,
                        hostUserId: hostId,
                        matchId,
                        hostOnly: true,
                        codes,
                        ts: nowMs(),
                    })

                    broadcastToUser(opponentId, {
                        type: 'game/match/spectate',
                        lobbyId,
                        hostUserId: hostId,
                        matchId,
                        hostOnly: true,
                        ts: nowMs(),
                    })
                    return
                }

                if (msg.type === 'match/result/confirm') {
                    const lobbyId = getLobbyIdForUser(userId)
                    if (!lobbyId) return send(ws, { type: 'error', error: 'no_lobby' })

                    const lobby = lobbiesById.get(lobbyId)
                    if (!lobby) return send(ws, { type: 'error', error: 'lobby_not_found' })
                    if (!lobby.memberUserIds || lobby.memberUserIds.size !== 2) {
                        return send(ws, { type: 'error', error: 'invalid_lobby_size' })
                    }

                    const active = lobby.activeOnlineMatch
                    const matchId = msg.matchId != null ? String(msg.matchId) : null
                    if (!active || !active.matchId || !matchId || String(active.matchId) !== matchId) {
                        return send(ws, { type: 'error', error: 'no_active_match' })
                    }

                    const matchKey = `${lobbyId}:${matchId}`
                    const pending = pendingMatchResultsByKey.get(matchKey)
                    if (!pending || pending.kind !== 'host_confirm') {
                        return send(ws, { type: 'error', error: 'no_pending_result' })
                    }

                    if (Number(userId) !== Number(pending.opponentUserId)) {
                        return send(ws, { type: 'error', error: 'not_opponent' })
                    }

                    const accept = msg.accept === true
                    pendingMatchResultsByKey.delete(matchKey)
                    const to = pendingMatchTimeoutsByKey.get(matchKey)
                    if (to) {
                        clearTimeout(to)
                        pendingMatchTimeoutsByKey.delete(matchKey)
                    }

                    if (!accept) {
                        lobby.activeOnlineMatch = null
                        broadcastLobbyToMembers(lobbyId, {
                            type: 'match/result/rejected',
                            lobbyId,
                            tournamentId: null,
                            matchId,
                            reason: 'rejected_by_opponent'
                        })

                        await unlockLobbyMembers(lobbyId)
                        return
                    }

                    const player1Id = Number(pending.player1Id)
                    const player2Id = Number(pending.player2Id)
                    const player1Score = Number(pending.player1Score)
                    const player2Score = Number(pending.player2Score)

                    let winnerId = null
                    if (player1Score > player2Score) winnerId = player1Id
                    else if (player2Score > player1Score) winnerId = player2Id

                    try {
                        const dbMatchId = await persistVerifiedMatch({
                            mode: 'ONLINE',
                            player1Id,
                            player2Id,
                            player1Score,
                            player2Score,
                            winnerId,
                            tournamentId: null,
                            stage: null,
                        })

                        lobby.activeOnlineMatch = null
                        broadcastLobbyToMembers(lobbyId, {
                            type: 'match/result/confirmed',
                            lobbyId,
                            tournamentId: null,
                            matchId,
                            dbMatchId,
                            player1Id,
                            player2Id,
                            player1Score,
                            player2Score,
                            winnerId,
                            reason: 'confirmed_by_opponent'
                        })

                        await unlockLobbyMembers(lobbyId)
                    } catch (err) {
                        lobby.activeOnlineMatch = null
                        request.log.error({ err }, 'ws host-only match result persist failed')
                        broadcastLobbyToMembers(lobbyId, {
                            type: 'match/result/rejected',
                            lobbyId,
                            tournamentId: null,
                            matchId,
                            reason: 'persist_failed'
                        })

                        await unlockLobbyMembers(lobbyId)
                    }

                    return
                }

                if (msg.type === 'tournament/close') {
                    const lobbyId = getHostedLobbyId(userId) || null
                    if (!lobbyId) return send(ws, { type: 'error', error: 'no_lobby' })

                    const tournament = tournamentsByLobbyId.get(lobbyId)
                    if (!tournament) return send(ws, { type: 'error', error: 'no_tournament' })

                    try {
                        if (tournament.activeMatch && tournament.activeMatch.matchId) {
                            await forfeitActiveTournamentMatch(lobbyId, userId, 'tournament_force_close')
                        }
                    } catch (err) {
                        request.log.error({ err }, 'tournament force-close forfeit failed')
                    }

                    tournament.activeMatch = null
                    tournamentsByLobbyId.delete(lobbyId)
                    pendingMatchResultsByKey.delete(lobbyId)
                    clearPendingTimeoutsForLobby(lobbyId)
                    for (const k of pendingMatchResultsByKey.keys()) {
                        if (typeof k === 'string' && k.startsWith(`${lobbyId}:`)) {
                            pendingMatchResultsByKey.delete(k)
                        }
                    }

                    broadcastLobbyToMembers(lobbyId, {
                        type: 'tournament/closed',
                        lobbyId,
                        reason: 'host_closed'
                    })

                    const lobby = lobbiesById.get(lobbyId)
                    if (lobby && lobby.memberUserIds) {
                        for (const uid of lobby.memberUserIds) {
                            await setGameStateAndNotify(uid, 'inLobby')
                        }
                    }
                    return
                }

                if (msg.type === 'chat/send') {
                    const toUserId = Number(msg.toUserId)
                    const body = typeof msg.text === 'string' ? msg.text.trim() : ''

                    if (!Number.isFinite(toUserId) || toUserId <= 0) {
                        return send(ws, { type: 'error', error: 'invalid_to' })
                    }
                    if (toUserId === userId) {
                        return send(ws, { type: 'error', error: 'cannot_message_self' })
                    }
                    if (!body || body.length > 1000) {
                        return send(ws, { type: 'error', error: 'invalid_text' })
                    }

                    const friends = await areFriends(userId, toUserId)
                    if (!friends) {
                        return send(ws, { type: 'error', error: 'not_friends' })
                    }

                    const blocked = await isBlockedEitherWay(userId, toUserId)
                    if (blocked) {
                        return send(ws, { type: 'error', error: 'blocked' })
                    }

                    const payload = {
                        type: 'chat/message',
                        fromUserId: userId,
                        toUserId,
                        text: body,
                        ts: nowMs()
                    }

                    broadcastToUser(toUserId, payload)
                    broadcastToUser(userId, payload)
                    return
                }


                if (msg.type === 'tournament/create') {
                    const lobbyId = getHostedLobbyId(userId) || null
                    if (!lobbyId) return send(ws, { type: 'error', error: 'no_lobby' })

                    const lobby = lobbiesById.get(lobbyId)
                    if (!lobby) return send(ws, { type: 'error', error: 'lobby_not_found' })

                    const lobbySize = lobby.memberUserIds ? lobby.memberUserIds.size : 0
                    if (!lobby.memberUserIds || lobbySize < 4 || lobbySize % 2 !== 0) {
                        return send(ws, { type: 'error', error: 'tournament_requires_4_players' })
                    }

                    const existing = tournamentsByLobbyId.get(lobbyId)
                    if (existing && !existing.finished) {
                        return send(ws, { type: 'error', error: 'tournament_already_exists' })
                    }
                    if (existing && existing.finished) {
                        tournamentsByLobbyId.delete(lobbyId)
                    }

                    const unique = Array.from(new Set(Array.from(lobby.memberUserIds)))
                    if (unique.length !== lobbySize) return send(ws, { type: 'error', error: 'tournament_requires_4_players' })

                    for (const pid of unique) {
                        if (!lobby.memberUserIds.has(pid)) {
                            return send(ws, { type: 'error', error: 'participant_not_in_lobby' })
                        }
                    }

                    const uniqueSet = new Set(unique)
                    for (const pid of lobby.memberUserIds) {
                        if (!uniqueSet.has(pid)) {
                            return send(ws, { type: 'error', error: 'participants_must_match_lobby' })
                        }
                    }

                    const tournamentId = randomId()
                    const bracket = createTournamentBracket(unique)
                    if (bracket && bracket.error) {
                        return send(ws, { type: 'error', error: 'tournament_requires_4_players' })
                    }

                    const tournamentObj = {
                        id: tournamentId,
                        participantUserIds: unique,
                        bracket,
                        activeMatch: null,
                        finished: false,
                    }

                    tournamentsByLobbyId.set(lobbyId, tournamentObj)

                    for (const uid of lobby.memberUserIds) {
                        await setGameStateAndNotify(uid, 'inGame')
                    }

                    broadcastLobbyToMembers(lobbyId, {
                        type: 'tournament/created',
                        lobbyId,
                        tournamentId,
                        participantUserIds: unique
                    })

                    broadcastLobbyToMembers(lobbyId, {
                        type: 'tournament/notification',
                        event: 'created',
                        lobbyId,
                        tournamentId,
                    })

                    broadcastLobbyToMembers(lobbyId, tournamentToStatePayload(lobbyId, tournamentObj))

                    // Announce first upcoming match to entire lobby
                    resolveTournamentMatchPlayers(tournamentObj)
                    const firstReady = getNextReadyTournamentMatch(tournamentObj)
                    if (firstReady && firstReady.player1Id && firstReady.player2Id) {
                        broadcastLobbyToMembers(lobbyId, {
                            type: 'tournament/match/announce',
                            lobbyId,
                            tournamentId,
                            matchId: firstReady.id,
                            player1Id: firstReady.player1Id,
                            player2Id: firstReady.player2Id,
                            player1Alias: getUserAlias(firstReady.player1Id) || String(firstReady.player1Id),
                            player2Alias: getUserAlias(firstReady.player2Id) || String(firstReady.player2Id),
                            stage: firstReady.stage || '',
                        })
                    }
                    return
                }

                if (msg.type === 'tournament/match/start') {
                    const lobbyId = getHostedLobbyId(userId) || null
                    if (!lobbyId) return send(ws, { type: 'error', error: 'no_lobby' })

                    const lobby = lobbiesById.get(lobbyId)
                    if (!lobby) return send(ws, { type: 'error', error: 'lobby_not_found' })

                    const tournament = tournamentsByLobbyId.get(lobbyId)
                    if (!tournament) return send(ws, { type: 'error', error: 'no_tournament' })
                    if (String(msg.tournamentId || '') !== String(tournament.id)) {
                        return send(ws, { type: 'error', error: 'tournament_mismatch' })
                    }

                    if (!Array.isArray(tournament.participantUserIds) || tournament.participantUserIds.length < 4 || tournament.participantUserIds.length % 2 !== 0) {
                        return send(ws, { type: 'error', error: 'tournament_requires_4_players' })
                    }

                    if (tournament.activeMatch) {
                        return send(ws, { type: 'error', error: 'match_already_active' })
                    }

                    const next = getNextReadyTournamentMatch(tournament)
                    if (!next) {
                        tournament.finished = true
                        broadcastLobbyToMembers(lobbyId, tournamentToStatePayload(lobbyId, tournament))
                        return send(ws, { type: 'error', error: 'tournament_finished' })
                    }

                    const player1Id = Number(next.player1Id)
                    const player2Id = Number(next.player2Id)
                    if (!Number.isFinite(player1Id) || !Number.isFinite(player2Id) || player1Id === player2Id) {
                        return send(ws, { type: 'error', error: 'invalid_players' })
                    }
                    if (!lobby.memberUserIds.has(player1Id) || !lobby.memberUserIds.has(player2Id)) {
                        return send(ws, { type: 'error', error: 'players_not_in_lobby' })
                    }

                    tournament.activeMatch = { matchId: next.id, player1Id, player2Id, stage: next.stage, startedAt: nowMs(), hostOnly: true }

                    broadcastLobbyToMembers(lobbyId, {
                        type: 'tournament/match/started',
                        lobbyId,
                        tournamentId: tournament.id,
                        matchId: next.id,
                        player1Id,
                        player2Id,
                        stage: next.stage,
                    })

                    broadcastLobbyToMembers(lobbyId, {
                        type: 'tournament/notification',
                        event: 'next_match',
                        lobbyId,
                        tournamentId: tournament.id,
                        player1Id,
                        player2Id,
                        player1Alias: getUserAlias(player1Id) || String(player1Id),
                        player2Alias: getUserAlias(player2Id) || String(player2Id),
                        stage: next.stage || '',
                    })

                    broadcastToUser(player1Id, {
                        type: 'tournament/match/begin',
                        lobbyId,
                        tournamentId: tournament.id,
                        matchId: next.id,
                        player1Id,
                        player2Id,
                        stage: next.stage,
                        myRole: 'host',
                        ts: nowMs(),
                    })

                    broadcastToUser(player2Id, {
                        type: 'tournament/match/spectate',
                        lobbyId,
                        tournamentId: tournament.id,
                        matchId: next.id,
                        player1Id,
                        player2Id,
                        stage: next.stage,
                        myRole: 'spectator',
                        ts: nowMs(),
                    })

                    broadcastLobbyToMembers(lobbyId, tournamentToStatePayload(lobbyId, tournament))

                    return
                }


                if (msg.type === 'match/result/submit') {
                    const lobbyId = getLobbyIdForUser(userId)
                    if (!lobbyId) {
                        return send(ws, { type: 'error', error: 'no_lobby' })
                    }

                    const lobby = lobbiesById.get(lobbyId)
                    if (!lobby) {
                        return send(ws, { type: 'error', error: 'lobby_not_found' })
                    }

                    const declaredOpponent = msg.opponentUserId != null ? Number(msg.opponentUserId) : null
                    const tournamentId = msg.tournamentId != null ? String(msg.tournamentId) : null
                    const matchId = msg.matchId != null ? String(msg.matchId) : null

                    let matchKey = lobbyId
                    let player1Id = null
                    let player2Id = null
                    let mode = 'ONLINE'

                    if (tournamentId && matchId) {
                        const tournament = tournamentsByLobbyId.get(lobbyId)
                        if (!tournament) return send(ws, { type: 'error', error: 'no_tournament' })
                        if (String(tournament.id) !== tournamentId) return send(ws, { type: 'error', error: 'tournament_mismatch' })
                        if (!tournament.activeMatch || String(tournament.activeMatch.matchId) !== matchId) {
                            return send(ws, { type: 'error', error: 'no_active_match' })
                        }

                        player1Id = Number(tournament.activeMatch.player1Id)
                        player2Id = Number(tournament.activeMatch.player2Id)
                        
                        if (userId !== player1Id) {
                            return send(ws, { type: 'error', error: 'only_host_submits_tournament' })
                        }
                        
                        const opp = player2Id
                        if (declaredOpponent != null && declaredOpponent !== opp) {
                            return send(ws, { type: 'error', error: 'opponent_mismatch' })
                        }

                        matchKey = `${lobbyId}:${matchId}`
                        mode = 'TOURNAMENT'
                    } else {
                        if (!lobby.memberUserIds || lobby.memberUserIds.size !== 2) {
                            return send(ws, { type: 'error', error: 'invalid_lobby_size' })
                        }

                        const active = lobby.activeOnlineMatch
                        if (!active || !active.matchId) {
                            return send(ws, { type: 'error', error: 'no_active_match' })
                        }
                        if (!matchId || String(matchId) !== String(active.matchId)) {
                            return send(ws, { type: 'error', error: 'match_mismatch' })
                        }

                        if (active.hostOnly) {
                            if (Number(userId) !== Number(lobby.hostUserId)) {
                                return send(ws, { type: 'error', error: 'not_host' })
                            }
                        }

                        const members = Array.from(lobby.memberUserIds)
                        const opponentId = members.find(id => id !== userId)
                        if (!opponentId) {
                            return send(ws, { type: 'error', error: 'no_opponent' })
                        }

                        if (declaredOpponent != null && declaredOpponent !== opponentId) {
                            return send(ws, { type: 'error', error: 'opponent_mismatch' })
                        }

                        player1Id = lobby.hostUserId
                        const otherId = members.find(id => id !== lobby.hostUserId)
                        player2Id = otherId || opponentId

                        matchKey = `${lobbyId}:${matchId}`
                    }

                    const myScore = Number(msg.myScore)
                    const opponentScore = Number(msg.opponentScore)

                    if (!Number.isInteger(myScore) || myScore < 0 || myScore > 50) {
                        return send(ws, { type: 'error', error: 'invalid_my_score' })
                    }
                    if (!Number.isInteger(opponentScore) || opponentScore < 0 || opponentScore > 50) {
                        return send(ws, { type: 'error', error: 'invalid_opponent_score' })
                    }

                    let pending = pendingMatchResultsByKey.get(matchKey)
                    if (!pending) {
                        pending = { submissions: new Map() }
                        pendingMatchResultsByKey.set(matchKey, pending)
                    }

                    if (!tournamentId) {
                        const active = lobby.activeOnlineMatch
                        if (active && active.hostOnly) {
                            const player1Score = myScore
                            const player2Score = opponentScore

                            pendingMatchResultsByKey.set(matchKey, {
                                kind: 'host_confirm',
                                player1Id,
                                player2Id,
                                player1Score,
                                player2Score,
                                hostUserId: Number(lobby.hostUserId),
                                opponentUserId: Number(player2Id),
                                ts: nowMs(),
                            })

                            const timeoutId = pendingMatchTimeoutsByKey.get(matchKey)
                            if (!timeoutId) {
                                const to = setTimeout(() => {
                                    pendingMatchTimeoutsByKey.delete(matchKey)
                                    if (pendingMatchResultsByKey.has(matchKey)) {
                                        pendingMatchResultsByKey.delete(matchKey)
                                    }
                                    const lobbyObj = lobbiesById.get(lobbyId)
                                    if (lobbyObj && lobbyObj.activeOnlineMatch && matchId && String(lobbyObj.activeOnlineMatch.matchId) === String(matchId)) {
                                        lobbyObj.activeOnlineMatch = null
                                    }

                                    unlockLobbyMembersFireAndForget(lobbyId)
                                    broadcastLobbyToMembers(lobbyId, {
                                        type: 'match/result/rejected',
                                        lobbyId,
                                        tournamentId: null,
                                        matchId,
                                        reason: 'timeout'
                                    })
                                }, PENDING_RESULT_TIMEOUT_MS)
                                pendingMatchTimeoutsByKey.set(matchKey, to)
                            }

                            send(ws, { type: 'match/result/pending', lobbyId, tournamentId: null, matchId })

                            broadcastToUser(Number(player2Id), {
                                type: 'match/result/confirm_request',
                                lobbyId,
                                matchId,
                                player1Id,
                                player2Id,
                                player1Score,
                                player2Score,
                            })
                            return
                        }
                    }

                    if (mode === 'TOURNAMENT') {
                        const player1Score = myScore
                        const player2Score = opponentScore
                        
                        let winnerId = null
                        if (player1Score > player2Score) winnerId = player1Id
                        else if (player2Score > player1Score) winnerId = player2Id

                        try {
                            const tournament = tournamentsByLobbyId.get(lobbyId)
                            let stage = null
                            if (tournament && tournament.activeMatch && String(tournament.activeMatch.matchId) === String(matchId) && tournament.activeMatch.stage) {
                                stage = String(tournament.activeMatch.stage).toUpperCase()
                            }

                            const dbMatchId = await db.execute(
                                `INSERT INTO matches (mode, player1_id, player2_id, opponent_label, player1_score, player2_score, winner_id, is_verified, tournament_id, stage)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                                , [mode, player1Id, player2Id, null, player1Score, player2Score, winnerId, 1, tournamentId, stage]
                            )

                            if (player1Score !== player2Score) {
                                if (player1Score > player2Score) {
                                    await db.execute('UPDATE users SET wins = wins + 1 WHERE id = ?', [player1Id])
                                    await db.execute('UPDATE users SET losses = losses + 1 WHERE id = ?', [player2Id])
                                } else {
                                    await db.execute('UPDATE users SET losses = losses + 1 WHERE id = ?', [player1Id])
                                    await db.execute('UPDATE users SET wins = wins + 1 WHERE id = ?', [player2Id])
                                }
                            }

                            if (tournament && tournament.activeMatch && String(tournament.activeMatch.matchId) === String(matchId)) {
                                if (tournament.bracket && tournament.bracket.matchesById) {
                                    const m = tournament.bracket.matchesById.get(String(matchId))
                                    if (m) {
                                        m.completed = true
                                        m.player1Score = player1Score
                                        m.player2Score = player2Score
                                        m.winnerId = winnerId
                                        const loserId = winnerId == null
                                            ? null
                                            : (Number(winnerId) === Number(player1Id) ? player2Id : player1Id)
                                        m.loserId = loserId
                                    }
                                }

                                tournament.activeMatch = null

                                resolveTournamentMatchPlayers(tournament)

                                broadcastLobbyToMembers(lobbyId, tournamentToStatePayload(lobbyId, tournament))

                                // Announce next upcoming match to entire lobby
                                const nextReady = getNextReadyTournamentMatch(tournament)
                                if (nextReady && nextReady.player1Id && nextReady.player2Id) {
                                    broadcastLobbyToMembers(lobbyId, {
                                        type: 'tournament/match/announce',
                                        lobbyId,
                                        tournamentId,
                                        matchId: nextReady.id,
                                        player1Id: nextReady.player1Id,
                                        player2Id: nextReady.player2Id,
                                        player1Alias: getUserAlias(nextReady.player1Id) || String(nextReady.player1Id),
                                        player2Alias: getUserAlias(nextReady.player2Id) || String(nextReady.player2Id),
                                        stage: nextReady.stage || '',
                                    })
                                }

                                try {
                                    const bracket = tournament.bracket
                                    const finalId = bracket && bracket.finalMatchId ? String(bracket.finalMatchId) : null
                                    const thirdId = bracket && bracket.thirdPlaceMatchId ? String(bracket.thirdPlaceMatchId) : null
                                    const finalMatch = finalId && bracket && bracket.matchesById ? bracket.matchesById.get(finalId) : null
                                    const thirdMatch = thirdId && bracket && bracket.matchesById ? bracket.matchesById.get(thirdId) : null

                                    const finalDone = !!finalMatch && !!finalMatch.completed && finalMatch.winnerId != null
                                    const thirdDone = !thirdId || (!!thirdMatch && !!thirdMatch.completed && thirdMatch.winnerId != null)

                                    if (finalDone && thirdDone) {
                                        tournament.finished = true
                                        const placements = []

                                        const championId = Number(finalMatch.winnerId)
                                        const runnerUpId = Number(finalMatch.loserId)
                                        if (Number.isFinite(championId)) placements.push({ userId: championId, place: 1 })
                                        if (Number.isFinite(runnerUpId)) placements.push({ userId: runnerUpId, place: 2 })

                                        if (thirdMatch && thirdMatch.winnerId != null) {
                                            const thirdIdNum = Number(thirdMatch.winnerId)
                                            if (Number.isFinite(thirdIdNum)) placements.push({ userId: thirdIdNum, place: 3 })
                                        }

                                        broadcastLobbyToMembers(lobbyId, {
                                            type: 'tournament/finished',
                                            lobbyId,
                                            tournamentId: tournament.id,
                                            placements,
                                        })
                                        broadcastLobbyToMembers(lobbyId, tournamentToStatePayload(lobbyId, tournament))
                                    }
                                } catch {
                                }
                            }

                            broadcastLobbyToMembers(lobbyId, {
                                type: 'match/result/confirmed',
                                lobbyId,
                                tournamentId,
                                matchId,
                                dbMatchId,
                                player1Id,
                                player2Id,
                                player1Score,
                                player2Score,
                                winnerId,
                            })

                            {
                                const winAlias = winnerId ? (getUserAlias(winnerId) || String(winnerId)) : null
                                broadcastLobbyToMembers(lobbyId, {
                                    type: 'tournament/notification',
                                    event: 'match_won',
                                    lobbyId,
                                    tournamentId,
                                    winnerId,
                                    winnerAlias: winAlias,
                                    score: `${player1Score}-${player2Score}`,
                                })

                                if (tournament && tournament.finished && winnerId) {
                                    const bracket = tournament.bracket
                                    const finalId = bracket && bracket.finalMatchId ? String(bracket.finalMatchId) : null
                                    const finalMatch = finalId && bracket && bracket.matchesById ? bracket.matchesById.get(finalId) : null
                                    if (finalMatch && finalMatch.completed && finalMatch.winnerId != null) {
                                        const champAlias = getUserAlias(Number(finalMatch.winnerId)) || String(finalMatch.winnerId)
                                        broadcastLobbyToMembers(lobbyId, {
                                            type: 'tournament/notification',
                                            event: 'champion',
                                            lobbyId,
                                            tournamentId,
                                            championId: Number(finalMatch.winnerId),
                                            championAlias: champAlias,
                                        })
                                    }
                                }
                            }

                        } catch (err) {
                            console.error('Tournament match persist error:', err)
                            broadcastLobbyToMembers(lobbyId, {
                                type: 'match/result/rejected',
                                lobbyId,
                                tournamentId,
                                matchId,
                                reason: 'persist_failed'
                            })
                        }
                        return
                    }

                    if (mode !== 'TOURNAMENT') {
                        const timeoutId = pendingMatchTimeoutsByKey.get(matchKey)
                        if (!timeoutId) {
                            const to = setTimeout(() => {
                                pendingMatchTimeoutsByKey.delete(matchKey)
                                if (pendingMatchResultsByKey.has(matchKey)) {
                                    pendingMatchResultsByKey.delete(matchKey)
                                }

                                const lobbyObj = lobbiesById.get(lobbyId)
                                if (lobbyObj && lobbyObj.activeOnlineMatch && matchId && String(lobbyObj.activeOnlineMatch.matchId) === String(matchId)) {
                                    lobbyObj.activeOnlineMatch = null
                                }

                                unlockLobbyMembersFireAndForget(lobbyId)

                                broadcastLobbyToMembers(lobbyId, {
                                    type: 'match/result/rejected',
                                    lobbyId,
                                    tournamentId,
                                    matchId,
                                    reason: 'timeout'
                                })
                            }, PENDING_RESULT_TIMEOUT_MS)
                            pendingMatchTimeoutsByKey.set(matchKey, to)
                        }
                    }

                    pending.submissions.set(userId, { myScore, opponentScore, ts: nowMs() })

                    send(ws, { type: 'match/result/pending', lobbyId, tournamentId, matchId })

                    const a = pending.submissions.get(player1Id)
                    const b = pending.submissions.get(player2Id)
                    if (!a || !b) {
                        return
                    }

                    const consistent = a.myScore === b.opponentScore && a.opponentScore === b.myScore
                    if (!consistent) {
                        pendingMatchResultsByKey.delete(matchKey)

                        if (mode !== 'TOURNAMENT') {
                            const to = pendingMatchTimeoutsByKey.get(matchKey)
                            if (to) {
                                clearTimeout(to)
                                pendingMatchTimeoutsByKey.delete(matchKey)
                            }
                        }

                        if (mode !== 'TOURNAMENT') {
                            const to = pendingMatchTimeoutsByKey.get(matchKey)
                            if (to) {
                                clearTimeout(to)
                                pendingMatchTimeoutsByKey.delete(matchKey)
                            }

                            const lobbyObj = lobbiesById.get(lobbyId)
                            if (lobbyObj && lobbyObj.activeOnlineMatch && matchId && String(lobbyObj.activeOnlineMatch.matchId) === String(matchId)) {
                                lobbyObj.activeOnlineMatch = null
                            }

                            await unlockLobbyMembers(lobbyId)
                        }

                        broadcastLobbyToMembers(lobbyId, {
                            type: 'match/result/rejected',
                            lobbyId,
                            tournamentId,
                            matchId,
                            reason: 'mismatch'
                        })
                        return
                    }

                    const player1Sub = pending.submissions.get(player1Id)
                    if (!player1Sub) {
                        pendingMatchResultsByKey.delete(matchKey)

                        if (mode !== 'TOURNAMENT') {
                            const to = pendingMatchTimeoutsByKey.get(matchKey)
                            if (to) {
                                clearTimeout(to)
                                pendingMatchTimeoutsByKey.delete(matchKey)
                            }

                            const lobbyObj = lobbiesById.get(lobbyId)
                            if (lobbyObj && lobbyObj.activeOnlineMatch && String(lobbyObj.activeOnlineMatch.matchId) === String(matchId)) {
                                lobbyObj.activeOnlineMatch = null
                            }

                            await unlockLobbyMembers(lobbyId)
                        }

                        return broadcastLobbyToMembers(lobbyId, {
                            type: 'match/result/rejected',
                            lobbyId,
                            tournamentId,
                            matchId,
                            reason: 'missing_player1'
                        })
                    }

                    const player1Score = player1Sub.myScore
                    const player2Score = player1Sub.opponentScore

                    let winnerId = null
                    if (player1Score > player2Score) winnerId = player1Id
                    else if (player2Score > player1Score) winnerId = player2Id

                    try {
                        let stage = null
                        if (mode === 'TOURNAMENT' && tournamentId) {
                            const t = tournamentsByLobbyId.get(lobbyId)
                            if (t && t.activeMatch && String(t.activeMatch.matchId) === String(matchId) && t.activeMatch.stage) {
                                stage = String(t.activeMatch.stage).toUpperCase()
                            } else if (msg.stage != null) {
                                stage = String(msg.stage).toUpperCase()
                            }
                        }

                        const dbMatchId = await db.execute(
                            `INSERT INTO matches (mode, player1_id, player2_id, opponent_label, player1_score, player2_score, winner_id, is_verified, tournament_id, stage)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                            , [mode, player1Id, player2Id, null, player1Score, player2Score, winnerId, 1, (mode === 'TOURNAMENT' ? tournamentId : null), stage]
                        )

                        if (player1Score !== player2Score) {
                            if (player1Score > player2Score) {
                                await db.execute('UPDATE users SET wins = wins + 1 WHERE id = ?', [player1Id])
                                await db.execute('UPDATE users SET losses = losses + 1 WHERE id = ?', [player2Id])
                            } else {
                                await db.execute('UPDATE users SET losses = losses + 1 WHERE id = ?', [player1Id])
                                await db.execute('UPDATE users SET wins = wins + 1 WHERE id = ?', [player2Id])
                            }
                        }

                        pendingMatchResultsByKey.delete(matchKey)

                        if (mode !== 'TOURNAMENT') {
                            const to = pendingMatchTimeoutsByKey.get(matchKey)
                            if (to) {
                                clearTimeout(to)
                                pendingMatchTimeoutsByKey.delete(matchKey)
                            }
                        }

                        if (mode !== 'TOURNAMENT') {
                            const lobbyObj = lobbiesById.get(lobbyId)
                            if (lobbyObj && lobbyObj.activeOnlineMatch && String(lobbyObj.activeOnlineMatch.matchId) === String(matchId)) {
                                lobbyObj.activeOnlineMatch = null
                            }

                            await unlockLobbyMembers(lobbyId)
                        }

                        if (mode === 'TOURNAMENT') {
                            const tournament = tournamentsByLobbyId.get(lobbyId)
                            if (tournament && tournament.activeMatch && String(tournament.activeMatch.matchId) === String(matchId)) {
                                if (tournament.bracket && tournament.bracket.matchesById) {
                                    const m = tournament.bracket.matchesById.get(String(matchId))
                                    if (m) {
                                        m.completed = true
                                        m.player1Score = player1Score
                                        m.player2Score = player2Score
                                        m.winnerId = winnerId
                                        const loserId = winnerId == null
                                            ? null
                                            : (Number(winnerId) === Number(player1Id) ? player2Id : player1Id)
                                        m.loserId = loserId
                                    }
                                }

                                tournament.activeMatch = null

                                resolveTournamentMatchPlayers(tournament)

                                broadcastLobbyToMembers(lobbyId, tournamentToStatePayload(lobbyId, tournament))

                                try {
                                    const bracket = tournament.bracket
                                    const finalId = bracket && bracket.finalMatchId ? String(bracket.finalMatchId) : null
                                    const thirdId = bracket && bracket.thirdPlaceMatchId ? String(bracket.thirdPlaceMatchId) : null
                                    const finalMatch = finalId && bracket && bracket.matchesById ? bracket.matchesById.get(finalId) : null
                                    const thirdMatch = thirdId && bracket && bracket.matchesById ? bracket.matchesById.get(thirdId) : null

                                    const finalDone = !!finalMatch && !!finalMatch.completed && finalMatch.winnerId != null
                                    const thirdDone = !thirdId || (!!thirdMatch && !!thirdMatch.completed && thirdMatch.winnerId != null)

                                    if (finalDone && thirdDone) {
                                        tournament.finished = true
                                        const placements = []

                                        const championId = Number(finalMatch.winnerId)
                                        const runnerUpId = Number(finalMatch.loserId)
                                        if (Number.isFinite(championId)) placements.push({ userId: championId, place: 1 })
                                        if (Number.isFinite(runnerUpId)) placements.push({ userId: runnerUpId, place: 2 })

                                        if (thirdMatch && thirdMatch.winnerId != null) {
                                            const thirdIdNum = Number(thirdMatch.winnerId)
                                            if (Number.isFinite(thirdIdNum)) placements.push({ userId: thirdIdNum, place: 3 })
                                        }

                                        broadcastLobbyToMembers(lobbyId, {
                                            type: 'tournament/finished',
                                            lobbyId,
                                            tournamentId: tournament.id,
                                            placements,
                                        })
                                        broadcastLobbyToMembers(lobbyId, tournamentToStatePayload(lobbyId, tournament))
                                    }
                                } catch {
                                }
                            }
                        }

                        broadcastLobbyToMembers(lobbyId, {
                            type: 'match/result/confirmed',
                            lobbyId,
                            tournamentId,
                            matchId,
                            dbMatchId,
                            player1Id,
                            player2Id,
                            player1Score,
                            player2Score,
                            winnerId
                        })
                    } catch (err) {
                        pendingMatchResultsByKey.delete(matchKey)

                        if (mode !== 'TOURNAMENT') {
                            const to = pendingMatchTimeoutsByKey.get(matchKey)
                            if (to) {
                                clearTimeout(to)
                                pendingMatchTimeoutsByKey.delete(matchKey)
                            }

                            const lobbyObj = lobbiesById.get(lobbyId)
                            if (lobbyObj && lobbyObj.activeOnlineMatch && String(lobbyObj.activeOnlineMatch.matchId) === String(matchId)) {
                                lobbyObj.activeOnlineMatch = null
                            }

                            await unlockLobbyMembers(lobbyId)
                        }
                        request.log.error({ err }, 'ws match result persist failed')
                        broadcastLobbyToMembers(lobbyId, {
                            type: 'match/result/rejected',
                            lobbyId,
                            tournamentId,
                            matchId,
                            reason: 'persist_failed'
                        })
                    }

                    return
                }


                return send(ws, { type: 'error', error: 'unknown_type' })
            } catch (err) {
                request.log.error(err)
                return send(ws, { type: 'error', error: 'server_error' })
            }
        })

        ws.on('close', async () => {
            clearInterval(heartbeat)
            const { becameOffline } = markOffline(userId, ws)
            if (becameOffline) {
                await notifyFriendsPresence(userId, 'offline')
            }

            if (!becameOffline) {
                return
            }

            const lobbyId = getLobbyIdForUser(userId)
            const hostLobbyId = getHostedLobbyId(userId)
            if (!lobbyId && !hostLobbyId) {
                userInfoByUserId.delete(userId)
                gameStateByUserId.delete(userId)
                return
            }

            const existingTimer = disconnectForfeitTimersByUserId.get(userId)
            if (existingTimer) clearTimeout(existingTimer)

            const timer = setTimeout(async () => {
                disconnectForfeitTimersByUserId.delete(userId)

                if (socketsByUserId.has(userId)) return

                const currentLobbyId = getLobbyIdForUser(userId)
                const currentHostLobbyId = getHostedLobbyId(userId)

                if (currentLobbyId) {
                    try {
                        await forfeitAllRemainingTournamentMatches(currentLobbyId, userId, 'disconnect')
                        await forfeitActiveOnlineMatch(currentLobbyId, userId, 'disconnect')
                    } catch (err) {
                        request.log.error({ err }, 'forfeit on disconnect failed')
                    }
                }

                userInfoByUserId.delete(userId)
                gameStateByUserId.delete(userId)

                if (currentHostLobbyId) {
                    await closeLobby(currentHostLobbyId, 'host_disconnected')
                    return
                }
                if (currentLobbyId) {
                    const lobby = lobbiesById.get(currentLobbyId)
                    if (lobby && Number(lobby.hostUserId) === Number(userId)) {
                        await closeLobby(currentLobbyId, 'host_disconnected')
                        return
                    }
                }

                if (currentLobbyId) {
                    const lobby = lobbiesById.get(currentLobbyId)
                    if (lobby) {
                        lobby.memberUserIds.delete(userId)
                        lobbyIdByMemberUserId.delete(userId)
                        broadcastLobbySnapshot(currentLobbyId)
                    } else {
                        lobbyIdByMemberUserId.delete(userId)
                    }
                }
            }, DISCONNECT_GRACE_MS)

            disconnectForfeitTimersByUserId.set(userId, timer)
        })
    })
}

module.exports = fp(wsRoutes)
