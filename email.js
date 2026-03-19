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
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    return transporter;
}

async function sendEmail({ to, subject, html, text }) {
    const mailer = getMailer();
    return mailer.sendMail({
        from: `"InstaClone" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text,
        html,
    });
}

module.exports = {
    sendEmail,
};
