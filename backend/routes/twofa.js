const { authenticator } = require('otplib')
const qrcode = require('qrcode')

function twoFaRoutes(fastify, options) {
    const db = options.db

    const isHttps = (request) => {
        const xfProto = (request.headers['x-forwarded-proto'] || '').toString().toLowerCase()
        return xfProto === 'https'
    }

    fastify.post('/2fa/setup', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id, alias } = request.user

        const secret = authenticator.generateSecret()
        const otpauth = authenticator.keyuri(alias, 'ft_transcendence', secret)
        const qrCodeDataURL = await qrcode.toDataURL(otpauth)

        const setupToken = fastify.jwt.sign(
            { id: id, two_factor_secret: secret, type: '2fa_setup' },
            { expiresIn: '10m' }
        )

        return reply.setCookie('setupToken', setupToken, {
            httpOnly: true,
            secure: isHttps(request),
            sameSite: 'lax',
            maxAge: 600,
            path: '/'
        }).code(200).send({
            messageKey: 'api.twoFASetupStarted',
            qrCode: qrCodeDataURL
        })
    })

    fastify.post('/2fa/enable', async (request, reply) => {
        const { token } = request.body
        const setupToken = request.cookies.setupToken

        if (!setupToken) return reply.code(200).send({ success: false, errorKey: 'twofa.setup.setupError' })

        try {
            const payload = await fastify.jwt.verify(setupToken)

            if (payload.type !== '2fa_setup' || !payload.two_factor_secret) {
                return reply.code(200).send({ success: false, errorKey: 'twofa.setup.setupError' })
            }

            const isValid = authenticator.verify({
                token: token,
                secret: payload.two_factor_secret
            })

            if (!isValid) {
                return reply.code(200).send({ success: false, errorKey: 'twofa.setup.activationError' })
            }

            await db.execute(
                'UPDATE users SET two_factor_secret = ?, is_two_factor_enabled = 1 WHERE id = ?',
                [payload.two_factor_secret, payload.id]
            )

            return reply.clearCookie('setupToken', { path: '/' })
                .code(200).send({ success: true, messageKey: 'api.twoFAEnabled' })
        } catch {
            return reply.code(200).send({ success: false, errorKey: 'errors.generic' })
        }
    })

    fastify.post('/2fa/verify-login', async (request, reply) => {
        const { token } = request.body
        const tempToken = request.cookies.tempToken || request.body.tempToken

        if (!tempToken) {
            return reply.code(200).send({ success: false, errorKey: 'twofa.verify.verificationError' })
        }

        try {
            const payload = await fastify.jwt.verify(tempToken)

            if (payload.type !== '2fa') {
                return reply.code(200).send({ success: false, errorKey: 'twofa.verify.verificationError' })
            }

            const user = await db.query(
                'SELECT * FROM users WHERE id = ?',
                [payload.id]
            )

            const isValid = authenticator.verify({
                token: token,
                secret: user.two_factor_secret
            })

            if (!isValid) {
                return reply.code(200).send({ success: false, errorKey: 'twofa.verify.verificationError' })
            }

            const finalToken = fastify.jwt.sign(
                { id: user.id, alias: user.alias, type: 'access' },
                { expiresIn: '1h' }
            )

            return reply.clearCookie('tempToken').setCookie('token', finalToken, {
                httpOnly: true,
                secure: isHttps(request),
                sameSite: 'lax',
                path: '/',
                maxAge: 3600
            })
                .code(200).send({
                    success: true,
                    messageKey: 'api.loginSuccess',
                    user: { id: user.id, alias: user.alias }
                })
        } catch {
            return reply.code(200).send({ success: false, errorKey: 'errors.generic' })
        }
    })
}

module.exports = twoFaRoutes
