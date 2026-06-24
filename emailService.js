const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendVerificationEmail(to, code) {
    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: to,
        subject: 'Your JWT Auth verification code',
        text: `Your verification code is: ${code}\n\nThis code will expire in 10 minutes.`
    });
}

async function sendPasswordResetEmail(to, code) {
    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: to,
        subject: 'Reset your JWT Auth password',
        text: `Your password reset code is: ${code}\n\nThis code will expire in 10 minutes.`
    });
}

module.exports = {
    sendVerificationEmail,
    sendPasswordResetEmail
};
