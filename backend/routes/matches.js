function matchesRoutes(fastify, options) {
    const db = options.db

    fastify.post('/', {
        preHandler: [fastify.authenticate],
        schema: {
            body: {
                type: 'object',
                required: ['mode'],
                properties: {
                    myScore: { type: 'integer', minimum: 0 },
                    opponentScore: { type: 'integer', minimum: 0 },
                    mode: { type: 'string', minLength: 1 },
                    opponentUserId: { type: 'integer' },
                    opponentLabel: { type: 'string' },
                }
            }
        }
    }, async (request, reply) => {
        const userId = request.user.id
        const { myScore, opponentScore, mode, opponentUserId, opponentLabel } = request.body

        try {
            const normalizedMode = String(mode || '').trim().toUpperCase()
            if (!normalizedMode) {
                return reply.code(400).send({ errorKey: 'api.invalidMode' })
            }

            let player2Id = null
            let resolvedOpponentLabel = typeof opponentLabel === 'string' && opponentLabel.trim() ? opponentLabel.trim() : null

            if (typeof opponentUserId === 'number') {
                return reply.code(400).send({ error: 'verified_requires_ws' })
            }

            if (normalizedMode === 'TOURNAMENT' || normalizedMode === 'ONLINE') {
                return reply.code(400).send({ error: 'verified_requires_ws' })
            }

            const isVerified = false

            if (!player2Id && !resolvedOpponentLabel) {
                if (normalizedMode === 'AI') resolvedOpponentLabel = 'AI'
                else if (normalizedMode === '2P') resolvedOpponentLabel = 'Local'
                else if (normalizedMode === 'TOURNAMENT') resolvedOpponentLabel = 'Tournament'
            }

            const savedMyScore = 0
            const savedOpponentScore = 0
            const winnerId = null

            const matchId = await db.execute(
                `INSERT INTO matches (mode, player1_id, player2_id, opponent_label, player1_score, player2_score, winner_id, is_verified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                , [normalizedMode, userId, player2Id, resolvedOpponentLabel, savedMyScore, savedOpponentScore, winnerId, isVerified ? 1 : 0]
            )

            if (isVerified && myScore !== opponentScore) {
                if (myScore > opponentScore) {
                    await db.execute('UPDATE users SET wins = wins + 1 WHERE id = ?', [userId])
                    await db.execute('UPDATE users SET losses = losses + 1 WHERE id = ?', [player2Id])
                } else {
                    await db.execute('UPDATE users SET losses = losses + 1 WHERE id = ?', [userId])
                    await db.execute('UPDATE users SET wins = wins + 1 WHERE id = ?', [player2Id])
                }
            }

            return reply.code(201).send({ id: matchId })
        } catch (err) {
            request.log.error({ err }, 'match create failed')
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })

    fastify.get('/me', {
        preHandler: [fastify.authenticate],
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 100 },
                    offset: { type: 'integer', minimum: 0 }
                }
            }
        }
    }, async (request, reply) => {
        const userId = request.user.id
        const limit = Number.isFinite(Number(request.query.limit)) ? Number(request.query.limit) : 20
        const offset = Number.isFinite(Number(request.query.offset)) ? Number(request.query.offset) : 0

        try {
            const rows = await db.queryAll(
                `SELECT
                    m.id,
                    m.created_at,
                    m.mode,
                    m.player1_id,
                    u1.alias AS player1_alias,
                    m.player2_id,
                    u2.alias AS player2_alias,
                    m.opponent_label,
                    m.player1_score,
                    m.player2_score,
                    m.winner_id,
                    m.is_verified,
                    m.tournament_id,
                    m.stage,
                    uw.alias AS winner_alias
                 FROM matches m
                 LEFT JOIN users u1 ON u1.id = m.player1_id
                 LEFT JOIN users u2 ON u2.id = m.player2_id
                 LEFT JOIN users uw ON uw.id = m.winner_id
                 WHERE m.player1_id = ? OR m.player2_id = ?
                 ORDER BY m.created_at DESC
                 LIMIT ? OFFSET ?`,
                [userId, userId, limit, offset]
            )

            const matches = rows.map(r => {
                const verified = !!r.is_verified

                const result = !verified
                    ? 'unverified'
                    : (r.winner_id == null
                        ? 'draw'
                        : (Number(r.winner_id) === Number(userId) ? 'win' : 'loss'))

                const opponent = (Number(r.player1_id) === Number(userId))
                    ? (r.player2_alias || r.opponent_label || 'Unknown')
                    : (r.player1_alias || 'Unknown')

                const myScore = verified
                    ? ((Number(r.player1_id) === Number(userId)) ? r.player1_score : r.player2_score)
                    : null
                const opponentScore = verified
                    ? ((Number(r.player1_id) === Number(userId)) ? r.player2_score : r.player1_score)
                    : null

                let displayMode = verified ? r.mode : r.mode
                const normalizedMode = String(displayMode || '').trim()
                if (!verified && !normalizedMode) {
                    const label = String(r.opponent_label || '').trim().toUpperCase()
                    if (label === 'AI') displayMode = 'AI'
                    else if (label === 'LOCAL') displayMode = '2P'
                    else if (label === 'TOURNAMENT') displayMode = 'TOURNAMENT'
                }
                displayMode = String(displayMode || 'CUSTOM')

                let placement = null
                if (verified && String(r.mode || '').toUpperCase() === 'TOURNAMENT') {
                    const stage = (r.stage || '').toString().toUpperCase()
                    if (stage === 'FINAL') {
                        placement = (Number(r.winner_id) === Number(userId)) ? 1 : 2
                    } else if (stage === 'THIRD_PLACE') {
                        placement = (Number(r.winner_id) === Number(userId)) ? 3 : 4
                    }
                }

                return {
                    id: r.id,
                    created_at: r.created_at,
                    mode: displayMode,
                    opponent,
                    myScore,
                    opponentScore,
                    result,
                    is_verified: verified,
                    winner_alias: r.winner_alias || null,
                    tournament_id: r.tournament_id || null,
                    stage: r.stage || null,
                    placement,
                }
            })

            return reply.code(200).send({ matches })
        } catch (err) {
            request.log.error({ err }, 'match list failed')
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })
}

module.exports = matchesRoutes
