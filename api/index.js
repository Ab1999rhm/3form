require('dotenv').config();
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const bcrypt = require('bcrypt');

const app = express();

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

// Schema and Model (unchanged)
const registrationSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, required: true },
    biography: { type: String },
    profilePicture: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const Registration = mongoose.model('Registration', registrationSchema);

// Configure Multer (unchanged)
const upload = multer({ storage: multer.memoryStorage() });

// Middleware with increased body size limit
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, '../public')));

// Admin Authentication (unchanged)
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const [username, password] = Buffer.from(authHeader.split(' ')[1] || '', 'base64').toString().split(':');
    
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Admin Access"');
    res.status(401).json({ error: 'Authentication required' });
};

// Root route to serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/views/index.html'));
});
app.get('/view-registration', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/views/view-registration.html'));
});
// Updated Registration Endpoint with Cloudinary
app.post('/register', upload.single('profilePicture'), async (req, res) => {
    try {
        // Validation (unchanged)
        if (!req.file) return res.status(400).json({ error: 'Profile picture required' });
        if (!['image/jpeg', 'image/png'].includes(req.file.mimetype)) {
            return res.status(400).json({ error: 'Only JPEG/PNG allowed' });
        }

        // Convert buffer to data URI for Cloudinary
        const dataURI = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataURI, {
            folder: 'profile-pictures',
            public_id: uuidv4(),
            overwrite: false
        });

        // Create user with Cloudinary URL
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = new Registration({
            ...req.body,
            password: hashedPassword,
            profilePicture: result.secure_url,
            dateOfBirth: new Date(req.body.dateOfBirth)
        });

        await newUser.save();
        res.status(201).json({ message: 'Registration successful' });
    } catch (error) {
        console.error('Registration error:', error);
        const status = error.code === 11000 ? 409 : 500;
        res.status(status).json({ 
            error: error.message,
            ...(error.http_code && { cloudinaryError: error })
        });
    }
});

// Admin Endpoint (unchanged)
app.get('/api/registrations', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const result = await Registration.paginate({}, {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: { createdAt: -1 },
            lean: true
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = app;
