const oauthPlugin = require('@fastify/oauth2')
const fetch = require('node-fetch')
const fs = require('fs')
const path = require('path')

async function authRoutes(fastify, options) {
    const db = options.db

    const isHttps = (request) => {
        const xfProto = (request.headers['x-forwarded-proto'] || '').toString().toLowerCase()
        return xfProto === 'https'
    }

    fastify.register(oauthPlugin, {
        name: 'githubOAuth2',
        credentials: {
            client: {
                id: process.env.GITHUB_CLIENT_ID,
                secret: process.env.GITHUB_CLIENT_SECRET
            },
            auth: oauthPlugin.GITHUB_CONFIGURATION
        },
        scope: ['user:email'],
        startRedirectPath: '/auth/github',
        callbackUri: 'https://localhost/api/users/auth/github/callback',
        cookie: {
            secure: true,
            sameSite: 'lax'
        }
    })

    fastify.get('/auth/github/callback', async (request, reply) => {
        try {
            const token = await fastify.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)

            const accessToken = token.token.access_token
            if (!accessToken) {
                console.error('GitHub OAuth: access token alınamadı:', token)
                return reply.code(400).send({ errorKey: 'api.githubTokenFailed' })
            }

            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'ft_transcendence'
                }
            })

            if (!userResponse || !userResponse.ok)
                return reply.code(401).send({ errorKey: 'api.githubUserFailed' })

            const githubUser = await userResponse.json()
            let user = await db.query('SELECT * FROM users WHERE github_id = ?', [githubUser.id])
            if (!user) {
                let userName = githubUser.login + '_gh'
                let count = 0
                while(await db.query('SELECT * FROM users WHERE alias = ?', [userName])) {
                    count++
                    userName = `${userName}${count}`
                }
                await db.execute(
                    'INSERT INTO users (alias, github_id, avatar_url, is_two_factor_enabled) VALUES (?, ?, ?, 0)',
                    [userName, githubUser.id, 'uploads/default_avatar.jpg']
                )
                user = await db.query('SELECT * FROM users WHERE github_id = ?', [githubUser.id])
            }
            
            if (githubUser.avatar_url) {
                const avatarRes = await fetch(githubUser.avatar_url)
                const buffer = await avatarRes.buffer()

                const fileName = `avatar_${user.id}_github.jpg`
                const uploadPath = path.join(__dirname, '../uploads/', fileName)

                await fs.promises.writeFile(uploadPath, buffer)

                const localAvatarUrl = `/uploads/${fileName}`

                await db.execute(
                    'UPDATE users SET avatar_url = ? WHERE id = ?',
                    [localAvatarUrl, user.id]
                )
            }

            if (user.is_two_factor_enabled) {
                const tempToken = fastify.jwt.sign(
                    {id: user.id, type: '2fa'},
                    { expiresIn: '5m' }
                )

                return reply.setCookie('tempToken', tempToken, {
                    httpOnly: true,
                    secure: isHttps(request),
                    sameSite: 'lax',
                    maxAge: 300,
                    path: '/'
                }).redirect('https://localhost/2fa')
            }

            const finalToken = fastify.jwt.sign(
                { id: user.id, alias: user.alias, type: 'access' },
                { expiresIn: '1h' }
            )

            return reply.setCookie('token', finalToken, {
                httpOnly: true,
                secure: isHttps(request),
                sameSite: 'lax',
                maxAge: 3600,
                path: '/'
            }).redirect('https://localhost/home')
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })
}

module.exports = authRoutes