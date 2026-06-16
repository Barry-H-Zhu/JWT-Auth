require('dotenv').config();

const express = require('express');
const app = express();

const jwt = require('jsonwebtoken');
const db = require('./db');

app.use(express.json());
app.use(express.static('public'));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// const posts = [
//     {
//         username: 'Barry',
//         title: 'My First Post'
//     },
//     {
//         username: 'Wenqi',
//         title: 'My Second Post'
//     }
// ];

app.post('/posts', authenticateToken, async (req, res) => {
    const { title } = req.body;

    if (!title) {
        return res.status(400).json({ message: 'title is required' });
    }

    try {
        const [result] = await db.execute(
            'INSERT INTO posts (user_id, title) VALUES (?, ?)',
            [req.user.id, title]
        );

        res.status(201).json({
            id: result.insertId,
            title: title,
            user_id: req.user.id
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not create post' });
    }
});

app.get('/posts', authenticateToken, async (req, res) => {
    try {
        const [posts] = await db.execute(
            'SELECT id, title, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );

        res.json(posts);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not fetch posts' });
    }
});

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

app.listen(3000)

