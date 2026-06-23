require('dotenv').config();

const express = require('express');
const app = express();

const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('./db');
const bcrypt = require('bcrypt');
const { redisClient, connectRedis } = require('./redisClient');
const { sendVerificationEmail } = require('./emailService');
const crypto = require('crypto');

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

const CHALLENGE_TTL_SECONDS = 10 * 60;
const MAX_VERIFICATION_FAILURES = 3;
const COOLDOWN_SECONDS = 5 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

app.post('/token', async (req, res) => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
        return res.sendStatus(401);
    }

    let tokenUser;

    try {
        tokenUser = jwt.verify(
            refreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );
    } catch {
        clearRefreshTokenCookie(res);
        return res.sendStatus(403);
    }

    try {
        const storedSession = await redisClient.getDel(
            getRefreshTokenKey(refreshToken)
        );

        if (!storedSession) {
            clearRefreshTokenCookie(res);
            return res.sendStatus(403);
        }

        const user = {
            id: tokenUser.id,
            name: tokenUser.name
        };

        const newRefreshToken = generateRefreshToken(user);

        await storeRefreshSession(newRefreshToken, user);
        setRefreshTokenCookie(res, newRefreshToken);

        const accessToken = generateAccessToken(user);

        res.json({
            accessToken: accessToken
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: 'Could not refresh token'
        });
    }
});

app.delete('/logout', async (req, res) => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
        return res.sendStatus(400);
    }

    try {
        await redisClient.del(getRefreshTokenKey(refreshToken));

        clearRefreshTokenCookie(res);

        res.sendStatus(204);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not log out' });
    }
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

        await sendVerificationEmail(userRecord.email, verificationCode);

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

        const refreshToken = generateRefreshToken(user);

        await storeRefreshSession(refreshToken, user);

        setRefreshTokenCookie(res, refreshToken);

        res.json({
            accessToken: accessToken
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

function hashToken(token) {
    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
}

function getRefreshTokenKey(refreshToken) {
    return `refresh_token:${hashToken(refreshToken)}`;
}

function generateAccessToken(user) {
    return jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '20m' });
}

function generateRefreshToken(user) {
    return jwt.sign(
        {
            ...user,
            jti: crypto.randomUUID()
        },
        process.env.REFRESH_TOKEN_SECRET,
        {
            expiresIn: REFRESH_TOKEN_TTL_SECONDS
        }
    );
}

async function storeRefreshSession(refreshToken, user) {
    await redisClient.set(
        getRefreshTokenKey(refreshToken),
        JSON.stringify({
            userId: user.id,
            username: user.name,
            createdAt: new Date().toISOString()
        }),
        {
            EX: REFRESH_TOKEN_TTL_SECONDS
        }
    );
}

function setRefreshTokenCookie(res, refreshToken) {
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: false,
        maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000
    });
}

function clearRefreshTokenCookie(res) {
    res.clearCookie('refreshToken', {
        httpOnly: true,
        sameSite: 'strict',
        secure: false
    });
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
