const { Readable } = require('stream');
const { v2: cloudinary } = require('cloudinary');

let isConfigured = false;

function ensureCloudinaryConfig() {
    if (isConfigured) {
        return cloudinary;
    }

    const requiredEnvVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
    const missing = requiredEnvVars.filter((name) => !process.env[name]);
    if (missing.length > 0) {
        throw new Error(`Missing Cloudinary environment variables: ${missing.join(', ')}`);
    }

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    isConfigured = true;
    return cloudinary;
}

async function uploadBufferToCloudinary(file, { folder, resourceType = 'image' } = {}) {
    if (!file || !Buffer.isBuffer(file.buffer)) {
        throw new Error('A file buffer is required for Cloudinary upload');
    }

    const client = ensureCloudinaryConfig();

    return new Promise((resolve, reject) => {
        const uploadStream = client.uploader.upload_stream(
            {
                folder,
                resource_type: resourceType,
                use_filename: false,
                unique_filename: true,
            },
            (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(result);
            }
        );

        Readable.from(file.buffer).pipe(uploadStream);
    });
}

module.exports = {
    cloudinary,
    uploadBufferToCloudinary,
};
