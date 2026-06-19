require('dotenv').config();

const express = require('express');
const app = express();

const jwt = require('jsonwebtoken');
const db = require('./db');
const bcrypt = require('bcrypt');
const { redisClient, connectRedis } = require('./redisClient');
const crypto = require('crypto');

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

let refreshTokens = [];

const CHALLENGE_TTL_SECONDS = 10 * 60;
const MAX_VERIFICATION_FAILURES = 3;
const COOLDOWN_SECONDS = 5 * 60;

app.post('/token', (req, res) => {
    const refreshToken = req.body.token;
    if (refreshToken == null) return res.sendStatus(401);
    if (!refreshTokens.includes(refreshToken)) return res.sendStatus(403);

    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        const accessToken = generateAccessToken({ id: user.id, name: user.name });
        res.json({ accessToken: accessToken });
    });
});

app.delete('/logout', (req, res) => {
    refreshTokens = refreshTokens.filter(token => token !== req.body.token);
    res.sendStatus(204);
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'username, email, and password are required' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);

        const [result] = await db.execute(
            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
            [username, email, passwordHash]
        );

        res.status(201).json({
            message: 'User registered',
            user: {
                id: result.insertId,
                username: username,
                email: email
            }
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Username or email already exists' });
        }

        console.error(err);
        res.status(500).json({ message: 'Could not register user' });
    }
});

app.post('/login', async (req, res) => {
    // Authenticate User

    const { identifier, password } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ message: 'identifier and password are required' });
    }

    try {
        const [users] = await db.execute(
            'SELECT id, username, email, password_hash FROM users WHERE username = ? OR email = ?',
            [identifier, identifier]
        );

        const userRecord = users[0];

        if (!userRecord) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const passwordMatches = await bcrypt.compare(password, userRecord.password_hash);

        if (!passwordMatches) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const cooldownKey = `login_cooldown:${userRecord.id}`;
        const cooldownTtl = await redisClient.ttl(cooldownKey);

        if (cooldownTtl > 0) {
            return res.status(429).json({
                message: `Too many verification attempts. Try again in ${cooldownTtl} seconds.`
            });
        }

        const verificationCode = createVerificationCode();
        const challengeId = crypto.randomUUID();

        const challenge = {
            userId: userRecord.id,
            username: userRecord.username,
            hashedVerificationCode: hashVerificationCode(verificationCode),
            failureCount: 0,
            createdAt: new Date().toISOString()
        };

        await redisClient.set(
            `login_challenge:${challengeId}`,
            JSON.stringify(challenge),
            {
                EX: CHALLENGE_TTL_SECONDS
            }
        );

        console.log(`Verification code for ${userRecord.username}: ${verificationCode}`);

        res.json({
            challengeId: challengeId,
            message: 'Verification code sent'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not log in' });
    }
});

app.post('/login/verify', async (req, res) => {
    const { challengeId, verificationCode } = req.body;

    if (!challengeId || !verificationCode) {
        return res.status(400).json({ message: 'challengeId and verificationCode are required' });
    }

    try {
        const challengeKey = `login_challenge:${challengeId}`;
        const challengeJson = await redisClient.get(challengeKey);

        if (!challengeJson) {
            return res.status(401).json({ message: 'Invalid or expired challenge' });
        }

        const challenge = JSON.parse(challengeJson);
        const submittedCodeHash = hashVerificationCode(verificationCode);

        if (submittedCodeHash !== challenge.hashedVerificationCode) {
            challenge.failureCount += 1;

            if (challenge.failureCount >= MAX_VERIFICATION_FAILURES) {
                await redisClient.del(challengeKey);

                await redisClient.set(
                    `login_cooldown:${challenge.userId}`,
                    '1',
                    {
                        EX: COOLDOWN_SECONDS
                    }
                );

                return res.status(429).json({
                    message: 'Too many invalid verification attempts. Try again in 5 minutes.'
                });
            }

            const remainingTtl = await redisClient.ttl(challengeKey);

            await redisClient.set(
                challengeKey,
                JSON.stringify(challenge),
                {
                    EX: remainingTtl > 0 ? remainingTtl : CHALLENGE_TTL_SECONDS
                }
            );

            return res.status(401).json({ message: 'Invalid verification code' });
        }

        await redisClient.del(challengeKey);

        const user = {
            id: challenge.userId,
            name: challenge.username
        };

        const accessToken = generateAccessToken(user);
        const refreshToken = jwt.sign(user, process.env.REFRESH_TOKEN_SECRET);
        refreshTokens.push(refreshToken);

        res.json({
            accessToken: accessToken,
            refreshToken: refreshToken
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not verify login' });
    }
});

function createVerificationCode() {
    return String(crypto.randomInt(100000, 1000000));
}

function hashVerificationCode(code) {
    return crypto
        .createHash('sha256')
        .update(code)
        .digest('hex');
}

function generateAccessToken(user) {
    return jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '20m' });
}

connectRedis()
    .then(() => {
        app.listen(4000, () => {
            console.log('Auth server running on port 4000');
        });
    })
    .catch((err) => {
        console.error('Could not connect to Redis', err);
        process.exit(1);
    });