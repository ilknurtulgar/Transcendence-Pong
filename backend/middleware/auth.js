const fp = require('fastify-plugin');

async function authMiddleware(fastify, options) {
    const db = options.db

    fastify.decorate("authenticate", async function (request, reply) {
        try {
            const cookieToken = request.cookies?.token
            const authHeader = request.headers?.authorization
            const bearerToken = (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer '))
                ? authHeader.slice(7).trim()
                : undefined

            const token = cookieToken || bearerToken
            if (!token) return reply.code(401).send({ errorKey: 'api.tokenNotFound' })

            const payload = await fastify.jwt.verify(token)
            if (payload && payload.type !== 'access') {
                return reply.code(401).send({ errorKey: 'api.invalidTokenType' })
            }

            const user = await db.query('SELECT * FROM users WHERE id = ?', [payload.id])
            if (!user) {
                return reply.code(401).send({ errorKey: 'api.userNotFound' })
            }

            request.user = { id: user.id, alias: user.alias, type: payload.type }
        } catch (err) {
            reply.code(401).send({ errorKey: 'api.sessionExpired' })
        }
    })

    fastify.decorate("authenticateFlexible", async function (request, reply) {
        try {
            const accessToken = request.cookies?.token
            if (accessToken) {
                try {
                    const payload = await fastify.jwt.verify(accessToken)
                    if (payload.type === 'access') {
                        const user = await db.query('SELECT * FROM users WHERE id = ?', [payload.id])
                        if (user) {
                            request.user = { id: user.id, alias: user.alias, type: 'access' }
                            return
                        }
                    }
                } catch (err) {
                }
            }

            const tempToken = request.cookies?.tempToken
            if (tempToken) {
                try {
                    const payload = await fastify.jwt.verify(tempToken)
                    if (payload.type === '2fa') {
                        const user = await db.query('SELECT * FROM users WHERE id = ?', [payload.id])
                        if (user) {
                            request.user = { id: user.id, alias: user.alias, type: '2fa' }
                            return
                        }
                    }
                } catch (err) {
                }
            }

            return reply.code(200).send({ authenticated: false })
        } catch (err) {
            return reply.code(200).send({ authenticated: false })
        }
    })
}

module.exports = fp(authMiddleware)