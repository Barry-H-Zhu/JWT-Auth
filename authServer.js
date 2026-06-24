require('dotenv').config();

const express = require('express');
const app = express();

const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('./db');
const bcrypt = require('bcrypt');
const { redisClient, connectRedis } = require('./redisClient');
const {
    sendVerificationEmail,
    sendPasswordResetEmail
} = require('./emailService');
const crypto = require('crypto');

app.use(express.json());
app.use(cookieParser());

const allowedOrigins = [
    'http://localhost:3000',
    'http://192.168.0.104:3000'
];

app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Protection');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');

    if (req.method === 'OPTIONS') return res.sendStatus(204);

    next();
});

function requireCsrfHeader(req, res, next) {
    const csrfHeader = req.get('X-CSRF-Protection');

    if (csrfHeader !== '1') {
        return res.status(403).json({ message: 'CSRF protection header is required' });
    }

    next();
}

const CHALLENGE_TTL_SECONDS = 10 * 60;
const MAX_VERIFICATION_FAILURES = 3;
const COOLDOWN_SECONDS = 5 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const PASSWORD_RESET_TTL_SECONDS = 10 * 60;
const MAX_PASSWORD_RESET_FAILURES = 3;
const PASSWORD_RESET_COOLDOWN_SECONDS = 5 * 60;

app.post('/token', requireCsrfHeader, async (req, res) => {
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

app.delete('/logout', requireCsrfHeader, async (req, res) => {
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

app.post('/password-reset/request', async (req, res) => {
    const { identifier } = req.body;

    if (!identifier) {
        return res.status(400).json({ message: 'identifier is required' });
    }

    try {
        const [users] = await db.execute(
            'SELECT id, username, email FROM users WHERE username = ? OR email = ?',
            [identifier, identifier]
        );

        const userRecord = users[0];

        if (!userRecord) {
            return res.json({ message: 'If that account exists, a password reset code has been sent' });
        }

        const cooldownKey = `password_reset_cooldown:${userRecord.id}`;
        const cooldownTtl = await redisClient.ttl(cooldownKey);

        if (cooldownTtl > 0) {
            return res.status(429).json({
                message: `Too many password reset attempts. Try again in ${cooldownTtl} seconds.`
            });
        }

        const resetCode = createVerificationCode();
        const resetId = crypto.randomUUID();

        const resetRequest = {
            userId: userRecord.id,
            username: userRecord.username,
            hashedResetCode: hashVerificationCode(resetCode),
            failureCount: 0,
            createdAt: new Date().toISOString()
        };

        await redisClient.set(
            `password_reset:${resetId}`,
            JSON.stringify(resetRequest),
            {
                EX: PASSWORD_RESET_TTL_SECONDS
            }
        );

        console.log(`Password reset code for ${userRecord.username}: ${resetCode}`);

        await sendPasswordResetEmail(userRecord.email, resetCode);

        res.json({
            resetId: resetId,
            message: 'If that account exists, a password reset code has been sent'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not request password reset' });
    }
});

app.post('/password-reset/confirm', async (req, res) => {
    const { resetId, resetCode, newPassword } = req.body;

    if (!resetId || !resetCode || !newPassword) {
        return res.status(400).json({
            message: 'resetId, resetCode, and newPassword are required'
        });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({
            message: 'newPassword must be at least 8 characters'
        });
    }

    try {
        const resetKey = `password_reset:${resetId}`;
        const resetJson = await redisClient.get(resetKey);

        if (!resetJson) {
            return res.status(400).json({ message: 'Password reset request is invalid or expired' });
        }

        const resetRequest = JSON.parse(resetJson);

        const resetCodeMatches = hashVerificationCode(resetCode) === resetRequest.hashedResetCode;

        if (!resetCodeMatches) {
            resetRequest.failureCount += 1;

            if (resetRequest.failureCount >= MAX_PASSWORD_RESET_FAILURES) {
                await redisClient.del(resetKey);

                await redisClient.set(
                    `password_reset_cooldown:${resetRequest.userId}`,
                    '1',
                    {
                        EX: PASSWORD_RESET_COOLDOWN_SECONDS
                    }
                );

                return res.status(429).json({
                    message: 'Too many password reset attempts. Try again later.'
                });
            }

            await redisClient.set(
                resetKey,
                JSON.stringify(resetRequest),
                {
                    EX: PASSWORD_RESET_TTL_SECONDS
                }
            );

            return res.status(401).json({ message: 'Invalid password reset code' });
        }

        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        await db.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [newPasswordHash, resetRequest.userId]
        );

        await redisClient.del(resetKey);

        res.json({ message: 'Password reset successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not reset password' });
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
        secure: process.env.NODE_ENV === 'production',
        maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000
    });
}

function clearRefreshTokenCookie(res) {
    res.clearCookie('refreshToken', {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production'
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
