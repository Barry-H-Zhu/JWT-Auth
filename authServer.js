require('dotenv').config();

const express = require('express');
const app = express();

const jwt = require('jsonwebtoken');
const db = require('./db');
const bcrypt = require('bcrypt');

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

let refreshTokens = [];

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

        const user = { 
            id: userRecord.id,
            name: userRecord.username
        };

        const accessToken = generateAccessToken({ id: user.id, name: user.name });
        const refreshToken = jwt.sign(user, process.env.REFRESH_TOKEN_SECRET);
        refreshTokens.push(refreshToken);
        res.json({ accessToken: accessToken, refreshToken: refreshToken });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not log in' });
    }
});

function generateAccessToken(user) {
    return jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '20m' });
}
app.listen(4000)

