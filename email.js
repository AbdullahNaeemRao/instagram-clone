const nodemailer = require('nodemailer');

let transporter = null;

function getMailer() {
    if (transporter) {
        return transporter;
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        throw new Error('EMAIL_USER and EMAIL_PASS must be configured');
    }

    transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    return transporter;
}

async function sendEmail({ to, subject, html, text }) {
    const mailer = getMailer();
    try {
        console.log('--- STARTING EMAIL SEND ---');
        const info = await mailer.sendMail({
            from: `"InstaClone" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text,
            html,
        });
        console.log('--- EMAIL SUCCESS ---');
        return info;
    } catch (error) {
        console.error('--- EMAIL FAILURE ---', {
            message: error.message,
            code: error.code,
            responseCode: error.responseCode,
            command: error.command,
        });
        throw error;
    }
}

module.exports = {
    sendEmail,
};
