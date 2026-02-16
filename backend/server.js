const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fastify = require('fastify')({ logger: true, trustProxy: true });
const db = require('./db')
const fjwt = require('@fastify/jwt')
const multipart = require('@fastify/multipart')
const cookie = require('@fastify/cookie')

const userRoutes = require('./routes/users')
const twofaRoutes = require('./routes/twofa')
const profilesRoutes = require('./routes/profiles')
const authRoutes = require('./routes/authRoutes')
const matchesRoutes = require('./routes/matches')
const authMiddleware = require('./middleware/auth')
const cors = require('@fastify/cors')
const websocket = require('@fastify/websocket')

fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
})

fastify.register(cookie, {
    secret: process.env.COOKIE_SECRET,
    parseOptions: {}
})

fastify.register(multipart, {
    limits: {
        fileSize: 5 * 1024 * 1024
    }
})

fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, 'uploads'),
    prefix: '/uploads/'
})

fastify.register(fjwt, {
    secret: process.env.JWT_SECRET,
    cookie: {
        cookieName: 'token',
        signed: false
    }
})

fastify.register(websocket)

fastify.register(authMiddleware, { db: db })
fastify.register(userRoutes, {db: db, prefix: '/api/users'})
fastify.register(twofaRoutes, {db: db, prefix: '/api/users'})
fastify.register(profilesRoutes, {db: db, prefix: '/api/profiles'})
fastify.register(authRoutes, {db: db, prefix: '/api/users'})
fastify.register(matchesRoutes, { db: db, prefix: '/api/matches' })

fastify.register(require('./routes/ws'), { db })


const start = async () => {
    try {
        const port = Number(process.env.PORT) || 3000
        const host = process.env.HOST || '0.0.0.0'
        await fastify.listen({ port, host });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

start()