const bcrypt = require('bcrypt')

function userRoutes(fastify, options) {
    const db = options.db

    const isHttps = (request) => {
        const xfProto = (request.headers['x-forwarded-proto'] || '').toString().toLowerCase()
        return xfProto === 'https'
    }

    fastify.post('/register', async (request, reply) => {
        const { alias, password } = request.body || {}

        if (!alias || alias.length < 3) {
            return reply.code(200).send({ success: false, errorKey: 'auth.usernameMinLength' })
        }
        if (!password || password.length < 6) {
            return reply.code(200).send({ success: false, errorKey: 'auth.passwordMinLength' })
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10)
            const lastID = await db.execute(
                'INSERT INTO users (alias, password) VALUES (?, ?)',
                [alias, hashedPassword]
            )

            return reply.code(201).send({
                success: true,
                messageKey: 'api.registeredSuccess',
                id: lastID
            })
        } catch (err) {
            if (err.message && err.message.includes('UNIQUE')) {
                return reply.code(200).send({ success: false, errorKey: 'auth.aliasAlreadyTaken' })
            }
            return reply.code(200).send({ success: false, errorKey: 'errors.generic' })
        }
    })

    fastify.post('/login', {
        schema: {
            body: {
                type: 'object',
                required: ['alias', 'password'],
                properties: {
                    alias: { type: 'string' },
                    password: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { alias, password } = request.body

        try {
            const user = await db.query('SELECT * FROM users WHERE alias = ?', [alias])

            if (!user) {
                return reply.code(200).send({ success: false, errorKey: 'auth.userNotFound' })
            }

            const passwordMatch = await bcrypt.compare(password, user.password)
            if (!passwordMatch) {
                return reply.code(200).send({ success: false, errorKey: 'auth.invalidCredentials' })
            }

            if (user.is_two_factor_enabled) {
                const tempToken = fastify.jwt.sign(
                    { id: user.id, type: '2fa' },
                    { expiresIn: '5m' }
                )

                return reply.setCookie('tempToken', tempToken, {
                    httpOnly: true,
                    secure: isHttps(request),
                    sameSite: 'lax',
                    maxAge: 300,
                    path: '/'
                }).code(200).send({
                    success: true,
                    messageKey: 'api.twoFARequired',
                    twoFactorRequired: true,
                })
            }

            const token = fastify.jwt.sign(
                { id: user.id, alias: user.alias, type: 'access' },
                { expiresIn: '1h' })

            return reply.setCookie('token', token, {
                httpOnly: true,
                secure: isHttps(request),
                sameSite: 'lax',
                maxAge: 3600,
                path: '/'
            }).code(200).send({
                success: true,
                messageKey: 'api.loginSuccess',
                user: { id: user.id, alias: user.alias },
            })
        } catch (err) {
            return reply.code(200).send({ success: false, errorKey: 'errors.generic' })
        }
    })

    fastify.post('/logout', (request, reply) => {
        return reply.clearCookie('token', { path: '/' })
            .clearCookie('tempToken', { path: '/' })
            .code(200).send({ messageKey: 'api.logoutSuccess' })
    })

    fastify.get('/me',
        { preHandler: [fastify.authenticateFlexible] },
        async (request, reply) => {
            const { id, type } = request.user;

            try {
                const user = await db.query(
                    `
                    SELECT 
                    is_two_factor_enabled
                    FROM users
                    WHERE id = ?
                    `,
                    [id]
                );
                if (!user)
                    return reply.code(404).send({ errorKey: 'api.userNotFound' });

                const needsVerify = type === '2fa';

                return reply.send({
                    twoFAEnabled: !!user.is_two_factor_enabled,
                    twoFANeedsVerify: needsVerify
                });
            } catch (err) {
                console.error('/me error:', err);
                return reply.code(500).send({ errorKey: 'api.serverError' });
            }
        }
    )
}

module.exports = userRoutes