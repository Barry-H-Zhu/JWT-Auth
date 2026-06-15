require('dotenv').config();

const express = require('express');
const app = express();

const jwt = require('jsonwebtoken');
const db = require('./db');
const bcrypt = require('bcrypt');

app.use(express.json());

let refreshTokens = [];

app.post('/token', (req, res) => {
    const refreshToken = req.body.token;
    if (refreshToken == null) return res.sendStatus(401);
    if (!refreshTokens.includes(refreshToken)) return res.sendStatus(403);

    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        const accessToken = generateAccessToken({ name: user.name });
        res.json({ accessToken: accessToken });
    });
});

app.delete('/logout', (req, res) => {
    refreshTokens = refreshTokens.filter(token => token !== req.body.token);
    res.sendStatus(204);
});

app.post('/login', async (req, res) => {
    // Authenticate User

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'username and password are required' });
    }

    try {
        const [users] = await db.execute(
            'SELECT id, username, password_hash FROM users WHERE username = ?',
            [username]
        );

        const userRecord = users[0];

        if (!userRecord) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const passwordMatches = await bcrypt.compare(password, userRecord.password_hash);

        if (!passwordMatches) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const user = { name: username };

        const accessToken = generateAccessToken(user);
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

