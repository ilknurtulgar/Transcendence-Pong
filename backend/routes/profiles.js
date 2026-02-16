const { request } = require('http')
const bcrypt = require('bcrypt')
const { default: fastify } = require('fastify')

function profilesRoutes(fastify, options) {
    const fs = require('fs')
    const path = require('path')
    const util = require('util')
    const { pipeline } = require('stream')
    const pump = util.promisify(pipeline)

    const db = options.db

    fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.user

        try {
            const user = await db.query('SELECT id, alias, wins, losses, is_two_factor_enabled, avatar_url, COALESCE(language, \'tr\') as language FROM users WHERE id = ?', [id])

            if (!user) {
                return reply.code(404).send({ errorKey: 'api.userNotFound' })
            }

            return reply.code(200).send({ user: user })
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })

    fastify.get('/:alias', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { alias } = request.params
        const userID = request.user.id

        try {
            const targetUser = await db.query('SELECT id, alias, wins, losses, avatar_url FROM users WHERE alias = ?', [alias])

            if (!targetUser) {
                return reply.code(404).send({ success: false, errorKey: 'profile.userNotFound' })
            }

            if (targetUser.id === userID) {
                return reply.code(200).send({ user: targetUser })
            }

            const areFriends = await db.query(
                `SELECT * FROM friends
                WHERE status = 'accepted'
                AND (
                    (user_id = ? AND friend_id = ?)
                    OR (user_id = ? AND friend_id = ?)
                )`,
                [userID, targetUser.id, targetUser.id, userID]
            )

            if (!areFriends) {
                return reply.code(403).send({ success: false, errorKey: 'profile.mustBeFriends' })
            }

            const isBlocked = await db.query(
                `SELECT user_id, friend_id
                FROM friends
                WHERE status = 'blocked'
                AND (
                (user_id = ? AND friend_id = ?)
                OR (user_id = ? AND friend_id = ?)
                )`,
                [userID, targetUser.id, targetUser.id, userID]
            )

            if (isBlocked) {
                if (isBlocked.user_id === userID)
                    return reply.code(403).send({ success: false, errorKey: 'profile.userBlocked' })
                else
                    return reply.code(403).send({ success: false, errorKey: 'profile.youAreBlocked' })
            }

            return reply.code(200).send({ user: targetUser })
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })

    fastify.put('/me', {
        preHandler: [fastify.authenticate],
        schema: {
            body: {
                type: 'object',
                properties: {
                    alias: { type: 'string', minLength: 3 },
                    password: { type: 'string', minLength: 6 },
                    language: { type: 'string', enum: ['tr', 'en', 'fr'] }
                }
            }
        }
    }, async (request, reply) => {
        const { id } = request.user
        const { alias, password, language } = request.body

        try {
            let updateFields = []
            let updateValues = []

            if (alias) {
                updateFields.push('alias = ?')
                updateValues.push(alias)
            }

            if (language && ['tr', 'en', 'fr'].includes(language)) {
                updateFields.push('language = ?')
                updateValues.push(language)
            }

            if (password) {
                const hashedPassword = await bcrypt.hash(password, 10)
                updateFields.push('password = ?')
                updateValues.push(hashedPassword)
            }

            if (updateFields.length === 0) {
                return reply.code(200).send({ success: false, errorKey: 'profile.noDataToUpdate' })
            }

            updateValues.push(id)
            const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`

            await db.query(updateQuery, updateValues)

            const updatedUser = await db.query('SELECT id, alias, wins, losses, is_two_factor_enabled, avatar_url, language FROM users WHERE id = ?', [id])

            return reply.code(200).send({ success: true, messageKey: 'api.profileUpdated', user: updatedUser })
        } catch (err) {
            if (err.message && err.message.includes('UNIQUE'))
                return reply.code(200).send({ success: false, errorKey: 'auth.aliasAlreadyTaken' })

            return reply.code(200).send({ success: false, errorKey: 'errors.generic' })
        }
    })

    fastify.post('/me/avatar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const data = await request.file()

        if (!data)
            return reply.code(400).send({ errorKey: 'api.fileNotUploaded' })

        const allowedExts = ['.png', '.jpg', '.jpeg']
        const ext = path.extname(data.filename).toLowerCase()

        if (!allowedExts.includes(ext)) {
            return reply.code(400).send({ errorKey: 'api.onlyPngJpgAllowed' })
        }

        const userId = request.user.id
        try {
            const user = await db.query('SELECT avatar_url FROM users WHERE id = ?', [userId])

            if (user && user.avatar_url) {
                if (!user.avatar_url.includes('default_avatar.jpg') && !user.avatar_url.includes('default_avatar.png')) {
                    const oldFileName = path.basename(user.avatar_url)
                    const oldFilePath = path.join(__dirname, '../uploads/', oldFileName)
                    try {
                        await fs.promises.unlink(oldFilePath)
                        request.log.info(`Eski avatar silindi: ${oldFilePath}`)
                    } catch (err) {
                        request.log.error(`Eski avatar silinirken hata: ${err.message}`)
                    }
                }
            }

            const newFileName = `avatar_${userId}_${Date.now()}${ext}`
            const uploadPath = path.join(__dirname, '../uploads/', newFileName)

            await pump(data.file, fs.createWriteStream(uploadPath))

            const avatarUrl = `/uploads/${newFileName}`
            await db.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, userId])

            return reply.code(200).send({ messageKey: 'api.avatarUploaded', avatarUrl: avatarUrl })
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })

    fastify.post('/me/friends/add', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { friendAlias } = request.body
        const userId = request.user.id

        try {
            const friend = await db.query('SELECT id FROM users WHERE alias = ?', [friendAlias])

            if (!friend)
                return reply.code(200).send({ success: false, errorKey: 'friends.userNotFound' })
            if (friend.id === userId)
                return reply.code(200).send({ success: false, errorKey: 'friends.cannotAddSelf' })

            const existing = await db.query(
                `SELECT status, user_id, friend_id
                 FROM friends
                 WHERE (user_id = ? AND friend_id = ?)
                    OR (user_id = ? AND friend_id = ?)
                 LIMIT 1`,
                [userId, friend.id, friend.id, userId]
            )

            if (existing) {
                if (existing.status === 'accepted') {
                    return reply.code(200).send({ success: false, errorKey: 'friends.alreadyFriends' })
                }

                if (existing.status === 'pending') {
                    if (existing.user_id === userId) {
                        return reply.code(200).send({ success: false, errorKey: 'friends.requestAlreadySent' })
                    }
                    return reply.code(200).send({ success: false, errorKey: 'friends.theyAlreadySentRequest' })
                }

                if (existing.status === 'blocked') {
                    if (existing.user_id === userId) {
                        return reply.code(200).send({ success: false, errorKey: 'friends.youBlockedUser' })
                    }
                    return reply.code(200).send({ success: false, errorKey: 'friends.userBlockedYou' })
                }
            }

            const isBlocked = await db.query(
                `SELECT user_id, friend_id
                FROM friends
                WHERE status = 'blocked'
                AND (
                (user_id = ? AND friend_id = ?)
                OR (user_id = ? AND friend_id = ?)
                )`,
                [userId, friend.id, friend.id, userId]
            )

            if (isBlocked) {
                if (isBlocked.user_id === userId)
                    return reply.code(200).send({ success: false, errorKey: 'friends.youBlockedUser' })
                else
                    return reply.code(200).send({ success: false, errorKey: 'friends.userBlockedYou' })
            }

            await db.execute(
                `INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')
                 ON CONFLICT(user_id, friend_id) DO NOTHING`,
                [userId, friend.id]
            );

            return reply.code(200).send({ success: true, messageKey: 'api.requestSent' })
        } catch (err) {
            return reply.code(200).send({ success: false, errorKey: 'errors.generic' })
        }
    })

    fastify.get('/me/friends/requests', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const userID = request.user.id

        try {
            const requests = await db.queryAll(
                `SELECT u.id, u.alias, u.avatar_url
                FROM friends f
                JOIN users u ON f.user_id = u.id
                WHERE f.friend_id = ? AND f.status = 'pending'`,
                [userID]);

            return reply.code(200).send({ requests: requests })
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })

    fastify.put('/me/friends/requests/accept', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { friend_id } = request.body
        const userID = request.user.id

        try {
            await db.execute(
                `UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'`,
                [friend_id, userID]
            )

            await db.execute(
                `INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')`,
                [userID, friend_id]
            )

            return reply.code(200).send({ messageKey: 'api.friendRequestAccepted' })
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })

    fastify.get('/me/friends', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const userID = request.user.id

        try {
            const friends = await db.queryAll(
                `SELECT DISTINCT u.id, u.alias, u.avatar_url, u.wins, u.losses
                 FROM friends f
                 JOIN users u
                   ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
                 WHERE f.status = 'accepted'
                   AND (f.user_id = ? OR f.friend_id = ?)
                   AND u.id != ?`,
                [userID, userID, userID, userID]
            )

            return reply.code(200).send({ friends: friends })
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })

    fastify.post('/me/friends/block', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const blocked_id = request.body.friend_id
        const userID = request.user.id

        if (userID == blocked_id) {
            return reply.code(400).send({ errorKey: 'api.cannotBlockSelf' })
        }

        try {
            await db.execute(
                `DELETE FROM friends
                WHERE (user_id = ? AND friend_id = ?)
                OR (user_id = ? AND friend_id = ?)`,
                [userID, blocked_id, blocked_id, userID]
            )

            await db.execute(
                `INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'blocked')`,
                [userID, blocked_id]
            )

            return reply.code(200).send({ messageKey: 'api.userBlocked' })
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })

    fastify.delete('/me/friends/unblock', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const blocked_id = request.body.friend_id
        const userID = request.user.id

        try {
            const result = await db.execute(
                `DELETE FROM friends 
                WHERE user_id = ? AND friend_id = ? AND status = 'blocked'`,
                [userID, blocked_id]
            )

            return reply.code(200).send({ messageKey: 'api.userUnblocked' })
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })

    fastify.get('/me/friends/blocked', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const userID = request.user.id

        try {
            const blockedUsers = await db.queryAll(
                `SELECT u.id, u.alias, u.avatar_url
                FROM friends f
                JOIN users u ON f.friend_id = u.id
                WHERE f.user_id = ? AND f.status = 'blocked'`,
                [userID]
            )

            return reply.code(200).send({ blocked: blockedUsers })
        } catch (err) {
            return reply.code(500).send({ errorKey: 'api.serverError' })
        }
    })
}

module.exports = profilesRoutes