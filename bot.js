// ====================================================================
// BOT.JS - EASYSUCCOR TELEGRAM BOT
// COMPLETE PRODUCTION VERSION - MOBILE-FRIENDLY SEPARATORS + PRICE FIX
// ====================================================================

const { Telegraf, Markup } = require('telegraf');
const dotenv = require('dotenv');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const express = require('express');
const multer = require('multer');
const db = require('./database');
const InstallmentTracker = require('./installment-tracker');
const ReferralTracker = require('./referral-tracker');
const payment = require('./payment');
const notificationService = require('./notification-service');
const documentGenerator = require('./document-generator');
const aiAnalyzer = require('./ai-analyzer');
const intelligentUpdate = require('./intelligent-update');
const path = require('path');

require('dotenv').config();

// ============ GLOBAL ERROR HANDLERS TO PREVENT CRASHES ============
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Do not exit – log and continue
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
    // Do not exit
});

// ============ MOBILE-FRIENDLY SEPARATOR ============
const SEP = '\n┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅\n';

// ============ APPRECIATION MESSAGES ============
const appreciationMessages = [
    "🙏 Thank you for your patience. You're a joy to work with!",
    "🤝 Your cooperation makes our work a pleasure. Thank you!",
    "🌟 We appreciate your trust in us. You're in excellent hands.",
    "💫 Your positive spirit inspires us. Thank you for choosing EasySuccor!",
    "🕊️ Thank you for your humbleness. It's an honor to serve you.",
    "🙌 Your obedience and trust make all the difference. We're grateful!",
    "💝 Clients like you make our work meaningful. Thank you!"
];

function getRandomAppreciation() {
    return appreciationMessages[Math.floor(Math.random() * appreciationMessages.length)];
}

async function sendAppreciation(ctx) {
    const msg = getRandomAppreciation();
    await ctx.reply(msg);
}

// ============ EXPRESS SERVER SETUP ============
const app = express();
const PORT = process.env.PORT || 3000;

// File validation (size + mime types)
const upload = multer({
    dest: 'uploads/admin/',
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/jpg'];
        cb(null, allowed.includes(file.mimetype));
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============ Home Page ROUTES ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============ API STATUS ROUTE ============
app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'EasySuccor Bot is running!', 
        timestamp: new Date().toISOString() 
    });
});

// ============ HEALTH CHECK ENDPOINT FOR RAILWAY ============
app.get('/health', (req, res) => {
    const dbType = process.env.DATABASE_URL ? 
        (process.env.DATABASE_URL.startsWith('postgres') ? 'postgresql' : 'sqlite') : 
        'sqlite';
    
    res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(), 
        uptime: process.uptime(),
        version: '5.0.0',
        bot: 'EasySuccor Bot',
        deepseek_configured: !!process.env.DEEPSEEK_API_KEY,
        database: dbType
    });
});

// ============ ADMIN AUTHENTICATION (Header only - No Query Param) ============
const adminAuth = (req, res, next) => {
    const apiKey = req.headers['x-admin-key'];
    if (apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized. Valid admin API key required in x-admin-key header.' });
    }
    next();
};

// ============ PRICE CONFIGURATION (Single source of truth - removed duplicate PRICES) ============
let PRICE_CONFIG = {
    student: { cv: 6000, editable_cv: 8000, editable_cover: 8000, update: 3000, cover: 5000 },
    recent: { cv: 8000, editable_cv: 10000, editable_cover: 8000, update: 4000, cover: 5000 },
    professional: { cv: 10000, editable_cv: 12000, editable_cover: 8000, update: 6000, cover: 6000 },
    nonworking: { cv: 8000, editable_cv: 10000, editable_cover: 8000, update: 5000, cover: 5000 },
    returning: { editable_cv: 10000, editable_cover: 8000, update: 5000, cover: 5000 }
};

// Load saved prices
try {
    if (fs.existsSync('./price_config.json')) {
        PRICE_CONFIG = JSON.parse(fs.readFileSync('./price_config.json', 'utf8'));
        console.log('✅ Price config loaded from file');
    }
} catch(e) { console.log('Using default price config'); }

// Helper function using PRICE_CONFIG only
function getBasePrice(category, service) {
    const catKey = { student: 'student', recentgraduate: 'recent', professional: 'professional', nonworkingprofessional: 'nonworking', returningclient: 'returning' }[category] || 'professional';
    const serviceKey = { 'new cv': 'cv', 'editable cv': 'editable_cv', 'editable cover letter': 'editable_cover', 'cv update': 'update', 'cover letter': 'cover' }[service] || 'cv';
    return PRICE_CONFIG[catKey]?.[serviceKey] || 0;
}

function calculateTotalForCombined(category, services, delivery) {
    let total = 0;
    for (const service of services) {
        total += getBasePrice(category, service);
    }
    total += (DELIVERY_PRICES[delivery] || 0);
    return total;
}

const DELIVERY_PRICES = { standard: 0, express: 3000, rush: 5000 };
const DELIVERY_TIMES = { standard: '6 hours', express: '2 hours', rush: '1 hour' };

function formatPrice(amount) { return `MK${amount.toLocaleString()}`; }
function generatePaymentReference() {
    return `EASY${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10000)}`;
}

// ============ PRICE MANAGEMENT ENDPOINTS ============
app.get('/admin/prices', adminAuth, (req, res) => {
    res.json(PRICE_CONFIG);
});
// ============ SEND TELEGRAM LINK TO EMAIL ============
app.post('/api/send-telegram-link', async (req, res) => {
    try {
        const { email, link, name } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email address is required' });
        }
        
        const botLink = link || `https://t.me/${process.env.BOT_USERNAME || 'EasySuccor_bot'}`;
        const subject = 'Your EasySuccor Telegram Bot Link';
        const userName = name || 'there';
        
        const textMessage = `Hello ${userName},\n\nYou requested the link to our Telegram bot. Click the link below to start using EasySuccor:\n\n${botLink}\n\nIf the link doesn't work, copy and paste it into your browser.\n\nThank you for choosing EasySuccor!`;
        
        const result = await notificationService.sendEmail(email, subject, textMessage);
        
        if (result.success) {
            res.json({ success: true, message: 'Email sent successfully' });
        } else {
            console.error('Email send failed:', result.error);
            res.status(500).json({ error: result.error || 'Failed to send email' });
        }
    } catch (error) {
        console.error('Send email endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/update-prices', adminAuth, async (req, res) => {
    try {
        const { category, service, price } = req.body;
        const priceNum = parseInt(price);
        if (isNaN(priceNum) || priceNum < 0) {
            return res.status(400).json({ error: 'Invalid price. Must be a positive number.' });
        }
        if (PRICE_CONFIG[category] && PRICE_CONFIG[category][service] !== undefined) {
            PRICE_CONFIG[category][service] = priceNum;
            fs.writeFileSync('./price_config.json', JSON.stringify(PRICE_CONFIG, null, 2));
            await db.logAdminAction({
                admin_id: req.body.admin_id || 'web',
                action: 'update_prices',
                details: `${category}.${service} = ${priceNum}`,
                timestamp: new Date().toISOString()
            });
            res.json({ success: true, message: 'Prices updated successfully' });
        } else {
            res.status(400).json({ error: 'Invalid category or service' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ ADMIN UPLOAD ENDPOINTS (18+ CATEGORIES) ============

// Helper function to extract all 18+ categories from CV data
function extractAllCVData(cvData) {
    return {
        personal: {
            full_name: cvData.personal?.full_name || null,
            email: cvData.personal?.email || null,
            primary_phone: cvData.personal?.primary_phone || null,
            alternative_phone: cvData.personal?.alternative_phone || null,
            whatsapp_phone: cvData.personal?.whatsapp_phone || null,
            location: cvData.personal?.location || null,
            physical_address: cvData.personal?.physical_address || null,
            nationality: cvData.personal?.nationality || null,
            linkedin: cvData.personal?.linkedin || null,
            github: cvData.personal?.github || null,
            portfolio: cvData.personal?.portfolio || null,
            professional_title: cvData.personal?.professional_title || null,
            date_of_birth: cvData.personal?.date_of_birth || null,
            special_documents: cvData.personal?.special_documents || []
        },
        professional_summary: cvData.professional_summary || null,
        employment: (cvData.employment || []).map(job => ({
            title: job.title || null,
            company: job.company || null,
            location: job.location || null,
            start_date: job.start_date || null,
            end_date: job.end_date || null,
            duration: job.duration || null,
            responsibilities: job.responsibilities || [],
            achievements: job.achievements || [],
            technologies_used: job.technologies_used || [],
            team_size: job.team_size || null,
            reporting_to: job.reporting_to || null
        })),
        education: (cvData.education || []).map(edu => ({
            level: edu.level || null,
            field: edu.field || null,
            institution: edu.institution || null,
            location: edu.location || null,
            start_date: edu.start_date || null,
            graduation_date: edu.graduation_date || null,
            gpa: edu.gpa || null,
            achievements: edu.achievements || [],
            courses: edu.courses || []
        })),
        skills: {
            technical: cvData.skills?.technical || [],
            soft: cvData.skills?.soft || [],
            tools: cvData.skills?.tools || [],
            certifications: cvData.skills?.certifications || []
        },
        certifications: (cvData.certifications || []).map(cert => ({
            name: cert.name || null,
            issuer: cert.issuer || null,
            date: cert.date || null,
            expiry_date: cert.expiry_date || null,
            credential_id: cert.credential_id || null,
            url: cert.url || null
        })),
        languages: (cvData.languages || []).map(lang => ({
            name: lang.name || null,
            proficiency: lang.proficiency || null,
            certification: lang.certification || null
        })),
        projects: (cvData.projects || []).map(proj => ({
            name: proj.name || null,
            description: proj.description || null,
            technologies: proj.technologies || null,
            role: proj.role || null,
            team_size: proj.team_size || null,
            duration: proj.duration || null,
            link: proj.link || null,
            outcome: proj.outcome || null
        })),
        achievements: (cvData.achievements || []).map(ach => ({
            title: typeof ach === 'string' ? ach : ach.title,
            description: ach.description || null,
            date: ach.date || null,
            issuer: ach.issuer || null
        })),
        volunteer: (cvData.volunteer || []).map(vol => ({
            role: vol.role || null,
            organization: vol.organization || null,
            duration: vol.duration || null,
            responsibilities: vol.responsibilities || []
        })),
        leadership: (cvData.leadership || []).map(lead => ({
            role: lead.role || null,
            organization: lead.organization || null,
            duration: lead.duration || null,
            impact: lead.impact || null
        })),
        awards: (cvData.awards || []).map(award => ({
            name: award.name || null,
            issuer: award.issuer || null,
            date: award.date || null,
            description: award.description || null
        })),
        publications: (cvData.publications || []).map(pub => ({
            title: pub.title || null,
            publisher: pub.publisher || null,
            date: pub.date || null,
            url: pub.url || null,
            authors: pub.authors || null
        })),
        conferences: (cvData.conferences || []).map(conf => ({
            name: conf.name || null,
            role: conf.role || null,
            date: conf.date || null,
            location: conf.location || null
        })),
        referees: (cvData.referees || []).map(ref => ({
            name: ref.name || null,
            position: ref.position || null,
            company: ref.company || null,
            email: ref.email || null,
            phone: ref.phone || null,
            relationship: ref.relationship || null
        })),
        interests: cvData.interests || [],
        social_media: {
            linkedin: cvData.social_media?.linkedin || null,
            github: cvData.social_media?.github || null,
            twitter: cvData.social_media?.twitter || null,
            facebook: cvData.social_media?.facebook || null,
            instagram: cvData.social_media?.instagram || null,
            portfolio: cvData.social_media?.portfolio || null
        },
        portfolio: cvData.portfolio || []
    };
  return { personal: {}, employment: [], education: [], skills: {}, certifications: [], languages: [], projects: [], achievements: [], volunteer: [], leadership: [], awards: [], publications: [], conferences: [], referees: [], interests: [], social_media: {}, portfolio: [] };
}

// Batch upload (multiple files)
app.post('/admin/upload-batch', adminAuth, upload.array('files', 20), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }
        
        const results = [];
        for (const file of files) {
            try {
                const extractedData = await documentGenerator.extractFullCVData(file.path, 'cv');
                const cvData = extractedData.data;
                const allData = extractAllCVData(cvData);
                
                let client = null;
                if (allData.personal.email) {
                    client = await db.getClientByEmail(allData.personal.email);
                }
                
                if (!client) {
                    const firstName = allData.personal.full_name?.split(' ')[0] || 'Unknown';
                    const lastName = allData.personal.full_name?.split(' ').slice(1).join(' ') || '';
                    client = await db.createClient(null, null, firstName, lastName);
                    await db.updateClient(client.id, {
                        email: allData.personal.email,
                        phone: allData.personal.primary_phone,
                        location: allData.personal.location,
                        physical_address: allData.personal.physical_address,
                        nationality: allData.personal.nationality,
                        linkedin: allData.personal.linkedin,
                        github: allData.personal.github,
                        portfolio: allData.personal.portfolio,
                        professional_title: allData.personal.professional_title,
                        special_documents: JSON.stringify(allData.personal.special_documents),
                        is_legacy_client: true
                    });
                }
                
                await documentGenerator.convertLegacyDocument(file.path, client.id, 'cv');
                
                await db.createOrder({
                    id: `LEGACY_${Date.now()}_${client.id}_${file.originalname}`,
                    client_id: client.id,
                    service: 'legacy_cv',
                    category: 'returningclient',
                    delivery_option: 'standard',
                    delivery_time: 'already_delivered',
                    base_price: 0,
                    delivery_fee: 0,
                    total_charge: 'MK0',
                    payment_status: 'completed',
                    cv_data: allData,
                    certificates_appendix: null,
                    portfolio_links: JSON.stringify(allData.portfolio),
                    status: 'delivered'
                });
                
                const exportPath = path.join(__dirname, 'exports', 'legacy_imports', `${client.id}_${Date.now()}.json`);
                const exportDir = path.dirname(exportPath);
                if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
                fs.writeFileSync(exportPath, JSON.stringify(allData, null, 2));
                
                results.push({
                    file: file.originalname,
                    success: true,
                    client_id: client.id,
                    client_name: allData.personal.full_name,
                    extracted_email: allData.personal.email,
                    extracted_phone: allData.personal.primary_phone,
                    stats: {
                        employment: allData.employment.length,
                        education: allData.education.length,
                        skills: allData.skills.technical.length + allData.skills.soft.length + allData.skills.tools.length,
                        certifications: allData.certifications.length,
                        languages: allData.languages.length,
                        projects: allData.projects.length,
                        achievements: allData.achievements.length,
                        volunteer: allData.volunteer.length,
                        leadership: allData.leadership.length,
                        awards: allData.awards.length,
                        publications: allData.publications.length,
                        conferences: allData.conferences.length,
                        referees: allData.referees.length,
                        interests: allData.interests.length
                    }
                });
            } catch (fileError) {
                results.push({ file: file.originalname, success: false, error: fileError.message });
            }
        }
        
        res.json({ success: true, total: files.length, successful: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results });
    } catch (error) {
        console.error('Batch upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Single CV upload
app.post('/admin/upload-cv', adminAuth, upload.single('cv_file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });
        
        const extractedData = await documentGenerator.extractFullCVData(file.path, 'cv');
        const cvData = extractedData.data;
        const allData = extractAllCVData(cvData);
        
        let client = null;
        if (allData.personal.email) client = await db.getClientByEmail(allData.personal.email);
        
        if (!client) {
            const firstName = allData.personal.full_name?.split(' ')[0] || 'Unknown';
            const lastName = allData.personal.full_name?.split(' ').slice(1).join(' ') || '';
            client = await db.createClient(null, null, firstName, lastName);
            await db.updateClient(client.id, {
                email: allData.personal.email,
                phone: allData.personal.primary_phone,
                location: allData.personal.location,
                physical_address: allData.personal.physical_address,
                nationality: allData.personal.nationality,
                linkedin: allData.personal.linkedin,
                github: allData.personal.github,
                portfolio: allData.personal.portfolio,
                professional_title: allData.personal.professional_title,
                special_documents: JSON.stringify(allData.personal.special_documents),
                is_legacy_client: true
            });
        }
        
        await documentGenerator.convertLegacyDocument(file.path, client.id, 'cv');
        
        await db.createOrder({
            id: `LEGACY_${Date.now()}_${client.id}`,
            client_id: client.id,
            service: 'legacy_cv',
            category: 'returningclient',
            delivery_option: 'standard',
            delivery_time: 'already_delivered',
            base_price: 0,
            delivery_fee: 0,
            total_charge: 'MK0',
            payment_status: 'completed',
            cv_data: allData,
            certificates_appendix: null,
            portfolio_links: JSON.stringify(allData.portfolio),
            status: 'delivered'
        });
        
        const exportPath = path.join(__dirname, 'exports', 'legacy_imports', `${client.id}_${Date.now()}.json`);
        const exportDir = path.dirname(exportPath);
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
        fs.writeFileSync(exportPath, JSON.stringify(allData, null, 2));
        
        res.json({
            success: true,
            message: `CV processed for ${allData.personal.full_name || 'client'}`,
            client_id: client.id,
            extracted_data: {
                name: allData.personal.full_name,
                email: allData.personal.email,
                phone: allData.personal.primary_phone,
                location: allData.personal.location,
                physical_address: allData.personal.physical_address,
                nationality: allData.personal.nationality,
                linkedin: allData.personal.linkedin,
                github: allData.personal.github,
                professional_title: allData.personal.professional_title,
                special_documents: allData.personal.special_documents,
                stats: {
                    employment: allData.employment.length,
                    education: allData.education.length,
                    skills: allData.skills.technical.length + allData.skills.soft.length + allData.skills.tools.length,
                    certifications: allData.certifications.length,
                    languages: allData.languages.length,
                    projects: allData.projects.length,
                    achievements: allData.achievements.length,
                    volunteer: allData.volunteer.length,
                    leadership: allData.leadership.length,
                    awards: allData.awards.length,
                    publications: allData.publications.length,
                    conferences: allData.conferences.length,
                    referees: allData.referees.length,
                    interests: allData.interests.length
                }
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Cover letter upload
app.post('/admin/upload-cover', adminAuth, upload.single('cover_file'), async (req, res) => {
    try {
        const { client_name, client_email, client_phone, client_location, position: formPosition, company: formCompany } = req.body;
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });
        
        const fileUrl = `/uploads/${file.filename}`;
        const extractedData = await aiAnalyzer.extractFromDocument(fileUrl, file.originalname);
        
        const clientName = extractedData.client_name || client_name || 'Unknown Client';
        const clientEmail = extractedData.client_email || client_email || null;
        const clientPhone = extractedData.client_phone || client_phone || null;
        const clientLocation = extractedData.client_location || client_location || null;
        const position = extractedData.position || formPosition || 'Unknown Position';
        const company = extractedData.company || formCompany || 'Unknown Company';
        
        let client;
        if (clientEmail) client = await db.getClientByEmail(clientEmail);
        if (!client && clientPhone) client = await db.getClientByPhone(clientPhone);
        if (!client) {
            client = await db.createClient(null, null, clientName.split(' ')[0], clientName.split(' ').slice(1).join(' '));
            await db.updateClient(client.id, { email: clientEmail, phone: clientPhone, location: clientLocation, is_legacy_client: true });
        }
        
        const convertedCover = await documentGenerator.convertLegacyDocument(file.path, client.id, 'cover_letter');
        
        const coverData = {
            cover_letter: convertedCover,
            vacancy: { position, company, extracted_at: new Date().toISOString() },
            client_info: { name: clientName, email: clientEmail, phone: clientPhone, location: clientLocation }
        };
        
        await db.createOrder({
            id: `LEGACY_CL_${Date.now()}_${client.id}`,
            client_id: client.id,
            service: 'legacy_cover_letter',
            category: 'returningclient',
            delivery_option: 'standard',
            delivery_time: 'already_delivered',
            base_price: 0,
            delivery_fee: 0,
            total_charge: 'MK0',
            payment_status: 'completed',
            cv_data: coverData,
            status: 'delivered'
        });
        
        res.json({ success: true, message: `Cover letter for ${clientName} uploaded and converted successfully`, client_id: client.id, extracted_details: { position, company, client_name: clientName, client_email: clientEmail } });
    } catch (error) {
        console.error('Cover letter upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// NEW: Admin endpoint to upload client attachments (certificates, ID, etc.)
app.post('/admin/upload-attachment', adminAuth, upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });
        const { client_id, document_type, notes } = req.body;
        if (!client_id || !document_type) return res.status(400).json({ error: 'Missing client_id or document_type' });

        let enhancedPath = null;
        if (file.mimetype.startsWith('image/')) {
            enhancedPath = await documentGenerator.enhanceImage(file.path);
        }

        const fileBuffer = fs.readFileSync(file.path);
        const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');

        const existing = await db.getClientDocumentByHash(client_id, hash);
        if (existing) {
            fs.unlinkSync(file.path);
            if (enhancedPath && fs.existsSync(enhancedPath)) fs.unlinkSync(enhancedPath);
            return res.json({ success: true, message: 'Document already on file (duplicate)', document_id: existing.id, reused: true });
        }

        const docId = await db.saveClientDocument({
            client_id,
            document_type,
            file_path: file.path,
            enhanced_path: enhancedPath,
            file_hash: hash,
            original_filename: file.originalname,
            mime_type: file.mimetype,
            file_size: file.size,
            notes: notes || null
        });
        res.json({ success: true, message: 'Document uploaded successfully', document_id: docId });
    } catch (error) {
        console.error('Attachment upload error:', error);
        res.status(500).json({ error: error.message });
    }
});
app.get('/admin/client-documents/:clientId', adminAuth, async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId);
        if (isNaN(clientId)) return res.status(400).json({ error: 'Invalid client ID' });
        const docs = await db.getClientDocuments(clientId);
        res.json({ success: true, documents: docs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get full extracted data for a client
app.get('/admin/client-full/:clientId', adminAuth, async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId);
        if (isNaN(clientId)) return res.status(400).json({ error: 'Invalid client ID' });
        
        const orders = await db.getClientOrders(clientId);
        const latestOrder = orders[0];
        if (!latestOrder || !latestOrder.cv_data) return res.status(404).json({ error: 'No CV data found for this client' });
        
        res.json({ client_id: clientId, client_name: latestOrder.cv_data.personal?.full_name || 'Unknown', extracted_at: latestOrder.created_at, data: latestOrder.cv_data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get summary of all imported clients
app.get('/admin/imports-summary', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const legacyOrders = orders.filter(o => o.service === 'legacy_cv');
        const summary = legacyOrders.map(order => {
            const cvData = order.cv_data;
            return {
                order_id: order.id,
                client_id: order.client_id,
                client_name: cvData?.personal?.full_name || 'Unknown',
                imported_at: order.created_at,
                stats: {
                    employment: cvData?.employment?.length || 0,
                    education: cvData?.education?.length || 0,
                    skills: (cvData?.skills?.technical?.length || 0) + (cvData?.skills?.soft?.length || 0) + (cvData?.skills?.tools?.length || 0),
                    certifications: cvData?.certifications?.length || 0,
                    languages: cvData?.languages?.length || 0,
                    projects: cvData?.projects?.length || 0,
                    achievements: cvData?.achievements?.length || 0,
                    volunteer: cvData?.volunteer?.length || 0,
                    leadership: cvData?.leadership?.length || 0,
                    awards: cvData?.awards?.length || 0,
                    publications: cvData?.publications?.length || 0,
                    conferences: cvData?.conferences?.length || 0,
                    referees: cvData?.referees?.length || 0,
                    interests: cvData?.interests?.length || 0
                }
            };
        });
        res.json({ total_imports: legacyOrders.length, imports: summary });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ CLIENT MANAGEMENT ENDPOINTS ============

// Delete client and all associated data
app.delete('/admin/client/:clientId', adminAuth, async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId);
        if (isNaN(clientId)) return res.status(400).json({ error: 'Invalid client ID' });
        
        const client = await db.getClientById(clientId);
        if (!client) return res.status(404).json({ error: 'Client not found' });
        
        await db.deleteClientData(clientId);
        await db.logAdminAction({
            admin_id: req.body.admin_id || 'web',
            action: 'delete_client',
            details: `Deleted client: ${client.first_name} ${client.last_name || ''} (ID: ${clientId})`,
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, message: `Client deleted successfully` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear ALL data (emergency only)
app.delete('/admin/clear-all', adminAuth, async (req, res) => {
    try {
        await db.clearAllData();
        await db.logAdminAction({
            admin_id: req.body.admin_id || 'web',
            action: 'clear_all_data',
            details: 'All client and order data cleared',
            timestamp: new Date().toISOString()
        });
        res.json({ success: true, message: 'All data cleared successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ ADMIN DASHBOARD API ENDPOINTS  ============

// Helper function to calculate revenue
function calculateRevenue(orders) {
    return orders.reduce((sum, o) => {
        const amount = parseInt(o.total_charge?.replace('MK', '').replace(',', '') || 0);
        return sum + amount;
    }, 0);
}

// Helper function to calculate completion time
function calculateCompletionTime(createdAt, deliveredAt) {
    if (!deliveredAt) return null;
    const created = new Date(createdAt);
    const delivered = new Date(deliveredAt);
    const minutes = Math.round((delivered - created) / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return { minutes, hours, mins, formatted: `${hours}h ${mins}m` };
}

// Get comprehensive statistics (UPDATED)
app.get('/admin/stats', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const clients = await db.getAllClients();
        const testimonials = await db.getAllTestimonials();
        const adminLogs = await db.getAdminLogs(100);
        
        // Order categorization
        const cvOrders = orders.filter(o => o.service === 'new cv' || o.service === 'editable cv' || o.service === 'legacy_cv');
        const coverOrders = orders.filter(o => o.service === 'cover letter' || o.service === 'editable cover letter' || o.service === 'legacy_cover_letter');
        const updateOrders = orders.filter(o => o.service === 'cv update');
        
        const pendingOrders = orders.filter(o => o.payment_status === 'pending');
        const completedOrders = orders.filter(o => o.payment_status === 'completed');
        const deliveredOrders = orders.filter(o => o.status === 'delivered');
        
        const totalRevenue = calculateRevenue(completedOrders);
        const cvRevenue = calculateRevenue(cvOrders.filter(o => o.payment_status === 'completed'));
        const coverRevenue = calculateRevenue(coverOrders.filter(o => o.payment_status === 'completed'));
        const updateRevenue = calculateRevenue(updateOrders.filter(o => o.payment_status === 'completed'));
        
        // Calculate average completion time
        let totalCompletionMinutes = 0;
        let completedWithTime = 0;
        for (const order of deliveredOrders) {
            if (order.delivered_at) {
                const created = new Date(order.created_at);
                const delivered = new Date(order.delivered_at);
                totalCompletionMinutes += Math.round((delivered - created) / (1000 * 60));
                completedWithTime++;
            }
        }
        const avgCompletionMinutes = completedWithTime > 0 ? Math.round(totalCompletionMinutes / completedWithTime) : null;
        const avgHours = avgCompletionMinutes ? Math.floor(avgCompletionMinutes / 60) : null;
        const avgMins = avgCompletionMinutes ? avgCompletionMinutes % 60 : null;
        
        // Payment method distribution
        const paymentMethods = {};
        for (const order of completedOrders) {
            const method = order.payment_method || 'unknown';
            paymentMethods[method] = (paymentMethods[method] || 0) + 1;
        }
        
        // Service popularity
        const serviceCount = {};
        for (const order of orders) {
            serviceCount[order.service] = (serviceCount[order.service] || 0) + 1;
        }
        const mostRequested = Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0];
        
        // Monthly revenue trend (last 6 months)
        const monthlyRevenue = {};
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        
        for (const order of completedOrders) {
            const date = new Date(order.created_at);
            if (date >= sixMonthsAgo) {
                const monthYear = date.toLocaleString('default', { month: 'short', year: 'numeric' });
                const amount = parseInt(order.total_charge?.replace('MK', '').replace(',', '') || 0);
                monthlyRevenue[monthYear] = (monthlyRevenue[monthYear] || 0) + amount;
            }
        }
        
        // Active clients (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const activeClients = clients.filter(c => {
            const clientOrders = orders.filter(o => o.client_id === c.id);
            return clientOrders.some(o => new Date(o.created_at) >= thirtyDaysAgo);
        });
        
        // Revenue by service
        const revenueByService = {};
        for (const order of completedOrders) {
            const amount = parseInt(order.total_charge?.replace('MK', '').replace(',', '') || 0);
            revenueByService[order.service] = (revenueByService[order.service] || 0) + amount;
        }
        
        // Category distribution
        const categoryDistribution = {};
        for (const order of orders) {
            categoryDistribution[order.category] = (categoryDistribution[order.category] || 0) + 1;
        }
        
        // Testimonial stats
        const approvedTestimonials = testimonials.filter(t => t.approved).length;
        const pendingTestimonials = testimonials.filter(t => !t.approved).length;
        const avgRating = testimonials.reduce((sum, t) => sum + (t.rating || 0), 0) / (testimonials.length || 1);
        
        res.json({
            timestamp: new Date().toISOString(),
            overview: {
                total_clients: clients.length,
                active_clients_30d: activeClients.length,
                total_orders: orders.length,
                pending_payment: pendingOrders.length,
                completed_orders: completedOrders.length,
                delivered_orders: deliveredOrders.length,
                conversion_rate: orders.length > 0 ? ((completedOrders.length / orders.length) * 100).toFixed(1) : 0
            },
            revenue: {
                total: totalRevenue,
                cv: cvRevenue,
                cover_letter: coverRevenue,
                cv_update: updateRevenue,
                average_order_value: completedOrders.length > 0 ? Math.round(totalRevenue / completedOrders.length) : 0,
                monthly_trend: monthlyRevenue
            },
            delivery: {
                average_completion_minutes: avgCompletionMinutes,
                average_completion_formatted: avgHours ? `${avgHours}h ${avgMins}m` : null,
                fastest_order: null,
                slowest_order: null
            },
            services: {
                most_requested: mostRequested ? mostRequested[0] : 'None',
                most_requested_count: mostRequested ? mostRequested[1] : 0,
                service_breakdown: serviceCount
            },
            payments: {
                method_distribution: paymentMethods,
                pending_count: pendingOrders.length,
                pending_total: calculateRevenue(pendingOrders)
            },
            testimonials: {
                approved: approvedTestimonials,
                pending: pendingTestimonials,
                total: testimonials.length,
                average_rating: avgRating.toFixed(1)
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Get order completion time
app.get('/api/order-time/:orderId', async (req, res) => {
    try {
        const order = await db.getOrder(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        
        const created = new Date(order.created_at);
        const delivered = order.delivered_at ? new Date(order.delivered_at) : null;
        const expectedHours = parseInt(order.delivery_time) || 6;
        const expectedBy = new Date(created);
        expectedBy.setHours(created.getHours() + expectedHours);
        
        res.json({
            order_id: order.id,
            created_at: order.created_at,
            expected_by: expectedBy.toISOString(),
            delivered_at: order.delivered_at,
            is_delivered: !!delivered,
            status: order.status,
            payment_status: order.payment_status
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all orders with detailed information (UPDATED)
app.get('/admin/orders', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const ordersWithDetails = await Promise.all(orders.map(async (order) => {
            const client = await db.getClientById(order.client_id);
            const cvData = order.cv_data || {};
            
            let coverDetails = null;
            if (order.service === 'cover letter' || order.service === 'editable cover letter' || order.service === 'legacy_cover_letter') {
                coverDetails = {
                    position: cvData.position || cvData.cover_letter?.position || 'Not specified',
                    company: cvData.company || cvData.cover_letter?.company || 'Not specified',
                    has_vacancy: !!(cvData.vacancy || cvData.vacancy_data)
                };
            }
            
            let cvStats = null;
            if (order.service === 'new cv' || order.service === 'editable cv' || order.service === 'legacy_cv') {
                cvStats = {
                    employment_count: cvData.employment?.length || 0,
                    education_count: cvData.education?.length || 0,
                    skills_count: (cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0),
                    projects_count: cvData.projects?.length || 0,
                    achievements_count: cvData.achievements?.length || 0,
                    referees_count: cvData.referees?.length || 0
                };
            }
            
            return {
                id: order.id,
                service: order.service,
                category: order.category,
                status: order.status,
                payment_status: order.payment_status,
                total_charge: order.total_charge,
                created_at: order.created_at,
                delivered_at: order.delivered_at,
                delivery_time: order.delivery_time,
                completion_time: calculateCompletionTime(order.created_at, order.delivered_at),
                client: {
                    id: client?.id,
                    name: client ? `${client.first_name} ${client.last_name || ''}` : 'Unknown',
                    email: client?.email,
                    phone: client?.phone
                },
                cover_details: coverDetails,
                cv_stats: cvStats,
                version: order.version,
                review_count: await db.getDocumentReviews(order.id).then(r => r.length)
            };
        }));
        
        ordersWithDetails.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        res.json({
            total: ordersWithDetails.length,
            orders: ordersWithDetails
        });
    } catch (error) {
        console.error('Orders fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all clients with detailed stats
app.get('/admin/clients', adminAuth, async (req, res) => {
    try {
        const clients = await db.getAllClients();
        const orders = await db.getAllOrders();
        
        const clientsWithDetails = await Promise.all(clients.map(async (client) => {
            const clientOrders = orders.filter(o => o.client_id === client.id);
            const completedOrders = clientOrders.filter(o => o.payment_status === 'completed');
            const totalSpent = calculateRevenue(completedOrders);
            
            const cvOrders = clientOrders.filter(o => o.service === 'new cv' || o.service === 'editable cv');
            const coverOrders = clientOrders.filter(o => o.service === 'cover letter' || o.service === 'editable cover letter');
            const updateOrders = clientOrders.filter(o => o.service === 'cv update');
            
            const lastOrder = clientOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
            const referralInfo = await db.getReferralInfo(client.id);
            
            return {
                id: client.id,
                telegram_id: client.telegram_id,
                name: `${client.first_name} ${client.last_name || ''}`,
                email: client.email,
                phone: client.phone,
                location: client.location,
                nationality: client.nationality,
                registered_at: client.created_at,
                last_active: client.last_active,
                total_orders: clientOrders.length,
                completed_orders: completedOrders.length,
                total_spent: totalSpent,
                orders_by_type: {
                    cv: cvOrders.length,
                    cover_letter: coverOrders.length,
                    update: updateOrders.length
                },
                last_order: lastOrder ? {
                    id: lastOrder.id,
                    service: lastOrder.service,
                    date: lastOrder.created_at,
                    amount: lastOrder.total_charge
                } : null,
                referral: {
                    code: referralInfo.referral_code,
                    total_referrals: referralInfo.total_referrals,
                    pending_reward: referralInfo.pending_reward
                },
                has_active_session: !!(await db.getActiveSession(client.id))
            };
        }));
        
        clientsWithDetails.sort((a, b) => new Date(b.registered_at) - new Date(a.registered_at));
        
        res.json({
            total: clientsWithDetails.length,
            clients: clientsWithDetails
        });
    } catch (error) {
        console.error('Clients fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single order with full CV data (UPDATED)
app.get('/admin/order/:orderId', adminAuth, async (req, res) => {
    try {
        const order = await db.getOrder(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        
        const client = await db.getClientById(order.client_id);
        const reviews = await db.getDocumentReviews(order.id);
        const cvData = order.cv_data || {};
        
        const formattedCV = {
            personal: cvData.personal || {},
            professional_summary: cvData.professional_summary || null,
            employment: cvData.employment || [],
            education: cvData.education || [],
            skills: cvData.skills || { technical: [], soft: [], tools: [] },
            certifications: cvData.certifications || [],
            languages: cvData.languages || [],
            projects: cvData.projects || [],
            achievements: cvData.achievements || [],
            volunteer: cvData.volunteer || [],
            leadership: cvData.leadership || [],
            awards: cvData.awards || [],
            publications: cvData.publications || [],
            conferences: cvData.conferences || [],
            referees: cvData.referees || [],
            interests: cvData.interests || [],
            social_media: cvData.social_media || {},
            portfolio: cvData.portfolio || []
        };
        
        const stats = {
            employment: formattedCV.employment.length,
            education: formattedCV.education.length,
            skills: (formattedCV.skills.technical?.length || 0) + (formattedCV.skills.soft?.length || 0) + (formattedCV.skills.tools?.length || 0),
            certifications: formattedCV.certifications.length,
            languages: formattedCV.languages.length,
            projects: formattedCV.projects.length,
            achievements: formattedCV.achievements.length,
            volunteer: formattedCV.volunteer.length,
            leadership: formattedCV.leadership.length,
            awards: formattedCV.awards.length,
            publications: formattedCV.publications.length,
            conferences: formattedCV.conferences.length,
            referees: formattedCV.referees.length,
            interests: formattedCV.interests.length
        };
        
        res.json({
            order: {
                id: order.id,
                service: order.service,
                category: order.category,
                status: order.status,
                payment_status: order.payment_status,
                total_charge: order.total_charge,
                delivery_option: order.delivery_option,
                delivery_time: order.delivery_time,
                created_at: order.created_at,
                delivered_at: order.delivered_at,
                version: order.version,
                completion_time: calculateCompletionTime(order.created_at, order.delivered_at)
            },
            client: {
                id: client?.id,
                name: client ? `${client.first_name} ${client.last_name || ''}` : 'Unknown',
                email: client?.email,
                phone: client?.phone,
                telegram_id: client?.telegram_id
            },
            cv_data: formattedCV,
            stats: stats,
            review_history: reviews,
            portfolio_links: order.portfolio_links ? JSON.parse(order.portfolio_links) : []
        });
    } catch (error) {
        console.error('Order fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single cover letter order
app.get('/admin/cover-order/:orderId', adminAuth, async (req, res) => {
    try {
        const order = await db.getOrder(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        
        if (order.service !== 'cover letter' && order.service !== 'editable cover letter' && order.service !== 'legacy_cover_letter') {
            return res.status(400).json({ error: 'This order is not a cover letter order' });
        }
        
        const client = await db.getClientById(order.client_id);
        const reviews = await db.getDocumentReviews(order.id);
        const coverData = order.cv_data || {};
        
        res.json({
            order: {
                id: order.id,
                service: order.service,
                status: order.status,
                payment_status: order.payment_status,
                total_charge: order.total_charge,
                delivery_option: order.delivery_option,
                delivery_time: order.delivery_time,
                created_at: order.created_at,
                delivered_at: order.delivered_at,
                completion_time: calculateCompletionTime(order.created_at, order.delivered_at)
            },
            client: {
                id: client?.id,
                name: client ? `${client.first_name} ${client.last_name || ''}` : 'Unknown',
                email: client?.email,
                phone: client?.phone
            },
            cover_letter: {
                position: coverData.position || coverData.cover_letter?.position || 'Not specified',
                company: coverData.company || coverData.cover_letter?.company || 'Not specified',
                experience: coverData.experience_highlight || coverData.experience || null,
                skills: coverData.skills || coverData.cover_letter?.skills || [],
                achievement: coverData.achievement || coverData.cover_letter?.achievement || null,
                motivation: coverData.motivation || coverData.why || coverData.cover_letter?.motivation || null,
                availability: coverData.availability || coverData.cover_letter?.availability || null
            },
            vacancy_data: coverData.vacancy || coverData.vacancy_data || null,
            review_history: reviews
        });
    } catch (error) {
        console.error('Cover order fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all cover letter orders
app.get('/admin/cover-orders', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const coverOrders = orders.filter(o => 
            o.service === 'cover letter' || 
            o.service === 'editable cover letter' || 
            o.service === 'legacy_cover_letter'
        );
        
        const coverOrdersWithDetails = await Promise.all(coverOrders.map(async (order) => {
            const client = await db.getClientById(order.client_id);
            const coverData = order.cv_data || {};
            
            return {
                id: order.id,
                service: order.service,
                status: order.status,
                payment_status: order.payment_status,
                total_charge: order.total_charge,
                created_at: order.created_at,
                delivered_at: order.delivered_at,
                completion_time: calculateCompletionTime(order.created_at, order.delivered_at),
                client: {
                    id: client?.id,
                    name: client ? `${client.first_name} ${client.last_name || ''}` : 'Unknown',
                    email: client?.email
                },
                position: coverData.position || coverData.cover_letter?.position || 'Not specified',
                company: coverData.company || coverData.cover_letter?.company || 'Not specified',
                has_vacancy: !!(coverData.vacancy || coverData.vacancy_data),
                version: order.version
            };
        }));
        
        coverOrdersWithDetails.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        res.json({
            total: coverOrders.length,
            orders: coverOrdersWithDetails
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get orders by date range
app.get('/admin/orders-by-date', adminAuth, async (req, res) => {
    try {
        const { start, end } = req.query;
        if (!start || !end) {
            return res.status(400).json({ error: 'Please provide start and end dates (YYYY-MM-DD)' });
        }
        
        const orders = await db.getAllOrders();
        const startDate = new Date(start);
        const endDate = new Date(end);
        endDate.setHours(23, 59, 59);
        
        const filteredOrders = orders.filter(o => {
            const orderDate = new Date(o.created_at);
            return orderDate >= startDate && orderDate <= endDate;
        });
        
        const completedOrders = filteredOrders.filter(o => o.payment_status === 'completed');
        const totalRevenue = calculateRevenue(completedOrders);
        
        const byDay = {};
        filteredOrders.forEach(order => {
            const day = new Date(order.created_at).toISOString().split('T')[0];
            if (!byDay[day]) {
                byDay[day] = { orders: 0, revenue: 0, completed: 0 };
            }
            byDay[day].orders++;
            if (order.payment_status === 'completed') {
                byDay[day].completed++;
                byDay[day].revenue += parseInt(order.total_charge?.replace('MK', '').replace(',', '') || 0);
            }
        });
        
        res.json({
            period: { start, end },
            summary: {
                total_orders: filteredOrders.length,
                completed_orders: completedOrders.length,
                total_revenue: totalRevenue,
                average_order_value: completedOrders.length > 0 ? Math.round(totalRevenue / completedOrders.length) : 0
            },
            daily_breakdown: byDay,
            orders: filteredOrders.map(o => ({
                id: o.id,
                service: o.service,
                total_charge: o.total_charge,
                payment_status: o.payment_status,
                created_at: o.created_at
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get admin dashboard summary
app.get('/admin/dashboard-summary', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const clients = await db.getAllClients();
        const testimonials = await db.getAllTestimonials();
        
        const today = new Date().toISOString().split('T')[0];
        const todayOrders = orders.filter(o => o.created_at.split('T')[0] === today);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekOrders = orders.filter(o => new Date(o.created_at) >= weekAgo);
        
        const pendingPayments = orders.filter(o => o.payment_status === 'pending');
        const recentClients = clients.filter(c => new Date(c.created_at) >= weekAgo);
        
        res.json({
            quick_stats: {
                total_clients: clients.length,
                total_orders: orders.length,
                pending_payments: pendingPayments.length,
                pending_amount: calculateRevenue(pendingPayments),
                total_revenue: calculateRevenue(orders.filter(o => o.payment_status === 'completed'))
            },
            today: {
                orders: todayOrders.length,
                revenue: calculateRevenue(todayOrders.filter(o => o.payment_status === 'completed'))
            },
            this_week: {
                orders: weekOrders.length,
                new_clients: recentClients.length,
                revenue: calculateRevenue(weekOrders.filter(o => o.payment_status === 'completed'))
            },
            testimonials: {
                pending: testimonials.filter(t => !t.approved).length,
                total: testimonials.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ DEEPSEEK STATUS ENDPOINT ============
app.get('/api/deepseek-status', async (req, res) => {
    try {
        const { OpenAI } = require('openai');
        const deepseek = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: 'https://api.deepseek.com/v1'
        });
        
        const startTime = Date.now();
        const response = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'OK' }],
            max_tokens: 5
        });
        const responseTime = Date.now() - startTime;
        
        res.json({
            status: 'online',
            response_time_ms: responseTime,
            message: response.choices[0].message.content,
            api_key_configured: true
        });
    } catch (error) {
        res.json({
            status: 'offline',
            error: error.message,
            api_key_configured: !!process.env.DEEPSEEK_API_KEY
        });
    }
});

// ============ REFERRAL INFO ENDPOINT (for referral.html) ============
app.get('/api/referrer-info', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.status(400).json({ error: 'Missing referral code' });
        }
        
        const referrer = await db.getClientByReferralCode(code);
        if (!referrer) {
            return res.status(404).json({ error: 'Referral code not found' });
        }
        
        res.json({
            success: true,
            name: referrer.first_name || 'a friend',
            code: code
        });
    } catch (error) {
        console.error('Referrer info error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ DASHBOARD API ENDPOINTS ============

// Get full statistics for dashboard
app.get('/admin/full-stats', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const clients = await db.getAllClients();
        const testimonials = await db.getAllTestimonials();
        const errorReports = await db.getErrorReports ? await db.getErrorReports(null, 1000) : [];
        
        const now = new Date();
        const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const completedOrders = orders.filter(o => o.payment_status === 'completed');
        const pendingOrders = orders.filter(o => o.payment_status === 'pending');
        const activeClients = clients.filter(c => c.last_active && new Date(c.last_active) >= thirtyDaysAgo);
        
        const totalRevenue = completedOrders.reduce((sum, o) => {
            return sum + parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0);
        }, 0);
        
        const monthlyOrders = orders.filter(o => new Date(o.created_at) >= firstDayOfMonth);
        const monthlyRevenue = monthlyOrders.filter(o => o.payment_status === 'completed')
            .reduce((sum, o) => sum + parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0), 0);
        
        const cvOrders = orders.filter(o => o.service?.includes('cv') || o.service === 'legacy_cv');
        let totalSkills = 0, totalProjects = 0, totalAchievements = 0, totalVolunteer = 0;
        let totalLeadership = 0, totalCertifications = 0, totalLanguages = 0, totalReferees = 0;
        
        for (const order of cvOrders) {
            const cv = order.cv_data || {};
            totalSkills += (cv.skills?.technical?.length || 0) + (cv.skills?.soft?.length || 0) + (cv.skills?.tools?.length || 0);
            totalProjects += cv.projects?.length || 0;
            totalAchievements += cv.achievements?.length || 0;
            totalVolunteer += cv.volunteer?.length || 0;
            totalLeadership += cv.leadership?.length || 0;
            totalCertifications += cv.certifications?.length || 0;
            totalLanguages += cv.languages?.length || 0;
            totalReferees += cv.referees?.length || 0;
        }
        
        const installments = await db.getAllInstallmentPlans ? await db.getAllInstallmentPlans() : [];
        const payLater = await db.getAllPayLaterPlans ? await db.getAllPayLaterPlans() : [];
        
        res.json({
            timestamp: new Date().toISOString(),
            clients: {
                total: clients.length,
                active: activeClients.length
            },
            month: {
                orders: monthlyOrders.length,
                revenue: monthlyRevenue,
                new_clients: clients.filter(c => new Date(c.created_at) >= firstDayOfMonth).length,
                returning_clients: clients.filter(c => c.total_orders > 1).length,
                avg_rating: testimonials.length > 0 ? 
                    (testimonials.reduce((sum, t) => sum + (t.rating || 0), 0) / testimonials.length).toFixed(1) : 0,
                most_requested: 'N/A',
                most_requested_count: 0,
                highest_revenue_service: 'N/A'
            },
            cv_analytics: {
                total_cvs: cvOrders.length,
                total_skills: totalSkills,
                avg_skills_per_cv: cvOrders.length > 0 ? Math.round(totalSkills / cvOrders.length) : 0,
                total_projects: totalProjects,
                total_achievements: totalAchievements,
                total_volunteer: totalVolunteer,
                total_leadership: totalLeadership,
                total_certifications: totalCertifications,
                total_languages: totalLanguages,
                total_referees: totalReferees
            },
            payment_analytics: {
                installments: {
                    active: installments.filter(i => i.status === 'active').length,
                    completed: installments.filter(i => i.status === 'completed').length
                },
                pay_later: {
                    active: payLater.filter(p => p.status === 'pending').length,
                    overdue: payLater.filter(p => p.status === 'pending' && new Date(p.due_date) < new Date()).length
                }
            },
            error_analytics: {
                total_reports: errorReports.length,
                pending: errorReports.filter(r => r.status === 'pending').length,
                resolved: errorReports.filter(r => r.status === 'resolved').length,
                resolution_rate: errorReports.length > 0 ? 
                    ((errorReports.filter(r => r.status === 'resolved').length / errorReports.length) * 100).toFixed(1) : 0
            },
            testimonials: {
                total: testimonials.length,
                approved: testimonials.filter(t => t.approved).length,
                pending: testimonials.filter(t => !t.approved).length,
                average_rating: testimonials.length > 0 ?
                    (testimonials.reduce((sum, t) => sum + (t.rating || 0), 0) / testimonials.length).toFixed(1) : 0
            }
        });
    } catch (error) {
        console.error('Full stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get error reports list
app.get('/admin/error-reports', adminAuth, async (req, res) => {
    try {
        const reports = await db.getErrorReports ? await db.getErrorReports(null, 100) : [];
        
        const formatted = await Promise.all(reports.map(async (r) => {
            const client = await db.getClientById(r.client_id);
            return {
                id: r.id,
                client_name: client?.first_name || 'Unknown',
                description: r.description,
                status: r.status,
                created_at: r.created_at,
                resolved_at: r.resolved_at,
                file_id: r.file_id
            };
        }));
        
        res.json(formatted);
    } catch (error) {
        console.error('Error reports error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single error report
app.get('/admin/error-report/:id', adminAuth, async (req, res) => {
    try {
        const report = await db.getErrorReportById ? await db.getErrorReportById(req.params.id) : null;
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const client = await db.getClientById(report.client_id);
        res.json({
            ...report,
            client_name: client?.first_name || 'Unknown'
        });
    } catch (error) {
        console.error('Error report error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Resolve error report
app.post('/admin/resolve-report/:id', adminAuth, async (req, res) => {
    try {
        await db.updateErrorReportStatus(req.params.id, 'resolved', req.body.notes || 'Issue resolved');
        
        const report = await db.getErrorReportById(req.params.id);
        if (report) {
            const client = await db.getClientById(report.client_id);
            if (client && client.telegram_id) {
                const template = ADDITIONAL_TEMPLATES.error_report.resolved(
                    client.first_name || 'Friend', 
                    report.file_id?.slice(0, 8) || report.id
                );
                await bot.telegram.sendMessage(client.telegram_id, template, { parse_mode: 'Markdown' });
            }
        }
        
        res.json({ success: true, message: 'Report resolved' });
    } catch (error) {
        console.error('Resolve report error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single client
app.get('/admin/client/:id', adminAuth, async (req, res) => {
    try {
        const client = await db.getClientById(req.params.id);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        const orders = await db.getClientOrders(client.id);
        const totalSpent = orders.filter(o => o.payment_status === 'completed')
            .reduce((sum, o) => sum + parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0), 0);
        
        res.json({
            ...client,
            total_orders: orders.length,
            total_spent: totalSpent
        });
    } catch (error) {
        console.error('Client error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ PAYMENT DASHBOARD ENDPOINTS ============

// Get payment statistics
app.get('/admin/payment-stats', adminAuth, async (req, res) => {
    try {
        const orders = await db.getAllOrders();
        const installments = await db.getAllInstallmentPlans ? await db.getAllInstallmentPlans() : [];
        const payLater = await db.getAllPayLaterPlans ? await db.getAllPayLaterPlans() : [];
        
        const pendingOrders = orders.filter(o => o.payment_status === 'pending');
        const pendingAmount = pendingOrders.reduce((sum, o) => {
            const amount = parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0);
            return sum + amount;
        }, 0);
        
        const activeInstallments = installments.filter(i => i.status === 'active' || i.status === 'first_paid');
        const overduePayLater = payLater.filter(p => 
            p.status === 'pending' && new Date(p.due_date) < new Date()
        );
        
        res.json({
            total_pending: pendingOrders.length,
            total_pending_amount: pendingAmount,
            installments_active: activeInstallments.length,
            installments_completed: installments.filter(i => i.status === 'completed').length,
            pay_later_active: payLater.filter(p => p.status === 'pending').length,
            pay_later_completed: payLater.filter(p => p.status === 'completed').length,
            pay_later_overdue: overduePayLater.length
        });
    } catch (error) {
        console.error('Payment stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get installments list
app.get('/admin/installments', adminAuth, async (req, res) => {
    try {
        const installments = await db.getAllInstallmentPlans ? await db.getAllInstallmentPlans() : [];
        
        const formatted = installments.map(inst => {
            const currentInstallment = inst.installments?.[inst.current_installment - 1] || {};
            const dueDate = currentInstallment.due_date;
            const daysOverdue = dueDate ? 
                Math.floor((new Date() - new Date(dueDate)) / (1000 * 60 * 60 * 24)) : 0;
            
            return {
                order_id: inst.orderId,
                client_name: inst.clientName,
                current_installment: inst.current_installment,
                paid_amount: inst.paid_amount || 0,
                remaining_amount: inst.remaining_amount || 0,
                next_due_date: dueDate,
                days_overdue: daysOverdue > 0 ? daysOverdue : 0,
                status: inst.status
            };
        });
        
        res.json(formatted);
    } catch (error) {
        console.error('Installments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get pay later list
app.get('/admin/pay-later', adminAuth, async (req, res) => {
    try {
        const payLater = await db.getAllPayLaterPlans ? await db.getAllPayLaterPlans() : [];
        
        const formatted = payLater.map(pl => {
            const daysUntilDue = pl.due_date ? 
                Math.ceil((new Date(pl.due_date) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
            
            return {
                order_id: pl.orderId,
                client_name: pl.clientName,
                amount: pl.amount || 0,
                due_date: pl.due_date,
                days_until_due: daysUntilDue,
                status: pl.status
            };
        });
        
        res.json(formatted);
    } catch (error) {
        console.error('Pay later error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ TELEGRAM BOT ============
const bot = new Telegraf(process.env.BOT_TOKEN);

// ============ INITIALIZE TRACKERS ============
const installmentTracker = new InstallmentTracker(bot);
const referralTracker = new ReferralTracker(bot);

// ============ HELPER FOR MARKDOWN ============
async function sendMarkdown(ctx, message, extra = {}) {
    return await ctx.reply(message, { parse_mode: 'Markdown', ...extra });
}

// ============ TIME-BASED GREETINGS SYSTEM ============
const TIME_GREETINGS = {
    morning: {
        greetings: [
            (name) => `🌅 *Good Morning, ${name}!* 🌅`,
            (name) => `☀️ *Rise and Shine, ${name}!* ☀️`,
            (name) => `🌄 *Beautiful Morning, ${name}!* 🌄`,
            (name) => `🌞 *Top of the Morning, ${name}!* 🌞`,
            (name) => `🌸 *Good Morning, ${name}!* 🌸`,
            (name) => `🕊️ *Peaceful Morning, ${name}!* 🕊️`,
            (name) => `✨ *Morning Excellence, ${name}!* ✨`,
            (name) => `💫 *Fresh Start, ${name}!* 💫`
        ],
        subMessages: [
            "Starting your day with career investment? That's how winners begin!",
            "The early professional catches the opportunities!",
            "What a productive way to start your morning!",
            "Morning dedication leads to evening success!",
            "Investing in yourself before noon? Admirable!",
            "Your future self will thank you for this morning's work!",
            "There's something special about morning ambition!"
        ],
        emojis: ['🌅', '☀️', '🌄', '🌞', '🌸', '🕊️', '✨', '💫', '🌤️', '⛅']
    },
    afternoon: {
        greetings: [
            (name) => `☀️ *Good Afternoon, ${name}!* ☀️`,
            (name) => `🌤️ *Beautiful Afternoon, ${name}!* 🌤️`,
            (name) => `⛅ *Wonderful Afternoon, ${name}!* ⛅`,
            (name) => `🌟 *Good Afternoon, ${name}!* 🌟`,
            (name) => `💪 *Power Through, ${name}!* 💪`,
            (name) => `🎯 *Afternoon Excellence, ${name}!* 🎯`,
            (name) => `✨ *Productive Afternoon, ${name}!* ✨`,
            (name) => `🔥 *Afternoon Momentum, ${name}!* 🔥`
        ],
        subMessages: [
            "Powering through the day like a true professional!",
            "Midday career moves - that's the spirit!",
            "Making the most of every hour. Inspiring!",
            "Your afternoon dedication sets you apart!",
            "While others slow down, you're leveling up!",
            "Afternoon ambition leads to career success!",
            "This is when champions do the work!"
        ],
        emojis: ['☀️', '🌤️', '⛅', '🌟', '💪', '🎯', '✨', '🔥', '📊', '⚡']
    },
    evening: {
        greetings: [
            (name) => `🌆 *Good Evening, ${name}!* 🌆`,
            (name) => `🌙 *Lovely Evening, ${name}!* 🌙`,
            (name) => `✨ *Wonderful Evening, ${name}!* ✨`,
            (name) => `🌠 *Good Evening, ${name}!* 🌠`,
            (name) => `🕊️ *Peaceful Evening, ${name}!* 🕊️`,
            (name) => `💫 *Evening Excellence, ${name}!* 💫`,
            (name) => `🌟 *Golden Hour, ${name}!* 🌟`,
            (name) => `🌇 *Beautiful Sunset, ${name}!* 🌇`
        ],
        subMessages: [
            "Investing in yourself even after hours? That's true dedication!",
            "Ending your day with career growth - you're going places!",
            "Evening ambition shows real commitment to your future!",
            "Working on yourself when others are resting? Admirable!",
            "The evening is when visionaries plan their success!",
            "Tomorrow's success starts with tonight's preparation!"
        ],
        emojis: ['🌆', '🌙', '✨', '🌠', '🕊️', '💫', '🌟', '🌇', '🌃', '🎑']
    },
    night: {
        greetings: [
            (name) => `🌙 *Good Night, ${name}!* 🌙`,
            (name) => `⭐ *Late Night Excellence, ${name}!* ⭐`,
            (name) => `🌃 *Good Evening, ${name}!* 🌃`,
            (name) => `🌠 *Starry Night, ${name}!* 🌠`,
            (name) => `🦉 *Night Owl Mode, ${name}!* 🦉`,
            (name) => `✨ *Midnight Dedication, ${name}!* ✨`,
            (name) => `💫 *Nighttime Ambition, ${name}!* 💫`,
            (name) => `🌌 *Under the Stars, ${name}!* 🌌`
        ],
        subMessages: [
            "Working while others sleep? That's the mindset of achievers!",
            "Late night career moves - your dedication is remarkable!",
            "The quiet hours are when great things are built!",
            "Your commitment to excellence knows no clock!",
            "Burning the midnight oil for your future? Respect!",
            "Success doesn't sleep, and apparently neither do you!",
            "The night is when dreams are turned into plans!"
        ],
        emojis: ['🌙', '⭐', '🌃', '🌠', '🦉', '✨', '💫', '🌌', '🌟', '☪️']
    }
};

// ============ TIME-BASED WELCOME MESSAGES ============
const TIME_BASED_WELCOME = {
    morning: {
        firstTime: {
            honor: [
                (name) => `🌅 *${name}, a Blessed Morning to You!* 🌅\n\n🤝 We are truly honored you chose EasySuccor today.`,
                (name) => `☀️ *Good Morning, ${name}!* ☀️\n\n✨ What a privilege to start this day with you.`,
                (name) => `🌄 *${name}, Welcome to a New Beginning!* 🌄\n\n🙏 Thank you for trusting us this morning.`
            ],
            appreciation: [
                "Starting your morning with career investment? That's the mark of a true professional.",
                "The early hours are when successful people plant seeds for their future. You're doing exactly that.",
                "Morning dedication like yours is what separates achievers from dreamers.",
                "While others are still sleeping, you're building your professional legacy. Respect!"
            ]
        },
        returning: {
            greeting: [
                (name) => `🌅 *Welcome Back This Beautiful Morning, ${name}!* 🌅`,
                (name) => `☀️ *Good Morning, ${name}! So Good to See You Again!* ☀️`,
                (name) => `🌄 *${name}, You Brighten Our Morning!* 🌄`
            ],
            appreciation: [
                "Starting your day with us again? We're truly honored by your loyalty.",
                "Morning clients like you make our work a joy. Welcome back!",
                "There's no better way to start our morning than serving a returning champion like you."
            ]
        }
    },
    afternoon: {
        firstTime: {
            honor: [
                (name) => `☀️ *${name}, a Wonderful Afternoon to You!* ☀️\n\n🤝 We're truly honored you chose EasySuccor today.`,
                (name) => `🌤️ *Good Afternoon, ${name}!* 🌤️\n\n✨ Thank you for spending part of your day with us.`,
                (name) => `⛅ *${name}, Welcome to EasySuccor!* ⛅\n\n🙏 Your trust this afternoon means everything.`
            ],
            appreciation: [
                "Making career moves in the afternoon? That's how professionals level up!",
                "While others are counting down to evening, you're counting up your achievements!",
                "Afternoon dedication shows you're serious about your future. We love that energy!",
                "Midday motivation like yours is rare and valuable. Let's create something exceptional!"
            ]
        },
        returning: {
            greeting: [
                (name) => `☀️ *Welcome Back This Afternoon, ${name}!* ☀️`,
                (name) => `🌤️ *Good Afternoon, ${name}! Always a Pleasure!* 🌤️`,
                (name) => `⛅ *${name}, You Make Our Afternoon Brighter!* ⛅`
            ],
            appreciation: [
                "Returning in the afternoon? Your continued trust warms our hearts.",
                "Afternoon clients who come back are the ultimate compliment. Thank you!",
                "You could be anywhere this afternoon, but you chose us. We're grateful!"
            ]
        }
    },
    evening: {
        firstTime: {
            honor: [
                (name) => `🌆 *${name}, a Peaceful Evening to You!* 🌆\n\n🤝 We're truly honored you chose EasySuccor tonight.`,
                (name) => `🌙 *Good Evening, ${name}!* 🌙\n\n✨ Thank you for ending your day with us.`,
                (name) => `🌠 *${name}, Welcome This Beautiful Evening!* 🌠\n\n🙏 Your trust means the world to us.`
            ],
            appreciation: [
                "Investing in yourself after hours? That's the dedication of a true professional.",
                "Ending your day with career growth? Tomorrow you'll wake up ahead of the competition.",
                "Evening ambition like yours is what builds extraordinary careers.",
                "While others are winding down, you're gearing up. That's a winning mindset!"
            ]
        },
        returning: {
            greeting: [
                (name) => `🌆 *Welcome Back This Evening, ${name}!* 🌆`,
                (name) => `🌙 *Good Evening, ${name}! Wonderful to See You!* 🌙`,
                (name) => `🌠 *${name}, You Make Our Evening Special!* 🌠`
            ],
            appreciation: [
                "Ending your day with us again? We're truly honored by your loyalty.",
                "Evening returns like yours remind us why we love what we do.",
                "You chose to spend your evening with us. That means everything."
            ]
        }
    },
    night: {
        firstTime: {
            honor: [
                (name) => `🌙 *${name}, a Peaceful Night to You!* 🌙\n\n🤝 We're deeply honored you chose EasySuccor tonight.`,
                (name) => `⭐ *Good Evening, ${name}!* ⭐\n\n✨ Your dedication this late inspires us.`,
                (name) => `🌃 *${name}, Welcome to EasySuccor Tonight!* 🌃\n\n🙏 Thank you for trusting us at this hour.`
            ],
            appreciation: [
                "Working on your career while the world sleeps? That's extraordinary dedication.",
                "The quiet hours are when future leaders build their foundations. You're doing just that.",
                "Late night ambition like yours is rare and powerful. We're honored to serve you.",
                "Success doesn't have office hours, and clearly neither do you. Respect!"
            ]
        },
        returning: {
            greeting: [
                (name) => `🌙 *Welcome Back Tonight, ${name}!* 🌙`,
                (name) => `⭐ *Good Evening, ${name}! Always a Privilege!* ⭐`,
                (name) => `🌃 *${name}, You Light Up Our Night!* 🌃`
            ],
            appreciation: [
                "Returning at this hour? Your dedication and loyalty inspire us.",
                "Night owl clients like you are special. Thank you for coming back.",
                "You chose us again, even at this hour. We're truly grateful."
            ]
        }
    }
};

// ============ COMPREHENSIVE DYNAMIC ENCOURAGEMENTS ============
const ENCOURAGEMENTS = {
    start: [
        (name) => `🎯 Excellent choice, ${name}! This is where greatness begins.`,
        (name) => `💪 ${name}, you're already making smart decisions!`,
        (name) => `✨ ${name}, I can tell you're serious about your career!`,
        (name) => `🚀 Let's create something exceptional, ${name}!`,
        (name) => `🌟 ${name}, you're on the path to professional excellence!`,
        (name) => `💫 This is going to be fantastic, ${name}!`,
        (name) => `🏆 ${name}, winners make decisive choices. Well done!`,
        (name) => `🔥 ${name}, let's turn your experience into a powerful CV!`,
        (name) => `📄 ${name}, your professional story deserves to be told brilliantly.`,
        (name) => `⭐ ${name}, you've just taken the first step toward standing out!`
    ],
    progress: [
        (p, name) => `📊 ${name}, you're ${p}% there! Keep that momentum going! 💪`,
        (p, name) => `🎯 ${name}, ${p}% complete! You're making excellent progress! ⭐`,
        (p, name) => `💪 ${p}% done, ${name}! You're crushing it! 🎯`,
        (p, name) => `✨ ${name}, ${p}% finished! Your dedication shows! 🌟`,
        (p, name) => `🚀 ${p}% complete, ${name}! Almost at the finish line! 🏁`,
        (p, name) => `💫 ${name}, you're ${p}% there! Looking better with every step!`,
        (p, name) => `🔥 ${p}% done, ${name}! Your future self will thank you!`,
        (p, name) => `📈 ${name}, ${p}% complete! The hardest part is behind you!`,
        (p, name) => `🎨 ${p}% finished, ${name}! We're crafting something beautiful!`,
        (p, name) => `⚡ ${name}, you're ${p}% there! Keep that energy flowing!`
    ],
    sectionComplete: [
        (section, name) => `✅ ${name}, your ${section} is saved perfectly! You're on a roll! 🎯`,
        (section, name) => `🎉 ${section} complete, ${name}! This is coming together beautifully! ✨`,
        (section, name) => `👍 ${name}, ${section} looks excellent! Moving forward with confidence! 💪`,
        (section, name) => `📝 ${section} recorded, ${name}. You're doing an amazing job! 🌟`,
        (section, name) => `💫 ${section} done, ${name}! Every detail makes you shine brighter!`,
        (section, name) => `🏆 ${name}, your ${section} is impressive! Employers will notice!`,
        (section, name) => `✨ ${section} saved, ${name}! Your professionalism shows!`,
        (section, name) => `🔥 ${name}, ${section} looks fantastic! Keep that momentum!`,
        (section, name) => `🎯 ${section} complete, ${name}! You're building something powerful!`,
        (section, name) => `💎 ${name}, ${section} is polished and ready! On to the next!`
    ],
    final: [
        (name) => `🎉 *AMAZING JOB, ${name}!* 🎉\n\n${SEP}\nYou've provided everything I need to create a CV that truly represents your professional excellence.\n\nYour thoroughness and dedication are exactly what employers look for. This CV is going to open doors!`,
        (name) => `✨ *PERFECT, ${name}!* ✨\n\n${SEP}\nYou've done an exceptional job providing all the details. Your future CV already reflects the professional you are.\n\nNow let's get this masterpiece ready for you!`,
        (name) => `💪 *WAY TO GO, ${name}!* 💪\n\n${SEP}\nYou've completed every step with excellence. The foundation you've laid will result in a powerful, compelling CV.\n\nLet's bring it to life!`,
        (name) => `🌟 *OUTSTANDING WORK, ${name}!* 🌟\n\n${SEP}\nYour attention to detail and commitment to excellence shine through every section. This CV is going to make employers take notice.\n\nReady for the final step?`,
        (name) => `🏆 *YOU DID IT, ${name}!* 🏆\n\n${SEP}\nFrom start to finish, you've shown the dedication of a true professional. Your CV will reflect exactly that.\n\nNow let's get it delivered!`,
        (name) => `💫 *INCREDIBLE JOB, ${name}!* 💫\n\n${SEP}\nYou've shared your professional journey beautifully. I can already tell this CV is going to be exceptional.\n\nLet's complete the process!`,
        (name) => `🔥 *PHENOMENAL, ${name}!* 🔥\n\n${SEP}\nThe thoroughness you've shown tells me you're serious about your career. Employers value that.\n\nYour CV will showcase the professional you truly are!`,
        (name) => `📄 *MASTERFUL, ${name}!* 📄\n\n${SEP}\nEvery section you've completed adds to a compelling professional narrative. Your CV is going to stand out.\n\nReady to receive it?`,
        (name) => `⭐ *EXCELLENT WORK, ${name}!* ⭐\n\n${SEP}\nYou've provided everything needed for a powerful, professional CV. Your future self will thank you for this investment.\n\nLet's finish strong!`,
        (name) => `🎯 *BRILLIANT, ${name}!* 🎯\n\n${SEP}\nYou've completed your part with excellence. Now it's my turn to craft a CV that opens doors for you.\n\nLet's make it official!`
    ],
    halfway: [
        (name) => `🎯 ${name}, you're halfway there! This is where most people give up - but not you! 💪`,
        (name) => `✨ ${name}, 50% complete! Your dedication is inspiring! Keep going! 🌟`,
        (name) => `💫 Halfway done, ${name}! The finish line is in sight! 🏁`,
        (name) => `🔥 ${name}, you've made it halfway! This CV is already looking impressive!`,
        (name) => `🚀 ${name}, 50% there! Your future self is already proud of you!`
    ],
    almostThere: [
        (name) => `🎯 ${name}, you're almost at the finish line! Just a few more details! 💪`,
        (name) => `✨ So close, ${name}! 90% complete - the end is in sight! 🌟`,
        (name) => `💫 ${name}, you're nearly done! This CV is going to be worth every moment!`,
        (name) => `🔥 Almost there, ${name}! The hardest part is behind you!`,
        (name) => `🚀 ${name}, you're at the final stretch! Let's bring this home!`
    ],
    longSectionComplete: [
        (name, section) => `😮‍💨 ${name}, that was a detailed section! Thank you for your patience and thoroughness! 🙏`,
        (name, section) => `💪 ${name}, you powered through ${section} like a true professional! Excellent work!`,
        (name, section) => `🌟 ${name}, your attention to detail in ${section} is remarkable! Employers notice this!`,
        (name, section) => `🎯 ${name}, completing ${section} with such care shows real dedication. Impressive!`,
        (name, section) => `✨ ${name}, ${section} is perfectly done! Your professionalism shines through!`
    ],
    timeBased: {
        morning: [
            (name) => `🌅 Good morning, ${name}! Starting your day with career investment - that's how winners begin!`,
            (name) => `☀️ ${name}, what a productive way to start your morning! Let's create something great!`,
            (name) => `🌄 Rise and shine, ${name}! Your future CV awaits. Let's make today count!`
        ],
        afternoon: [
            (name) => `☀️ ${name}, powering through the afternoon like a true professional! Keep going!`,
            (name) => `🌤️ ${name}, your dedication this afternoon is inspiring! Almost there!`,
            (name) => `⛅ ${name}, making career moves in the afternoon - that's how it's done!`
        ],
        evening: [
            (name) => `🌙 ${name}, investing in yourself even in the evening? That's true dedication!`,
            (name) => `✨ ${name}, ending your day with career growth - you're going places!`,
            (name) => `🌠 ${name}, working on your future this evening? Admirable! Let's finish strong!`
        ],
        night: [
            (name) => `🌙 ${name}, burning the midnight oil for your career? That's commitment!`,
            (name) => `⭐ ${name}, late night career moves - you're dedicated to success!`,
            (name) => `🌃 ${name}, working while others sleep - that's the mindset of achievers!`
        ]
    }
};

// ============ TIME HELPER FUNCTIONS ============
function getTimePeriod() {
    // Get local time in Africa/Blantyre (UTC+2)
    const now = new Date();
    const localHour = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Blantyre' })).getHours();
    if (localHour >= 5 && localHour < 12) return 'morning';
    else if (localHour >= 12 && localHour < 17) return 'afternoon';
    else if (localHour >= 17 && localHour < 21) return 'evening';
    else return 'night';
}

function getTimeEmoji() {
    const period = getTimePeriod();
    const emojis = TIME_GREETINGS[period].emojis;
    return emojis[Math.floor(Math.random() * emojis.length)];
}

// ============ HELPER FUNCTIONS ============
function randomMessage(messages) {
    if (typeof messages === 'function') return messages;
    if (Array.isArray(messages)) {
        return messages[Math.floor(Math.random() * messages.length)];
    }
    return messages;
}

function getRandomEncouragement(type, value1, value2 = null) {
    const messages = ENCOURAGEMENTS[type];
    if (!messages) return '';
    let selectedMessage;
    if (Array.isArray(messages)) {
        selectedMessage = messages[Math.floor(Math.random() * messages.length)];
    } else {
        const subType = value2 || 'morning';
        selectedMessage = messages[subType]?.[Math.floor(Math.random() * messages[subType]?.length)];
    }
    if (typeof selectedMessage === 'function') {
        return selectedMessage(value1, value2);
    }
    return selectedMessage || '';
}

function getProgressEncouragement(percent, name) {
    if (percent >= 90) {
        const almostMessages = ENCOURAGEMENTS.almostThere;
        return almostMessages[Math.floor(Math.random() * almostMessages.length)](name);
    } else if (percent >= 45 && percent <= 55) {
        const halfwayMessages = ENCOURAGEMENTS.halfway;
        return halfwayMessages[Math.floor(Math.random() * halfwayMessages.length)](name);
    } else {
        return getRandomEncouragement('progress', percent, name);
    }
}

function getSectionEncouragement(section, name, isLongSection = false) {
    if (isLongSection) {
        return getRandomEncouragement('longSectionComplete', name, section);
    }
    return getRandomEncouragement('sectionComplete', section, name);
}

function getTimeBasedEncouragement(name) {
    const period = getTimePeriod();
    const messages = ENCOURAGEMENTS.timeBased[period];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    return msg(name);
}

// ============ WELCOME MESSAGE BUILDERS ============
function getTimeBasedFirstTimeWelcome(name) {
    const period = getTimePeriod();
    const welcomeData = TIME_BASED_WELCOME[period].firstTime;
    
    const honor = welcomeData.honor[Math.floor(Math.random() * welcomeData.honor.length)](name);
    const appreciation = welcomeData.appreciation[Math.floor(Math.random() * welcomeData.appreciation.length)];
    
    const trustMessages = [
        "${SEP}\n🙏 *Thank You for Your Trust*\n${SEP}",
        "${SEP}\n✨ *We Don't Take This Lightly*\n${SEP}",
        "${SEP}\n🤝 *Your Trust Inspires Us*\n${SEP}",
        "${SEP}\n💫 *We're Committed to Excellence*\n${SEP}"
    ];
    const trust = trustMessages[Math.floor(Math.random() * trustMessages.length)];
    
    const promiseMessages = [
        "We promise to deliver excellence worthy of your trust.",
        "Your CV will reflect the professional you truly are.",
        "We'll craft a document that makes you proud.",
        "Expect nothing less than exceptional quality.",
        "Your success is our success. Let's make it happen."
    ];
    const promise = promiseMessages[Math.floor(Math.random() * promiseMessages.length)];
    
    const beginMessages = [
        "${SEP}\n📋 *Let's Begin Your Journey*\n${SEP}",
        "${SEP}\n🚀 *Ready to Transform Your Career?*\n${SEP}",
        "${SEP}\n✨ *Your Professional Journey Starts Here*\n${SEP}",
        "${SEP}\n🎯 *Let's Create Something Exceptional*\n${SEP}"
    ];
    const begin = beginMessages[Math.floor(Math.random() * beginMessages.length)];
    
    return `${honor}\n\n${trust}\n\n${appreciation}\n\n${promise}\n\n${begin}\n\nPlease select your category:`;
}

function getTimeBasedReturningWelcome(name) {
    const period = getTimePeriod();
    const welcomeData = TIME_BASED_WELCOME[period].returning;
    
    const greeting = welcomeData.greeting[Math.floor(Math.random() * welcomeData.greeting.length)](name);
    const appreciation = welcomeData.appreciation[Math.floor(Math.random() * welcomeData.appreciation.length)].replace('${name}', name);
    
    const honorMessages = [
        "${SEP}\n🙏 *We're Honored You Returned*\n${SEP}",
        "${SEP}\n✨ *Your Loyalty Inspires Us*\n${SEP}",
        "${SEP}\n💝 *Clients Like You Make Our Work Meaningful*\n${SEP}",
        "${SEP}\n🤝 *Thank You for Your Continued Trust*\n${SEP}"
    ];
    const honor = honorMessages[Math.floor(Math.random() * honorMessages.length)];
    
    return `${greeting}\n\n${honor}\n\n${appreciation}\n\nWhat would you like to do today?`;
}
// ============ HUMAN-LIKE DYNAMIC RESPONSES ============
const RESPONSES = {
    encouragements: ENCOURAGEMENTS,
    questions: {
        name: ["What's your full name? 📛", "Tell me your name so I can personalize your CV. 📛"],
        email: ["What's your email address? 📧", "Your email please? 📧"],
        phone: ["Phone number? (Employers will call this) 📞", "What's the best number to reach you? 📞"],
        location: ["Where are you based? (City, Country) 📍", "What's your location? 📍"],
        education: ["What's your highest qualification? 🎓", "What is your highest level of education? 🎓"],
        jobTitle: ["Your most recent job title? 💼", "What position did you last hold? 💼"],
        skills: ["List your key skills (comma separated) ⚡", "What skills make you stand out? ⚡"]
    },
    reactions: { 
        positive: ["Love it! 💯", "Got it! 🎯", "Perfect! ✨", "Excellent! 🌟", "Great choice! 👍", "Fantastic! 💪"], 
        funny: ["Nice one! 😄", "Awesome! 🎉", "Sweet! 🔥", "You're doing great! 💪"] 
    },
    help: ["Need help? Just type what you're unsure about. Or type /pause to save progress. I'm here for you! 💙"],
    
    payment: {
        order_created: (orderId, service, deliveryTime, total) => `✅ *ORDER CREATED!* 🎉

${SEP}
📋 ORDER DETAILS
${SEP}

Order Number: \`${orderId}\`
Service: ${service}
⏰ Delivery: ${deliveryTime}
💰 Amount: ${total}

${SEP}
💳 SELECT PAYMENT METHOD
${SEP}

Choose how you would like to pay:`,
        
        payment_options: (reference, total) => `💳 *COMPLETE YOUR PAYMENT*

${SEP}
📋 ORDER SUMMARY
${SEP}

Amount: *${total}*
Reference: \`${reference}\`

${SEP}
💳 PAYMENT METHODS
${SEP}

Select your preferred payment method:`,
        
        mobile_payment: (reference, total, airtelNumber, mpambaNumber) => `💳 *MOBILE MONEY PAYMENT*

${SEP}
📋 PAYMENT DETAILS
${SEP}

Amount: *${total}*
Reference: \`${reference}\`

${SEP}
📱 SEND TO:
${SEP}

*Airtel Money:*
📞 ${airtelNumber}

*Mpamba:*
📞 ${mpambaNumber}

${SEP}
📌 INSTRUCTIONS
${SEP}

1️⃣ Open Airtel Money or Mpamba
2️⃣ Select "Send Money"
3️⃣ Enter the number above
4️⃣ Enter amount: *${total}*
5️⃣ Add reference: \`${reference}\`
6️⃣ Complete the transaction

${SEP}
✅ AFTER PAYMENT
${SEP}

Click the button below to confirm your payment:`,
        
        bank_payment: (reference, total, bankAccount) => `💳 *BANK TRANSFER PAYMENT*

${SEP}
📋 PAYMENT DETAILS
${SEP}

Amount: *${total}*
Reference: \`${reference}\`

${SEP}
🏦 BANK DETAILS
${SEP}

*Bank:* MO626
*Account Number:* ${bankAccount}
*Account Name:* EasySuccor Enterprises
*Reference:* ${reference}

${SEP}
📌 INSTRUCTIONS
${SEP}

1️⃣ Log into your internet banking
2️⃣ Transfer the exact amount
3️⃣ Use the reference above
4️⃣ Save your transaction receipt

${SEP}
✅ AFTER PAYMENT
${SEP}

Click the button below to confirm your payment:`,
        
        pay_later_created: (orderId, total, reference, dueDate) => `⏳ *PAY LATER PLAN ACTIVATED*

${SEP}
📋 ORDER DETAILS
${SEP}

Order: \`${orderId}\`
Amount: *${total}*
Reference: \`${reference}\`

${SEP}
⏰ PAYMENT DEADLINE
${SEP}

*Due Date:* ${dueDate}
*Time Remaining:* 7 days

${SEP}
⚠️ IMPORTANT NOTES
${SEP}

• Your document will be delivered AFTER payment
• 10% penalty if payment is late
• Reminders will be sent before due date
• You can request a 3-day extension (max 2 times)

${SEP}
💳 WHEN READY TO PAY
${SEP}

Click the button below when you make payment:`,
        
        installment_created: (orderId, total, firstAmount, secondAmount, reference, dueDate) => `📅 *INSTALLMENT PLAN ACTIVATED*

${SEP}
📋 ORDER DETAILS
${SEP}

Order: \`${orderId}\`
Total Amount: *${total}*
Reference: \`${reference}\`

${SEP}
💳 PAYMENT SCHEDULE
${SEP}

*1st Payment (50%):* MK${firstAmount.toLocaleString()}
   ➜ Pay now to start CV creation

*2nd Payment (50%):* MK${secondAmount.toLocaleString()}
   ➜ Due by: ${dueDate}
   ➜ Receive your final document

${SEP}
📌 HOW IT WORKS
${SEP}

1️⃣ Make the first payment now
2️⃣ We start working on your CV immediately
3️⃣ You receive a preview within 24 hours
4️⃣ Make the second payment within 7 days
5️⃣ Receive your final downloadable document

${SEP}
⚠️ LATE PAYMENT POLICY
${SEP}

• 10% penalty if more than 7 days overdue
• Extensions available upon request

${SEP}
💳 MAKE FIRST PAYMENT
${SEP}

Click the button below when you make your first payment:`,
        
        first_installment_confirmed: (firstAmount, secondAmount, dueDate) => `✅ *FIRST INSTALLMENT CONFIRMED!*

${SEP}
💰 PAYMENT RECEIVED
${SEP}

Amount Paid: *MK${firstAmount.toLocaleString()}*
Remaining: *MK${secondAmount.toLocaleString()}*

${SEP}
📋 WHAT HAPPENS NEXT
${SEP}

✅ Your CV creation has started!
⏰ You will receive a preview within 24 hours

${SEP}
📅 SECOND PAYMENT
${SEP}

Amount: *MK${secondAmount.toLocaleString()}*
Due Date: *${dueDate}*

${SEP}
⚠️ REMINDERS
${SEP}

• You will receive reminders before due date
• Late payments incur 10% penalty
• Extensions available on request

${SEP}
✅ AFTER FINAL PAYMENT
${SEP}

You will receive your downloadable document immediately.

Thank you for choosing EasySuccor! 🙏`,
        
        second_installment_confirmed: (totalAmount) => `✅ *FINAL INSTALLMENT CONFIRMED!*

${SEP}
💰 PAYMENT COMPLETE
${SEP}

Total Paid: *MK${totalAmount.toLocaleString()}*

${SEP}
📄 YOUR DOCUMENT IS READY!
${SEP}

Your document will be delivered in this chat immediately.

Thank you for completing your payment! 🎉

${SEP}
⭐ *NEXT STEPS*
${SEP}

• Your document is being delivered
• You have 2 free revision requests
• Share your experience with /feedback

Thank you for choosing EasySuccor! 🙏`,
        
        payment_confirmed: (amount, orderId, deliveryTime) => `✅ *PAYMENT CONFIRMED!* 🎉

${SEP}
💰 PAYMENT RECEIVED
${SEP}

Amount: *${amount}*
Order: \`${orderId}\`

${SEP}
📄 YOUR DOCUMENT
${SEP}

Your document will be delivered within *${deliveryTime}*.

Thank you for your trust in EasySuccor! 🙏`,
        
        payment_verified: (amount, orderId) => `✅ *PAYMENT VERIFIED!*

${SEP}
💰 PAYMENT DETAILS
${SEP}

Amount: *${amount}*
Order: \`${orderId}\`

${SEP}
📄 WHAT HAPPENS NEXT
${SEP}

Your document is now being prepared. You will receive it within the delivery timeframe.

Thank you for choosing EasySuccor! 🙏`
    }
};

// ============ DYNAMIC THANK YOU RESPONSES ============
const THANK_YOU_RESPONSES = [
    (name) => `🙏 *Our pleasure, ${name}.* Serving dedicated professionals like you is why we do what we do.`,
    (name) => `🤝 *The honor is ours, ${name}.* Thank you for trusting EasySuccor with your career journey.`,
    (name) => `✨ *You're most welcome, ${name}.* Your success is our greatest reward.`,
    (name) => `💫 *Thank YOU, ${name}.* Clients like you inspire excellence.`,
    (name) => `🌟 *Our privilege, ${name}.* Wishing you continued success.`
];

// ============ THANK YOU COMMAND WITH SEPARATE HIRE REMINDER ============
bot.command('thankyou', async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    const name = client?.first_name || 'Friend';
    const response = THANK_YOU_RESPONSES[Math.floor(Math.random() * THANK_YOU_RESPONSES.length)](name);
    
    await ctx.reply(response, { parse_mode: 'Markdown' });
    
    await ctx.reply(`${SEP}
🌟 *WHEN YOU LAND THE JOB*
${SEP}

We'd love to celebrate with you! 
Type /hired to share your success story.

Your achievement inspires others!`, { parse_mode: 'Markdown' });
});

// ============ HIRED COMMAND - Client Reports Job Success ============
bot.command('hired', async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    const name = client?.first_name || 'Friend';
    
    await ctx.reply(`🎉 *CONGRATULATIONS, ${name}!* 🎉

${SEP}
🌟 *This Is What We Work For!*
${SEP}

Your success is our greatest reward. We're truly honored to have played a part in your journey.

*Would you like to share your story?*

Tell us:
• What position did you get?
• Which company?
• Any advice for other job seekers?

*Just type your story below (or click Skip):*`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "⏭️ Skip for now", callback_data: "hired_skip" }],
                [{ text: "📝 Share anonymously", callback_data: "hired_anonymous" }]
            ]
        }
    });
    
    const session = await db.getActiveSession(client.id);
    if (session) {
        session.data.awaiting_hire_story = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    } else {
        await db.saveSession(client.id, 'awaiting_hire_story', null, { awaiting_hire_story: true }, 0);
    }
});

bot.action('hired_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_hire_story) {
        session.data.awaiting_hire_story = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    }
    
    await ctx.editMessageText(`🎉 *Congratulations again!*

${SEP}
Your achievement inspires us all.
${SEP}

Thank you for choosing EasySuccor. We wish you continued success in your career!

🤝 The EasySuccor Team`, { parse_mode: 'Markdown' });
    
    await db.logAdminAction({
        admin_id: 'system',
        action: 'client_hired',
        details: `Client ${client?.first_name || 'Anonymous'} reported getting hired (skipped story)`
    });
    
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
        await bot.telegram.sendMessage(
            adminChatId,
            `🎉 *Client Got Hired!*\n\nClient: ${client?.first_name || 'Anonymous'}\nStatus: Skipped sharing details`,
            { parse_mode: 'Markdown' }
        );
    }
});

bot.action('hired_anonymous', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_hire_story) {
        session.data.awaiting_hire_story = false;
        session.data.hire_anonymous = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    }
    
    await ctx.editMessageText(`🕊️ *Thank you for sharing!*

Your story will inspire others while keeping your identity private.

*What position did you get?* (Optional)
Type your response or click Skip.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "hire_detail_skip" }]]
        }
    });
});

bot.on('text', async (ctx, next) => {
    const client = await db.getClient(ctx.from.id);
    if (!client) return next();
    
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_hire_story && !ctx.message.text.startsWith('/')) {
        const story = ctx.message.text;
        const isAnonymous = session.data.hire_anonymous || false;
        
        await db.saveTestimonial({
            client_id: client.id,
            name: isAnonymous ? 'Anonymous' : (client.first_name || 'Valued Client'),
            text: story,
            rating: 5,
            position: 'Hired Client',
            approved: false,
            is_hire_story: true,
            anonymous: isAnonymous
        });
        
        session.data.awaiting_hire_story = false;
        session.data.hire_anonymous = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
        
        await ctx.reply(`🌟 *Thank You for Sharing Your Success!*

${SEP}
Your story will inspire countless others on their career journey.
${SEP}

We're truly honored to have been part of your success. Wishing you continued growth and achievement!

🤝 With gratitude,
The EasySuccor Team`, { parse_mode: 'Markdown' });
        
        await db.logAdminAction({
            admin_id: 'system',
            action: 'client_hired',
            details: `Client ${client.first_name || 'Anonymous'} reported getting hired. Story: ${story.substring(0, 100)}`
        });
        
        const adminChatId = process.env.ADMIN_CHAT_ID;
        if (adminChatId) {
            await bot.telegram.sendMessage(
                adminChatId,
                `🎉 *Client Got Hired!*\n\nClient: ${isAnonymous ? 'Anonymous' : (client.first_name || 'Unknown')}\nStory: ${story}\n\nUse /approve_testimonial to review.`,
                { parse_mode: 'Markdown' }
            );
        }
        return;
    }
    return next();
});

bot.action('hire_detail_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    
    if (session?.data?.awaiting_hire_story) {
        session.data.awaiting_hire_story = false;
        session.data.hire_anonymous = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    }
    
    await ctx.editMessageText(`🌟 *Thank You!*

${SEP}
Your success is what drives us. Congratulations again on your achievement!

🤝 The EasySuccor Team`, { parse_mode: 'Markdown' });
    
    await db.logAdminAction({
        admin_id: 'system',
        action: 'client_hired',
        details: `Client ${client?.first_name || 'Anonymous'} reported getting hired (minimal details)`
    });
    
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
        await bot.telegram.sendMessage(
            adminChatId,
            `🎉 *Client Got Hired!*\n\nClient: ${client?.first_name || 'Anonymous'}\nStatus: Shared minimal details`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ============ APPRECIATE COMMAND (Admin) ============
bot.command('appreciate', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return;
    
    const [_, targetId, ...messageParts] = ctx.message.text.split(' ');
    if (!targetId) return ctx.reply('Usage: `/appreciate [telegram_id] [message]`', { parse_mode: 'Markdown' });
    
    const client = await db.getClientById(targetId);
    if (!client) return ctx.reply('❌ Client not found.');
    
    const customMessage = messageParts.join(' ') || 'Your professionalism and patience make all the difference.';
    
    const appreciations = [
        `🌟 *A Note of Appreciation*\n\nDear ${client.first_name || 'Friend'},\n\n${customMessage}\n\nThank you for being an exceptional client.\n\n— The EasySuccor Team 🤝`,
        `💫 *With Gratitude*\n\nDear ${client.first_name || 'Friend'},\n\n${customMessage}\n\nClients like you elevate our work.\n\n— The EasySuccor Team 🤝`,
        `🙏 *Thank You*\n\nDear ${client.first_name || 'Friend'},\n\n${customMessage}\n\nYour trust means everything.\n\n— The EasySuccor Team 🤝`
    ];
    
    await bot.telegram.sendMessage(targetId, appreciations[Math.floor(Math.random() * appreciations.length)], { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Appreciation sent to ${client.first_name || 'the client'}.`);
});

// ============ LEGACY SUPPORT FUNCTIONS ============
function random(arr) { 
    return arr[Math.floor(Math.random() * arr.length)]; 
}

function getQuestion(type) { 
    return random(RESPONSES.questions[type]); 
}

function getReaction() { 
    return random([...RESPONSES.reactions.positive, ...RESPONSES.reactions.funny]); 
}

function getEncouragement(type, value, name = '') { 
    if (type === 'progress') return getProgressEncouragement(value, name);
    if (type === 'sectionComplete') return getSectionEncouragement(value, name);
    if (type === 'final') return getRandomEncouragement('final', value);
    if (type === 'start') return getRandomEncouragement('start', value);
    return getReaction();
}

// ============ SAFE CV DATA ACCESS HELPER (UPDATED - 18+ CATEGORIES) ============
function ensureCVData(session) {
    // Parse session.data if it came from the database as a string
    if (typeof session.data === 'string') {
        try {
            session.data = JSON.parse(session.data);
        } catch(e) {
            session.data = {};
        }
    }
    if (!session.data) session.data = {};
    
    if (!session.data.cv_data) {
        session.data.cv_data = {
            personal: { full_name: '', email: '', primary_phone: '', alternative_phone: '', whatsapp_phone: '', location: '', physical_address: '', nationality: '', linkedin: '', github: '', portfolio: '', professional_title: '', date_of_birth: '', special_documents: [] },
            professional_summary: '',
            employment: [],
            education: [],
            skills: { technical: [], soft: [], tools: [], certifications: [] },
            certifications: [],
            languages: [],
            projects: [],
            achievements: [],
            volunteer: [],
            leadership: [],
            awards: [],
            publications: [],
            conferences: [],
            referees: [],
            interests: [],
            social_media: { linkedin: '', github: '', twitter: '', facebook: '', instagram: '', portfolio: '' },
            portfolio: []
        };
    }
    
    if (!session.data.cv_data.personal) {
        session.data.cv_data.personal = { 
            full_name: '', email: '', primary_phone: '', alternative_phone: '', 
            whatsapp_phone: '', location: '', physical_address: '', nationality: '',
            linkedin: '', github: '', portfolio: '', professional_title: '', 
            date_of_birth: '', special_documents: [] 
        };
    }
    
    if (!session.data.cv_data.personal.special_documents) {
        session.data.cv_data.personal.special_documents = [];
    }
    if (!Array.isArray(session.data.cv_data.personal.special_documents)) {
        session.data.cv_data.personal.special_documents = [];
    }
    
    if (!session.data.cv_data.education) session.data.cv_data.education = [];
    if (!session.data.cv_data.employment) session.data.cv_data.employment = [];
    if (!session.data.cv_data.certifications) session.data.cv_data.certifications = [];
    if (!session.data.cv_data.languages) session.data.cv_data.languages = [];
    if (!session.data.cv_data.referees) session.data.cv_data.referees = [];
    if (!session.data.cv_data.projects) session.data.cv_data.projects = [];
    if (!session.data.cv_data.achievements) session.data.cv_data.achievements = [];
    if (!session.data.cv_data.volunteer) session.data.cv_data.volunteer = [];
    if (!session.data.cv_data.leadership) session.data.cv_data.leadership = [];
    if (!session.data.cv_data.awards) session.data.cv_data.awards = [];
    if (!session.data.cv_data.publications) session.data.cv_data.publications = [];
    if (!session.data.cv_data.conferences) session.data.cv_data.conferences = [];
    if (!session.data.cv_data.interests) session.data.cv_data.interests = [];
    if (!session.data.cv_data.portfolio) session.data.cv_data.portfolio = [];
    
    if (!session.data.cv_data.skills || typeof session.data.cv_data.skills !== 'object') {
        session.data.cv_data.skills = { technical: [], soft: [], tools: [], certifications: [] };
    }
    if (!session.data.cv_data.skills.technical) session.data.cv_data.skills.technical = [];
    if (!session.data.cv_data.skills.soft) session.data.cv_data.skills.soft = [];
    if (!session.data.cv_data.skills.tools) session.data.cv_data.skills.tools = [];
    if (!session.data.cv_data.skills.certifications) session.data.cv_data.skills.certifications = [];
    
    if (!session.data.cv_data.social_media) {
        session.data.cv_data.social_media = { linkedin: '', github: '', twitter: '', facebook: '', instagram: '', portfolio: '' };
    }
    
    return session.data.cv_data;
}

// ============ SAFE COVER LETTER DATA ACCESS HELPER ============
function ensureCoverLetterData(session) {
    // Parse session.data if it came from the database as a string
    if (typeof session.data === 'string') {
        try {
            session.data = JSON.parse(session.data);
        } catch(e) {
            session.data = {};
        }
    }
    if (!session.data) session.data = {};
    
    if (!session.data.coverletter) session.data.coverletter = {};
    if (session.data.coverletter_position === undefined) session.data.coverletter_position = '';
    if (session.data.coverletter_company === undefined) session.data.coverletter_company = '';
    if (session.data.vacancy_data === undefined) session.data.vacancy_data = null;
    if (session.data.awaiting_vacancy === undefined) session.data.awaiting_vacancy = false;
    if (!session.data.cover_data) session.data.cover_data = {};
    
    return session.data;
}

// ============ DATABASE HELPERS ============
async function getOrCreateClient(ctx) {
    let client = await db.getClient(ctx.from.id);
    if (!client) client = await db.createClient(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
    return client;
}

async function debugSession(ctx, session, message) {
    console.log(`[DEBUG] ${message}`);
    console.log(`[DEBUG] Stage: ${session.stage}`);
    console.log(`[DEBUG] Current section: ${session.current_section}`);
    console.log(`[DEBUG] Collection step: ${session.data?.collection_step}`);
    console.log(`[DEBUG] Text received: ${ctx.message?.text}`);
}

async function getOrCreateSession(clientId) {
    let session = await db.getActiveSession(clientId);
    if (!session) {
        await db.saveSession(clientId, 'selecting_category', null, {});
        session = await db.getActiveSession(clientId);
    }
    if (!session.data) session.data = {};
    if (typeof session.data === 'string') { try { session.data = JSON.parse(session.data); } catch(e) { session.data = {}; } }
    if (!session.data.services) session.data.services = [];
    return session;
}

// ============ PERSISTENT KEYBOARD ============
const mainMenuKeyboard = Markup.keyboard([
    ["📄 New CV", "📝 Editable CV"],
    ["💌 Cover Letter", "📎 Editable Cover Letter"],
    ["✏️ Update CV", "📎 Upload Draft"],
    ["ℹ️ About", "📞 Contact", "🏠 Portal"]
]).resize().persistent();

// ============ DOCUMENT UPLOAD HANDLING (unified handler) ============
// This handler processes both single document requests (e.g., after education)
// and bulk attachment collection.

async function requestDocumentUpload(ctx, client, docType, description, fieldName) {
    const message = `📎 *Please upload your ${description}*

We need a clear, readable copy of your ${description}.

*Tips for a good photo:*
• Good lighting
• Place the document on a flat surface
• Ensure the entire document is visible
• Avoid shadows and glare

*Supported formats:* PDF, JPG, PNG (max 20MB)

Send the file now, or click Skip if you don't have it.`;

    await sendMarkdown(ctx, message, {
        reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip for now", callback_data: `skip_doc_${docType}` }]] }
    });

    const session = await db.getActiveSession(client.id);
    if (session) {
        session.data.awaiting_document = { type: docType, field: fieldName, description };
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    } else {
        await db.saveSession(client.id, 'awaiting_document', null, { awaiting_document: { type: docType, field: fieldName, description } }, 0);
    }
}

async function resumeDocumentCollection(ctx, client, session) {
    if (session.stage === 'collecting_education') {
        await handleEducationCollection(ctx, client, session, null, null, true);
    } else if (session.stage === 'collecting_personal') {
        await handlePersonalCollection(ctx, client, session, null, true);
    } else if (session.stage === 'collecting_certifications') {
        await handleCertificationsCollection(ctx, client, session, null, null);
    } else {
        await startDataCollection(ctx, client, session);
    }
}

// Combined file handler (photo or document)
bot.on(['photo', 'document'], async (ctx, next) => {
    const client = await db.getClient(ctx.from.id);
    if (!client) return next();

    const session = await db.getActiveSession(client.id);
    if (!session) return next();

    // Priority 1: Awaiting a specific document (e.g., after education, certification)
    if (session.data?.awaiting_document) {
        const awaiting = session.data.awaiting_document;
        let fileId, mimeType, fileName;

        if (ctx.message.photo) {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            fileId = photo.file_id;
            mimeType = 'image/jpeg';
            fileName = `photo_${Date.now()}.jpg`;
        } else if (ctx.message.document) {
            fileId = ctx.message.document.file_id;
            mimeType = ctx.message.document.mime_type;
            fileName = ctx.message.document.file_name;
        } else {
            return next();
        }

        await ctx.reply("📤 Uploading and enhancing your document...");

        try {
            const fileLink = await ctx.telegram.getFileLink(fileId);
            const tempPath = path.join(__dirname, 'temp', `${Date.now()}_${fileName}`);
            await documentGenerator.downloadFile(fileLink.href, tempPath);

            let enhancedPath = null;
            if (mimeType.startsWith('image/')) {
                enhancedPath = await documentGenerator.enhanceImage(tempPath);
            }

            const fileBuffer = fs.readFileSync(tempPath);
            const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');

            const existing = await db.getClientDocumentByHash(client.id, hash);
            if (existing) {
                await ctx.reply(`✅ We already have your ${awaiting.description} on file. Using the existing copy.`);
                if (!session.data.uploaded_docs) session.data.uploaded_docs = {};
                session.data.uploaded_docs[awaiting.type] = existing.id;
                fs.unlinkSync(tempPath);
                if (enhancedPath && fs.existsSync(enhancedPath)) fs.unlinkSync(enhancedPath);
            } else {
                const docId = await db.saveClientDocument({
                    client_id: client.id,
                    document_type: awaiting.type,
                    file_path: tempPath,
                    enhanced_path: enhancedPath,
                    file_hash: hash,
                    original_filename: fileName,
                    mime_type: mimeType,
                    file_size: fs.statSync(tempPath).size,
                    notes: `Uploaded for ${awaiting.field}`
                });
                await ctx.reply(`✅ ${awaiting.description} uploaded and saved successfully!`);
                if (!session.data.uploaded_docs) session.data.uploaded_docs = {};
                session.data.uploaded_docs[awaiting.type] = docId;
            }

            delete session.data.awaiting_document;
            await db.updateSession(session.id, session.stage, session.current_section, session.data);
            await resumeDocumentCollection(ctx, client, session);
        } catch (error) {
            console.error('Document upload error:', error);
            await ctx.reply(`❌ Failed to process your document. Please try again or click Skip.`);
        }
        return;
    }

    // Priority 2: Attachment collection mode (bulk attachments)
    if (session.data?.attachment_step === 'awaiting_file') {
        const docType = session.data.current_attachment_type;
        if (!docType) return;

        let fileId, mimeType, fileName;
        if (ctx.message.photo) {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            fileId = photo.file_id;
            mimeType = 'image/jpeg';
            fileName = `photo_${Date.now()}.jpg`;
        } else if (ctx.message.document) {
            fileId = ctx.message.document.file_id;
            mimeType = ctx.message.document.mime_type;
            fileName = ctx.message.document.file_name;
        } else {
            return next();
        }

        await ctx.reply("📤 Processing your document...");

        try {
            const fileLink = await ctx.telegram.getFileLink(fileId);
            const tempPath = path.join(__dirname, 'temp', `${Date.now()}_${fileName}`);
            await documentGenerator.downloadFile(fileLink.href, tempPath);

            let enhancedPath = null;
            if (mimeType.startsWith('image/')) {
                enhancedPath = await documentGenerator.enhanceImage(tempPath);
            }

            const fileBuffer = fs.readFileSync(tempPath);
            const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');

            const existing = await db.getClientDocumentByHash(client.id, hash);
            if (existing) {
                await ctx.reply(`✅ Document already on file (duplicate).`);
                fs.unlinkSync(tempPath);
                if (enhancedPath && fs.existsSync(enhancedPath)) fs.unlinkSync(enhancedPath);
            } else {
                const docId = await db.saveClientDocument({
                    client_id: client.id,
                    document_type: docType,
                    file_path: tempPath,
                    enhanced_path: enhancedPath,
                    file_hash: hash,
                    original_filename: fileName,
                    mime_type: mimeType,
                    file_size: fs.statSync(tempPath).size,
                    notes: `Uploaded via attachment collection`
                });
                await ctx.reply(`✅ ${getDocumentTypeLabel(docType)} saved successfully!`);

                if (!session.data.attachments_collected) session.data.attachments_collected = [];
                session.data.attachments_collected.push({
                    type: docType,
                    id: docId,
                    label: getDocumentTypeLabel(docType)
                });
            }

            delete session.data.current_attachment_type;
            session.data.attachment_step = 'select_type';
            await db.updateSession(session.id, session.stage, session.current_section, session.data);
            await showAttachmentTypeMenu(ctx, client, session);
        } catch (error) {
            console.error('Attachment upload error:', error);
            await ctx.reply(`❌ Failed to process document. Please try again.`);
        }
        return;
    }

    return next();
});

// ============ ATTACHMENT COLLECTION LOOP ============
function getDocumentTypeLabel(type) {
    const labels = {
        'national_id': 'National ID / Driver\'s Licence',
        'degree_certificate': 'Degree/Diploma Certificate',
        'certification_image': 'Professional Certification',
        'training_certificate': 'Training Certificate',
        'conference_certificate': 'Conference Certificate',
        'other': 'Other Document'
    };
    return labels[type] || type;
}

async function showAttachmentTypeMenu(ctx, client, session) {
    const message = `📎 *Add Supporting Document*

Select the type of document you want to upload:

1️⃣ National ID / Driver's Licence
2️⃣ Degree / Diploma Certificate
3️⃣ Professional Certification
4️⃣ Training Certificate
5️⃣ Conference Attendance Certificate
6️⃣ Other Document

You can upload multiple documents. After each upload, you'll be asked if you want to add another.

Click the type below, or select "Done" when finished.`;

    await sendMarkdown(ctx, message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "1️⃣ National ID", callback_data: "attach_type_national_id" }],
                [{ text: "2️⃣ Degree/Diploma", callback_data: "attach_type_degree_certificate" }],
                [{ text: "3️⃣ Certification", callback_data: "attach_type_certification_image" }],
                [{ text: "4️⃣ Training Cert", callback_data: "attach_type_training_certificate" }],
                [{ text: "5️⃣ Conference Cert", callback_data: "attach_type_conference_certificate" }],
                [{ text: "6️⃣ Other", callback_data: "attach_type_other" }],
                [{ text: "✅ Done", callback_data: "attachments_done" }],
                [{ text: "⏭️ Skip All", callback_data: "attachments_skip" }]
            ]
        }
    });
}

bot.action(/attach_type_(.+)/, async (ctx) => {
    const docType = ctx.match[1];
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);

    session.data.current_attachment_type = docType;
    session.data.attachment_step = 'awaiting_file';
    await db.updateSession(session.id, session.stage, session.current_section, session.data);

    await sendMarkdown(ctx, `📸 Please upload the document for *${getDocumentTypeLabel(docType)}*.

*Tips for a good photo:*
• Good lighting
• Flat surface
• Entire document visible
• No shadows or glare

Send the file now, or click Cancel.`, {
        reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cancel_attachment_upload" }]] }
    });
});

bot.action('cancel_attachment_upload', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);

    delete session.data.current_attachment_type;
    session.data.attachment_step = 'select_type';
    await db.updateSession(session.id, session.stage, session.current_section, session.data);

    await showAttachmentTypeMenu(ctx, client, session);
});

bot.action('attachments_done', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);

    session.data.include_attachments = true;
    session.data.attachments_list = session.data.attachments_collected || [];
    delete session.data.attachment_step;
    delete session.data.current_attachment_type;
    delete session.data.pending_attachments;

    await db.updateSession(session.id, session.stage, session.current_section, session.data);

    await ctx.editMessageText(`✅ ${session.data.attachments_list.length} document(s) will be included as an appendix.`);

    await proceedWithCVOnly(ctx, client, session);
});

bot.action('attachments_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);

    session.data.include_attachments = false;
    delete session.data.attachment_step;
    delete session.data.current_attachment_type;

    await db.updateSession(session.id, session.stage, session.current_section, session.data);

    await ctx.editMessageText(`⏭️ Skipped attachments. Proceeding with your order.`);

    await proceedWithCVOnly(ctx, client, session);
});

// ============ COMBINED ORDER FLOW ============
async function handleServiceSelection(ctx, client, session, data) {
    const serviceMap = {
        service_new: 'new cv',
        service_editable: 'editable cv',
        service_cover: 'cover letter',
        service_editable_cover: 'editable cover letter',
        service_update: 'cv update'
    };

    const selectedService = serviceMap[data];
    session.data.service = selectedService;

    if (selectedService !== 'cv update') {
        await sendMarkdown(ctx, `${getReaction()} *Service selected:* ${selectedService}\n\nWould you like to add a cover letter to your order?`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Yes, add cover letter", callback_data: "add_cover_yes" }],
                    [{ text: "❌ No, just CV", callback_data: "add_cover_no" }]
                ]
            }
        });
        session.data.pending_cover_choice = true;
        await db.updateSession(session.id, 'selecting_cover_addon', null, session.data);
        return;
    }

    if (selectedService === 'cv update') {
        await handleIntelligentUpdate(ctx, client, session);
        return;
    }

    if (selectedService === 'cover letter' || selectedService === 'editable cover letter') {
        await handleCoverLetterStart(ctx, client, session);
        return;
    }

    await proceedWithCVOnly(ctx, client, session);
}

async function proceedWithCVOnly(ctx, client, session) {
    await sendMarkdown(ctx, `${getReaction()} *Service selected:* ${session.data.service}

*Would you like to upload an existing draft to save time?*

I can extract ALL information from your existing CV including 18+ categories.

*I'll only ask for what's missing!*`, {
        reply_markup: { inline_keyboard: [
            [{ text: "📎 Yes, upload draft", callback_data: "build_draft" }],
            [{ text: "✍️ No, enter manually", callback_data: "build_manual" }]
        ] }
    });
    await db.updateSession(session.id, 'selecting_build_method', null, session.data);
}

bot.action(/add_cover_(yes|no)/, async (ctx) => {
    const addCover = ctx.match[1] === 'yes';
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);

    session.data.include_cover = addCover;
    if (addCover) {
        session.data.cover_service = session.data.service === 'editable cv' ? 'editable cover letter' : 'cover letter';
        await sendMarkdown(ctx, `✅ Cover letter will be included.\n\nNow, would you like to include your supporting documents (certificates, ID, etc.) as an appendix?`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Yes, include attachments", callback_data: "include_attachments_yes" }],
                    [{ text: "❌ No, just CV and cover letter", callback_data: "include_attachments_no" }]
                ]
            }
        });
        session.data.pending_attachments_choice = true;
        await db.updateSession(session.id, 'selecting_attachments_addon', null, session.data);
    } else {
        session.data.include_attachments = false;
        await proceedWithCVOnly(ctx, client, session);
    }
});

bot.action(/include_attachments_(yes|no)/, async (ctx) => {
    const includeAttachments = ctx.match[1] === 'yes';
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);

    session.data.include_attachments = includeAttachments;
    if (includeAttachments) {
        const existingDocs = await db.getClientDocuments(client.id);
        if (existingDocs.length > 0) {
            let msg = `📎 *We have the following documents on file:*\n\n`;
            for (const doc of existingDocs) {
                msg += `• ${getDocumentTypeLabel(doc.document_type)}: ${doc.original_filename}\n`;
            }
            msg += `\nDo you want to use these, upload new ones, or skip?`;
            await sendMarkdown(ctx, msg, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📄 Use existing", callback_data: "use_existing_attachments" }],
                        [{ text: "📸 Upload new", callback_data: "upload_new_attachments" }],
                        [{ text: "⏭️ Skip attachments", callback_data: "skip_attachments" }]
                    ]
                }
            });
            session.data.pending_attachment_choice = true;
        } else {
            await sendMarkdown(ctx, `📎 *You have no documents on file.*\n\nPlease upload your supporting documents (certificates, ID, etc.) one by one.\n\nClick 'Start' to begin or 'Skip' to continue without attachments.`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📸 Start Upload", callback_data: "start_attachment_upload" }],
                        [{ text: "⏭️ Skip", callback_data: "skip_attachments" }]
                    ]
                }
            });
            session.data.pending_attachment_choice = true;
        }
        await db.updateSession(session.id, 'selecting_attachments', null, session.data);
    } else {
        session.data.include_attachments = false;
        await proceedWithCVOnly(ctx, client, session);
    }
});

bot.action('use_existing_attachments', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);

    const existingDocs = await db.getClientDocuments(client.id);
    session.data.attachments_list = existingDocs.map(doc => ({
        type: doc.document_type,
        id: doc.id,
        label: getDocumentTypeLabel(doc.document_type)
    }));
    session.data.include_attachments = true;
    delete session.data.pending_attachment_choice;

    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    await ctx.editMessageText(`✅ Using ${session.data.attachments_list.length} existing document(s).`);

    await proceedWithCVOnly(ctx, client, session);
});

bot.action('upload_new_attachments', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);

    delete session.data.pending_attachment_choice;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    await ctx.editMessageText(`📸 Let's upload your documents.`);
    await showAttachmentTypeMenu(ctx, client, session);
});

bot.action('skip_attachments', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);

    session.data.include_attachments = false;
    delete session.data.pending_attachment_choice;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    await ctx.editMessageText(`⏭️ Skipped attachments. Proceeding with your order.`);

    await proceedWithCVOnly(ctx, client, session);
});

// ============ START - DIRECT TO CATEGORY (NO WELCOME) ============
async function startDirect(ctx, client, session) {
    await sendMarkdown(ctx, `📋 *Welcome! Select your category to get started:*`, {
        reply_markup: { inline_keyboard: [
            [{ text: "🎓 Student - still studying", callback_data: "cat_student" }],
            [{ text: "📜 Recent Graduate < a year", callback_data: "cat_recent" }],
            [{ text: "💼 Professional - Currently working", callback_data: "cat_professional" }],
            [{ text: "🌱 Non-Working - Career break", callback_data: "cat_nonworking" }],
            [{ text: "🔄 Returning Client - Used us before", callback_data: "cat_returning" }]
        ] }
    });
    
    await db.updateSession(session.id, 'selecting_category', null, session.data);
}

// ============ CATEGORY SELECTION ============
async function handleCategorySelection(ctx, client, session, data) {
    const categoryMap = {
        cat_student: 'student', cat_recent: 'recentgraduate',
        cat_professional: 'professional', cat_nonworking: 'nonworkingprofessional',
        cat_returning: 'returningclient'
    };
    
    session.data.category = categoryMap[data];
    
    const serviceButtons = session.data.category === 'returningclient' ? [
        [{ text: "📝 Editable CV", callback_data: "service_editable" }],
        [{ text: "✏️ Update CV", callback_data: "service_update" }],
        [{ text: "💌 Cover Letter", callback_data: "service_cover" }],
        [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }]
    ] : [
        [{ text: "📄 New CV", callback_data: "service_new" }],
        [{ text: "📝 Editable CV", callback_data: "service_editable" }],
        [{ text: "💌 Cover Letter", callback_data: "service_cover" }],
        [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }]
    ];
    
    await sendMarkdown(ctx, `✅ ${getReaction()} Category selected: *${session.data.category}*

Now, which service would you like?`, {
        reply_markup: { inline_keyboard: serviceButtons }
    });
    
    await db.updateSession(session.id, 'selecting_service', null, session.data);
}

// ============ SERVICE SELECTION ============
async function handleServiceSelection(ctx, client, session, data) {
    // If no category is set (e.g., returning client), use a default
    if (!session.data.category) {
        session.data.category = 'professional'; // or 'returningclient'
        console.log(`⚠️ No category found, defaulting to ${session.data.category}`);
    }
    
    const serviceMap = {
        service_new: 'new cv', 
        service_editable: 'editable cv',
        service_cover: 'cover letter', 
        service_editable_cover: 'editable cover letter',
        service_update: 'cv update'
    };
    
    const selectedService = serviceMap[data];
    session.data.service = selectedService;
    
    if (selectedService === 'cv update') {
        await handleIntelligentUpdate(ctx, client, session);
        return;
    }
    
    if (selectedService === 'cover letter' || selectedService === 'editable cover letter') {
        await handleCoverLetterStart(ctx, client, session);
        return;
    }
    
    const cvData = ensureCVData(session);
    
    await sendMarkdown(ctx, `${getReaction()} *Service selected:* ${selectedService}

*Would you like to upload an existing draft to save time?*

I can extract ALL information from your existing CV including:
📋 Personal Info
💼 Work Experience (with responsibilities & achievements)
🎓 Education
⚡ Skills (categorized)
📜 Certifications
🌍 Languages
📁 Projects
🏆 Achievements
🤝 Volunteer Experience
👔 Leadership Roles
🏅 Awards
📖 Publications
🎤 Conferences
👥 Referees
💡 Interests
🌐 Social Media Links

*I'll only ask for what's missing!*`, {
        reply_markup: { inline_keyboard: [
            [{ text: "📎 Yes, upload draft", callback_data: "build_draft" }],
            [{ text: "✍️ No, enter manually", callback_data: "build_manual" }]
        ] }
    });
    
    await db.updateSession(session.id, 'selecting_build_method', null, session.data);
}

// ============ COVER LETTER HANDLERS (UPDATED) ============
async function handleCoverLetterStart(ctx, client, session) {
    ensureCoverLetterData(session);
    
    await sendMarkdown(ctx, `📝 *Cover Letter Creation*

I'll help you create a professional cover letter tailored to your dream job.

*What I'll need from you:*
• Position you're applying for
• Company name
• Your relevant experience
• Top skills for this role
• Key achievement
• Why you're interested
• Availability to start

*Do you have a job vacancy in mind?*

Select an option:`, {
        reply_markup: { inline_keyboard: [
            [{ text: "📄 Yes, I have vacancy details", callback_data: "cover_has_vacancy" }],
            [{ text: "✍️ No, create general cover letter", callback_data: "cover_no_vacancy" }]
        ] }
    });
    
    await db.updateSession(session.id, 'cover_selecting_vacancy', 'cover', session.data);
}

// ============ VACANCY CHECK DURING COVER LETTER FLOW ============
bot.on('text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) return next();
    
    const client = await db.getClient(ctx.from.id);
    if (!client) return next();
    
    const session = await db.getActiveSession(client.id);
    if (!session) return next();
    
    if (session.stage === 'cover_collecting_position') {
        const position = ctx.message.text;
        const matches = await vacancyLibrary.findSimilarVacancies(position);
        if (matches.length > 0) {
            await checkVacancyLibrary(ctx, position);
            return;
        }
    }
    return next();
});

bot.action(/vacancy_match_(.+)/, async (ctx) => {
    const vacancyId = ctx.match[1];
    const vacancy = await db.getVacancyById(vacancyId);
    
    await ctx.answerCbQuery();
    await ctx.editMessageText(`✅ *Using Existing Vacancy Details*\n\nPosition: ${vacancy.position}\nCompany: ${vacancy.company}\n\nI'll tailor your documents perfectly for this role!`);
    
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    session.data.vacancy_data = vacancy;
    session.data.using_library_vacancy = true;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    
    await askCoverLetterQuestions(ctx, client, session);
});

async function handleCoverVacancyChoice(ctx, client, session, data) {
    if (data === 'cover_has_vacancy') {
        session.data.cover_has_vacancy = true;
        await sendMarkdown(ctx, `📄 *Share the Job Vacancy*

You can send me:
• 📎 PDF or DOCX file
• 📸 Screenshot (image)
• 📝 Paste the job description text

I'll extract:
• Position title
• Company name
• Requirements
• Responsibilities
• Deadline

Send the vacancy details now:`);
        session.data.awaiting_vacancy = true;
        await db.updateSession(session.id, 'awaiting_vacancy_upload', 'cover', session.data);
    } else {
        session.data.cover_has_vacancy = false;
        await askCoverLetterQuestions(ctx, client, session);
    }
}

async function askCoverLetterQuestions(ctx, client, session) {
    session.data.cover_data = {};
    session.data.cover_step = 'position';
    
    await sendMarkdown(ctx, `📝 *Tell me about the job*

*What position are you applying for?*

*Example:* "Senior Software Engineer", "Project Manager", "Data Collector"

Type the job title:`);
    await db.updateSession(session.id, 'cover_collecting_position', 'cover', session.data);
}

async function handleCoverPosition(ctx, client, session, text) {
    session.data.cover_data.position = text;
    session.data.cover_step = 'company';
    await sendMarkdown(ctx, `✅ Got it! *${text}*

*Which company are you applying to?*

*Example:* "ABC Corporation", "UNDP Malawi", "Google", "National Statistics Office"

Type the company name:`);
    await db.updateSession(session.id, 'cover_collecting_company', 'cover', session.data);
}

async function handleCoverCompany(ctx, client, session, text) {
    session.data.cover_data.company = text;
    session.data.cover_step = 'experience_highlight';
    await sendMarkdown(ctx, `✅ Thanks!

*What's your most relevant experience for this role?* (2-3 sentences)

*Example:* "5 years of project management experience leading teams of 10+"

Type your key experience (2-3 sentences):`);
    await db.updateSession(session.id, 'cover_collecting_experience', 'cover', session.data);
}

async function handleCoverExperience(ctx, client, session, text) {
    session.data.cover_data.experience_highlight = text;
    session.data.cover_step = 'skills_highlight';
    await sendMarkdown(ctx, `✅ Great experience!

*What are your top 3 skills for this role?* (comma separated)

*Example:* "Project Management, Team Leadership, Budget Planning"

Type your skills (comma separated):`);
    await db.updateSession(session.id, 'cover_collecting_skills', 'cover', session.data);
}

async function handleCoverSkills(ctx, client, session, text) {
    session.data.cover_data.skills = text.split(',').map(s => s.trim());
    session.data.cover_step = 'achievement';
    await sendMarkdown(ctx, `✅ Skills saved!

*What's your biggest professional achievement?*

*Example:* "Increased sales by 40% in 6 months", "Successfully delivered MK2M project under budget"

Type your key achievement:`);
    await db.updateSession(session.id, 'cover_collecting_achievement', 'cover', session.data);
}

async function handleCoverAchievement(ctx, client, session, text) {
    session.data.cover_data.achievement = text;
    session.data.cover_step = 'why_you';
    await sendMarkdown(ctx, `✅ Impressive!

*Why are you interested in this role/company?* (2-3 sentences)

*Example:* "I'm passionate about your mission to improve education", "I admire your innovative approach to technology"

Type your motivation (2-3 sentences):`);
    await db.updateSession(session.id, 'cover_collecting_why', 'cover', session.data);
}

async function handleCoverWhy(ctx, client, session, text) {
    session.data.cover_data.motivation = text;
    session.data.cover_step = 'availability';
    await sendMarkdown(ctx, `✅ Great motivation!

*When are you available to start?*

Select an option:`, {
        reply_markup: { inline_keyboard: [
            [{ text: "📅 Immediately", callback_data: "cover_availability_immediate" }],
            [{ text: "📅 2 weeks notice", callback_data: "cover_availability_2weeks" }],
            [{ text: "📅 1 month notice", callback_data: "cover_availability_1month" }],
            [{ text: "📝 Specific date", callback_data: "cover_availability_specific" }]
        ] }
    });
    await db.updateSession(session.id, 'cover_collecting_availability', 'cover', session.data);
}

async function handleCoverAvailabilityChoice(ctx, client, session, data) {
    let availability = '';
    if (data === 'cover_availability_immediate') availability = 'Immediately';
    else if (data === 'cover_availability_2weeks') availability = '2 weeks notice';
    else if (data === 'cover_availability_1month') availability = '1 month notice';
    else if (data === 'cover_availability_specific') {
        await sendMarkdown(ctx, `📅 Please enter your specific start date (e.g., "1st June 2025"):`);
        session.data.cover_step = 'availability_specific';
        await db.updateSession(session.id, 'cover_collecting_availability_specific', 'cover', session.data);
        return;
    }
    
    session.data.cover_data.availability = availability;
    await finalizeCoverLetter(ctx, client, session);
}

async function handleCoverAvailabilitySpecific(ctx, client, session, text) {
    session.data.cover_data.availability = text;
    await finalizeCoverLetter(ctx, client, session);
}

// ============ UPDATED FINALIZE COVER LETTER ============
async function finalizeCoverLetter(ctx, client, session) {
    const cvData = ensureCVData(session);
    const personal = cvData.personal || {};
    const coverData = session.data.cover_data || {};
    const vacancyData = session.data.vacancy_data || {};
    
    if (session.data.cover_has_vacancy && vacancyData) {
        if (vacancyData.position && !coverData.position) coverData.position = vacancyData.position;
        if (vacancyData.company && !coverData.company) coverData.company = vacancyData.company;
    }
    
    const orderId = `CL_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const basePrice = 5000;
    const deliveryOption = session.data.delivery_option || 'standard';
    const deliveryFee = DELIVERY_PRICES[deliveryOption] || 0;
    const totalCharge = formatPrice(basePrice + deliveryFee);
    const deliveryTime = DELIVERY_TIMES[deliveryOption];
    
    const summary = `📝 *COVER LETTER SUMMARY*

${SEP}
📋 DETAILS
${SEP}

Position: ${coverData.position || vacancyData.position || 'Not specified'}
Company: ${coverData.company || vacancyData.company || 'Not specified'}
Experience: ${coverData.experience_highlight || 'Provided'}
Skills: ${(coverData.skills || []).join(', ') || 'Provided'}
Achievement: ${coverData.achievement || 'Provided'}
Availability: ${coverData.availability || 'Not specified'}

${SEP}
💰 PRICE
${SEP}

Base Price: MK5,000
Delivery Fee: +${deliveryFee}
Total: ${totalCharge}
Delivery: ${deliveryTime}

${SEP}
✅ Type *CONFIRM* to proceed or *EDIT* to make changes.`;

    await sendMarkdown(ctx, summary);
    session.data.awaiting_cover_confirmation = true;
    session.data.pending_cover_order = {
        orderId, coverData, vacancyData, deliveryOption, deliveryFee, totalCharge, deliveryTime, basePrice
    };
    await db.updateSession(session.id, 'awaiting_cover_confirmation', 'cover', session.data);
}

async function handleCoverConfirmation(ctx, client, session, text) {
    if (text.toUpperCase() === 'CONFIRM') {
        const pending = session.data.pending_cover_order;
        
        const coverResult = await documentGenerator.generateCoverLetter({
            position: pending.coverData.position || pending.vacancyData.position || 'Not specified',
            company: pending.coverData.company || pending.vacancyData.company || 'Not specified',
            experience: pending.coverData.experience_highlight,
            skills: pending.coverData.skills,
            achievement: pending.coverData.achievement,
            motivation: pending.coverData.motivation,
            availability: pending.coverData.availability
        }, cvData, personal, false);
        
        await db.createOrder({
            id: pending.orderId, client_id: client.id, service: 'cover letter', 
            category: session.data.category || 'professional',
            delivery_option: pending.deliveryOption, delivery_time: pending.deliveryTime, 
            base_price: pending.basePrice, delivery_fee: pending.deliveryFee,
            total_charge: pending.totalCharge, payment_status: 'pending',
            cv_data: { cover_letter: pending.coverData, vacancy: pending.vacancyData }
        });
        
        const paymentReference = generatePaymentReference();
        await db.updateOrderPaymentReference(pending.orderId, paymentReference);
        
        await showPaymentOptions(ctx, pending.orderId, pending.totalCharge, paymentReference);
        
        session.data.awaiting_cover_confirmation = false;
        await db.updateSession(session.id, 'awaiting_payment', 'payment', session.data);
    } else if (text.toUpperCase().startsWith('EDIT')) {
        await sendMarkdown(ctx, `What would you like to change? Type the field name (position, company, experience, skills, achievement, motivation, availability):`);
        session.data.editing_cover = true;
        await db.updateSession(session.id, 'editing_cover', 'cover', session.data);
    }
}
// ============ VACANCY LIBRARY SYSTEM ============
class VacancyLibrary {
    constructor() {
        this.commonKeywords = {
            'software engineer': ['developer', 'programming', 'coding', 'software'],
            'project manager': ['pm', 'project lead', 'scrum master', 'agile'],
            'data analyst': ['data science', 'analytics', 'sql', 'excel'],
            'accountant': ['finance', 'bookkeeping', 'audit', 'tax'],
            'teacher': ['education', 'instructor', 'lecturer', 'tutor'],
            'nurse': ['healthcare', 'medical', 'clinical', 'patient care'],
            'driver': ['transport', 'logistics', 'delivery', 'vehicle'],
            'carpenter': ['woodwork', 'joinery', 'furniture', 'construction']
        };
    }
    
    generateVacancyHash(vacancy) {
        const normalized = `${vacancy.position}|${vacancy.company}|${vacancy.location || ''}`
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
        return require('crypto').createHash('md5').update(normalized).digest('hex');
    }
    
    async storeVacancy(vacancyData, clientId = null) {
        const hash = this.generateVacancyHash(vacancyData);
        const existing = await db.getVacancyByHash(hash);
        if (existing) {
            await db.incrementVacancyUsage(existing.id);
            return { ...existing, is_new: false };
        }
        const vacancy = {
            ...vacancyData,
            hash,
            requirements: JSON.stringify(vacancyData.requirements || []),
            responsibilities: JSON.stringify(vacancyData.responsibilities || []),
            benefits: JSON.stringify(vacancyData.benefits || [])
        };
        const id = await db.createVacancy(vacancy);
        if (clientId) {
            await db.recordVacancyMatch(id, clientId);
        }
        return { ...vacancy, id, is_new: true };
    }
    
    async findSimilarVacancies(position, company = null) {
        const allVacancies = await db.getAllVacancies();
        const matches = [];
        const searchTerms = position.toLowerCase().split(' ');
        const categoryKeywords = this.getCategoryKeywords(position);
        for (const vac of allVacancies) {
            let score = 0;
            const vacPosition = vac.position.toLowerCase();
            const vacCompany = vac.company.toLowerCase();
            if (vacPosition === position.toLowerCase()) score += 50;
            if (company && vacCompany === company.toLowerCase()) score += 30;
            for (const term of searchTerms) if (vacPosition.includes(term)) score += 10;
            for (const keyword of categoryKeywords) if (vacPosition.includes(keyword)) score += 5;
            if (position.toLowerCase().includes(vac.location?.toLowerCase() || '')) score += 15;
            if (score >= 40) matches.push({ ...vac, match_score: score });
        }
        return matches.sort((a, b) => b.match_score - a.match_score).slice(0, 5);
    }
    
    getCategoryKeywords(position) {
        const lower = position.toLowerCase();
        for (const [category, keywords] of Object.entries(this.commonKeywords)) {
            if (keywords.some(k => lower.includes(k))) return keywords;
        }
        return [];
    }
    
    formatVacancyMatches(matches, clientPosition) {
        if (matches.length === 0) return null;
        let message = `🔍 *I Found Similar Vacancies in Our Library!*\n\n`;
        message += `${SEP}\n`;
        message += `We already have details for ${matches.length} similar position(s).\n`;
        message += `${SEP}\n\n`;
        matches.slice(0, 3).forEach((match, i) => {
            const matchPercent = Math.min(100, match.match_score);
            message += `${i + 1}. *${match.position}* at *${match.company}*\n`;
            message += `   📍 ${match.location || 'Location not specified'}\n`;
            message += `   📊 ${matchPercent}% match\n`;
            if (match.deadline) message += `   ⏰ Deadline: ${match.deadline}\n`;
            message += `\n`;
        });
        message += `${SEP}\n`;
        message += `Is one of these the position you're applying for?\n\n`;
        message += `✅ *Yes, use existing details* - I'll tailor your documents perfectly\n`;
        message += `📝 *No, this is different* - I'll collect new details\n`;
        return message;
    }
}

const vacancyLibrary = new VacancyLibrary();

async function handleVacancyCollection(ctx, client, session, vacancyData) {
    const stored = await vacancyLibrary.storeVacancy(vacancyData, client.id);
    if (!stored.is_new) {
        await ctx.reply(`📚 *This vacancy is already in our library!*\n\nWe've helped other clients apply to ${vacancyData.position} at ${vacancyData.company} before. This means we know exactly what they're looking for!`);
    }
    session.data.vacancy_data = vacancyData;
}

async function checkVacancyLibrary(ctx, position, company = null) {
    const matches = await vacancyLibrary.findSimilarVacancies(position, company);
    if (matches.length === 0) return null;
    const message = vacancyLibrary.formatVacancyMatches(matches, position);
    await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Yes, use this", callback_data: `vacancy_match_${matches[0].id}` }],
                [{ text: "📋 Show more options", callback_data: `vacancy_more_${position}` }],
                [{ text: "📝 No, different position", callback_data: "vacancy_new" }]
            ]
        }
    });
    return matches;
}

// ============ PORTFOLIO COLLECTION ============
class PortfolioCollector {
    async askForPortfolio(ctx) {
        await sendMarkdown(ctx, `📎 *Portfolio & Social Media (Optional)*

Would you like to include links to your work and professional profiles?

*What you can add:*
• LinkedIn profile
• GitHub repositories
• Twitter/X profile
• Facebook profile
• Instagram (professional)
• Personal website/portfolio
• Behance/Dribbble (creatives)
• Case studies or project links

*Why this matters:* Employers love seeing real work examples and professional presence!

Type your links (one per line) or click SKIP.

*Examples:* 
https://linkedin.com/in/username
https://github.com/username
https://yourportfolio.com`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Portfolio", callback_data: "portfolio_skip" }]] }
        });
    }
    
    parsePortfolioLinks(text) {
        if (!text || text.toLowerCase() === 'skip') return [];
        const links = [];
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) links.push(trimmed);
        }
        return links;
    }
    
    categorizeSocialLinks(links) {
        const social = { linkedin: null, github: null, twitter: null, facebook: null, instagram: null, portfolio: null, other: [] };
        for (const link of links) {
            if (link.includes('linkedin.com')) social.linkedin = link;
            else if (link.includes('github.com')) social.github = link;
            else if (link.includes('twitter.com') || link.includes('x.com')) social.twitter = link;
            else if (link.includes('facebook.com')) social.facebook = link;
            else if (link.includes('instagram.com')) social.instagram = link;
            else if (link.includes('behance.net') || link.includes('dribbble.com') || link.includes('medium.com')) social.portfolio = link;
            else social.other.push(link);
        }
        return social;
    }
}

const portfolioCollector = new PortfolioCollector();

async function handlePortfolioCollection(ctx, client, session, text) {
    if (typeof session.data === 'string') {
    try { session.data = JSON.parse(session.data); } catch(e) { session.data = {}; }
}
    try {
        let portfolioLinks = [];
        let socialMedia = { linkedin: null, github: null, twitter: null, facebook: null, instagram: null, portfolio: null };
        if (text !== 'skip' && text?.toLowerCase() !== 'skip') {
            const lines = text.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
                    portfolioLinks.push(trimmed);
                    if (trimmed.includes('linkedin.com')) socialMedia.linkedin = trimmed;
                    else if (trimmed.includes('github.com')) socialMedia.github = trimmed;
                    else if (trimmed.includes('twitter.com') || trimmed.includes('x.com')) socialMedia.twitter = trimmed;
                    else if (trimmed.includes('facebook.com')) socialMedia.facebook = trimmed;
                    else if (trimmed.includes('instagram.com')) socialMedia.instagram = trimmed;
                    else if (trimmed.includes('behance.net') || trimmed.includes('dribbble.com') || trimmed.includes('medium.com')) socialMedia.portfolio = trimmed;
                }
            }
        }
        if (typeof session.data === 'string') {
    try { session.data = JSON.parse(session.data); } catch(e) { session.data = {}; }
}
        session.data.portfolio_links = portfolioLinks;
        const cvData = ensureCVData(session);
        cvData.social_media = socialMedia;
        cvData.portfolio = portfolioLinks;
        await sendMarkdown(ctx, `${getReaction()} ${portfolioLinks.length > 0 ? `${portfolioLinks.length} link(s) saved!` : 'No portfolio added.'}

Now let's build your CV! 

${getQuestion('name')}`);
        await startDataCollection(ctx, client, session);
    } catch (error) {
        console.error('Portfolio error:', error);
        session.data.portfolio_links = [];
        await sendMarkdown(ctx, `Let's continue with your details.\n\n${getQuestion('name')}`);
        await startDataCollection(ctx, client, session);
    }
}

async function startDataCollection(ctx, client, session) {
    const cvData = ensureCVData(session);
    if (!session.data.portfolio_links || !Array.isArray(session.data.portfolio_links)) session.data.portfolio_links = [];
    cvData.portfolio = session.data.portfolio_links;
    session.current_section = 'personal';
    session.data.collection_step = 'name';
    session.data.special_docs_list = [];
    await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
}

async function sendHireReminder(clientId) {
    const client = await db.getClientById(clientId);
    if (!client) return;
    const orders = await db.getClientOrders(clientId);
    const lastOrder = orders[0];
    if (!lastOrder) return;
    const daysSinceOrder = Math.floor((Date.now() - new Date(lastOrder.created_at)) / (1000 * 60 * 60 * 24));
    if (daysSinceOrder === 30 && lastOrder.status === 'delivered') {
        await bot.telegram.sendMessage(
            client.telegram_id,
            `👋 *Hello ${client.first_name || 'Friend'}!*

${SEP}
🌟 *How's Your Job Search Going?*
${SEP}

It's been a month since we created your CV. If you've landed a job, we'd love to celebrate with you!

Type /hired to share your success story.

Your achievement inspires others in their career journey!

🤝 The EasySuccor Team`,
            { parse_mode: 'Markdown' }
        );
    }
}

// ============ MODIFIED PERSONAL COLLECTION (with ID upload) ============
async function handlePersonalCollection(ctx, client, session, text, isResume = false) {
    const cvData = ensureCVData(session);
    const personal = cvData.personal;
    let step = session.data.collection_step;

    if (isResume && step === 'after_id') {
        step = 'finish_personal';
        session.data.collection_step = 'finish_personal';
    }

    if (step === 'name') {
        personal.full_name = text;
        session.data.collection_step = 'email';
        await sendMarkdown(ctx, getQuestion('email'));
    }
    else if (step === 'email') {
        personal.email = text;
        session.data.collection_step = 'phone';
        await sendMarkdown(ctx, getQuestion('phone'));
    }
    else if (step === 'phone') {
        personal.primary_phone = text;
        session.data.collection_step = 'alt_phone';
        await sendMarkdown(ctx, "📞 Alternative phone number?", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_alt_phone" }]] }
        });
    }
    else if (step === 'alt_phone') {
        personal.alternative_phone = text === 'Skip' ? null : text;
        session.data.collection_step = 'whatsapp';
        await sendMarkdown(ctx, "📱 WhatsApp for delivery?", {
            reply_markup: { inline_keyboard: [[{ text: "📱 Same", callback_data: "whatsapp_same" }, { text: "✏️ Type New", callback_data: "whatsapp_type" }]] }
        });
    }
    else if (step === 'whatsapp') {
        if (text !== 'whatsapp_type' && text !== 'Same') {
            personal.whatsapp_phone = text === 'Same' ? personal.primary_phone : text;
        } else if (text === 'whatsapp_type') {
            await sendMarkdown(ctx, "Please type your WhatsApp number:");
            return;
        }
        session.data.collection_step = 'location';
        await sendMarkdown(ctx, getQuestion('location'));
    }
    else if (step === 'location') {
        personal.location = text;
        session.data.collection_step = 'professional_title';
        await sendMarkdown(ctx, "💼 *Professional title?* (Optional)\n\n*Example:* Senior Software Engineer, Project Manager\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_professional_title" }]] }
        });
    }
    else if (step === 'professional_title') {
        if (text.toLowerCase() !== 'skip') personal.professional_title = text;
        session.data.collection_step = 'linkedin';
        await sendMarkdown(ctx, "🔗 *LinkedIn URL?* (Optional)\n\n*Example:* https://linkedin.com/in/yourname\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_linkedin" }]] }
        });
    }
    else if (step === 'linkedin') {
        if (text.toLowerCase() !== 'skip') personal.linkedin = text;
        session.data.collection_step = 'github';
        await sendMarkdown(ctx, "💻 *GitHub URL?* (Optional)\n\n*Example:* https://github.com/yourusername\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_github" }]] }
        });
    }
    else if (step === 'github') {
        if (text.toLowerCase() !== 'skip') personal.github = text;
        session.data.collection_step = 'physical_address';
        await sendMarkdown(ctx, `🏠 *Physical address?* (Street, building, area)\n\nType 'Skip' to continue.`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_physical_address" }]] }
        });
    }
    else if (step === 'physical_address') {
        if (text.toLowerCase() !== 'skip') personal.physical_address = text;
        session.data.collection_step = 'nationality';
        await sendMarkdown(ctx, `🌍 *Nationality?*\n\nType 'Skip' to continue.`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_nationality" }]] }
        });
    }
    else if (step === 'nationality') {
        if (text.toLowerCase() !== 'skip') personal.nationality = text;
        session.data.collection_step = 'date_of_birth';
        await sendMarkdown(ctx, `🎂 *Date of Birth?* (Optional)\n\n*Example:* 15 May 1990\n\nType 'Skip' to continue.`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_dob" }]] }
        });
    }
    else if (step === 'date_of_birth') {
        if (text.toLowerCase() !== 'skip') personal.date_of_birth = text;
        session.data.collection_step = 'id_upload';

        const existingDocs = await db.getClientDocuments(client.id, 'national_id');
        if (existingDocs.length > 0) {
            await sendMarkdown(ctx, `🆔 *We already have your National ID on file.*\n\nDo you want to use the existing copy or upload a new one?`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📄 Use existing", callback_data: "use_existing_national_id" }],
                        [{ text: "📸 Upload new", callback_data: "upload_new_national_id" }],
                        [{ text: "⏭️ Skip", callback_data: "skip_national_id" }]
                    ]
                }
            });
            session.data.pending_id_choice = true;
        } else {
            await requestDocumentUpload(ctx, client, 'national_id', 'National ID or Driver\'s Licence', 'personal.id');
        }
        await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
        return;
    }
    else if (step === 'after_id') {
        session.data.collection_step = 'special_docs';
        await sendMarkdown(ctx, `📋 *Special Documents (Optional)*

Do you have any special documents? (e.g., Professional License, Work Permit, etc.)

Type each document name and number, one per line.

*Examples:*
• Professional License: TEVETA/2024/001
• Work Permit: MW2024/12345

Click 'Skip' to continue or 'Done' when finished.`, {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_special_docs" }, { text: "✅ Done", callback_data: "done_special_docs" }]] }
        });
        session.data.special_docs_list = [];
    }
    else if (step === 'special_docs') {
        if (text === 'skip_special_docs') {
            personal.special_documents = [];
            session.current_section = 'education';
            session.data.collection_step = 'level';
            await sendMarkdown(ctx, `${getReaction()}\n\nNow let's add your education.\n\n${getQuestion('education')}`);
            await db.updateSession(session.id, 'collecting_education', 'education', session.data);
            return;
        } else if (text === 'done_special_docs') {
            personal.special_documents = session.data.special_docs_list || [];
            session.current_section = 'education';
            session.data.collection_step = 'level';
            await sendMarkdown(ctx, `${getReaction()}\n\nNow let's add your education.\n\n${getQuestion('education')}`);
            await db.updateSession(session.id, 'collecting_education', 'education', session.data);
            return;
        } else {
            if (!session.data.special_docs_list) session.data.special_docs_list = [];
            session.data.special_docs_list.push(text);
            await sendMarkdown(ctx, `✓ Added. Add another? (Click 'Done' to finish, 'Skip' to skip this section)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_special_docs" }, { text: "✅ Done", callback_data: "done_special_docs" }]] }
            });
        }
        return;
    }
    else if (step === 'finish_personal') {
        // End of personal section
        session.current_section = 'education';
        session.data.collection_step = 'level';
        await sendMarkdown(ctx, `${getReaction()}\n\nNow let's add your education.\n\n${getQuestion('education')}`);
        await db.updateSession(session.id, 'collecting_education', 'education', session.data);
        return;
    }

    await db.updateSession(session.id, 'collecting_personal', 'personal', session.data);
}

// ID reuse handlers
bot.action('use_existing_national_id', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const existingDocs = await db.getClientDocuments(client.id, 'national_id');
    if (existingDocs.length) {
        if (!session.data.uploaded_docs) session.data.uploaded_docs = {};
        session.data.uploaded_docs.national_id = existingDocs[0].id;
        await ctx.editMessageText(`✅ Using existing National ID document.`);
    }
    session.data.collection_step = 'after_id';
    await handlePersonalCollection(ctx, client, session, null, true);
});

bot.action('upload_new_national_id', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📸 Please upload a clear photo of your National ID or Driver's Licence.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.awaiting_document = { type: 'national_id', field: 'personal.id', description: 'National ID or Driver\'s Licence' };
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
});

bot.action('skip_national_id', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`⏭️ Skipped. You can upload it later.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.collection_step = 'after_id';
    await handlePersonalCollection(ctx, client, session, null, true);
});
// ============ MODIFIED EDUCATION COLLECTION (with certificate upload) ============
async function handleEducationCollection(ctx, client, session, text, callbackData = null, isResume = false) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const education = cvData.education;

    if (!session.data.temp_edu) session.data.temp_edu = {};
    const currentEdu = session.data.temp_edu;

    if (step === 'level') {
        if (callbackData === 'edu_skip') {
            session.current_section = 'skills';
            session.data.collection_step = 'skills';
            await sendMarkdown(ctx, `${getReaction()}\n\nNow let's add your skills.\n\n${getQuestion('skills')}`);
            await db.updateSession(session.id, 'collecting_skills', 'skills', session.data);
            return;
        }
        currentEdu.level = text;
        session.data.collection_step = 'field';
        await sendMarkdown(ctx, "📚 Field of study?");
    }
    else if (step === 'field') {
        currentEdu.field = text;
        session.data.collection_step = 'institution';
        await sendMarkdown(ctx, "🏛️ Institution?");
    }
    else if (step === 'institution') {
        currentEdu.institution = text;
        session.data.collection_step = 'year';
        await sendMarkdown(ctx, "📅 Year of completion?");
    }
    else if (step === 'year') {
        currentEdu.year = text;
        education.push({ ...currentEdu });
        session.data.temp_edu = {};

        const eduIndex = education.length - 1;
        session.data.pending_edu_cert = eduIndex;

        const existingDocs = await db.getClientDocuments(client.id, 'degree_certificate');
        if (existingDocs.length > 0) {
            await sendMarkdown(ctx, `🎓 *We already have a degree certificate on file.*\n\nDo you want to use the existing copy or upload a new one for "${currentEdu.level} in ${currentEdu.field}"?`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📄 Use existing", callback_data: "use_existing_degree_cert" }],
                        [{ text: "📸 Upload new", callback_data: "upload_new_degree_cert" }],
                        [{ text: "⏭️ Skip", callback_data: "skip_degree_cert" }]
                    ]
                }
            });
        } else {
            await requestDocumentUpload(ctx, client, 'degree_certificate', `certificate for ${currentEdu.level} in ${currentEdu.field}`, `education.${eduIndex}.certificate`);
        }
        session.data.collection_step = 'waiting_cert';
        await db.updateSession(session.id, 'collecting_education', 'education', session.data);
        return;
    }
    else if (step === 'waiting_cert' && (isResume || callbackData)) {
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Education saved!\n\nAnother qualification?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "edu_yes" }],
                [{ text: "❌ No", callback_data: "edu_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'edu_yes') {
            session.data.collection_step = 'level';
            await sendMarkdown(ctx, "Next qualification level? 🎓");
        } else {
            session.current_section = 'skills';
            session.data.collection_step = 'skills';
            await sendMarkdown(ctx, `${getReaction()}\n\nNow let's add your skills.\n\n${getQuestion('skills')}`);
            await db.updateSession(session.id, 'collecting_skills', 'skills', session.data);
        }
        return;
    }

    await db.updateSession(session.id, 'collecting_education', 'education', session.data);
}

// Certificate reuse handlers for education
bot.action('use_existing_degree_cert', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const existingDocs = await db.getClientDocuments(client.id, 'degree_certificate');
    if (existingDocs.length) {
        if (!session.data.uploaded_docs) session.data.uploaded_docs = {};
        session.data.uploaded_docs.degree_certificate = existingDocs[0].id;
        await ctx.editMessageText(`✅ Using existing certificate.`);
    }
    session.data.collection_step = 'waiting_cert';
    await handleEducationCollection(ctx, client, session, null, null, true);
});

bot.action('upload_new_degree_cert', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📸 Please upload the certificate for your qualification.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const eduIndex = session.data.pending_edu_cert;
    session.data.awaiting_document = { type: 'degree_certificate', field: `education.${eduIndex}.certificate`, description: 'degree/diploma certificate' };
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
});

bot.action('skip_degree_cert', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`⏭️ Skipped certificate upload.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.collection_step = 'waiting_cert';
    await handleEducationCollection(ctx, client, session, null, null, true);
});

// ============ MODIFIED CERTIFICATIONS COLLECTION (with image upload) ============
async function handleCertificationsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const certifications = cvData.certifications;
    if (!session.data.current_cert) session.data.current_cert = {};
    const currentCert = session.data.current_cert;

    if (step === 'name') {
        if (callbackData === 'cert_skip') {
            session.current_section = 'projects';
            session.data.collection_step = 'name';
            cvData.projects = [];
            await sendMarkdown(ctx, `${getReaction()} Let's move to projects.\n\n*Any projects you want to showcase?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Projects", callback_data: "proj_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_projects', 'projects', session.data);
            return;
        }
        currentCert.name = text;
        session.data.collection_step = 'issuer';
        await sendMarkdown(ctx, "🏛️ **Issuing organization?**\n*Example:* TEVETA, Google, Microsoft");
    }
    else if (step === 'issuer') {
        currentCert.issuer = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Date obtained?**\n*Example:* 2022, June 2023");
    }
    else if (step === 'date') {
        currentCert.date = text;
        session.data.collection_step = 'expiry';
        await sendMarkdown(ctx, "⏰ **Expiry date?** (if applicable)\n*Example:* 2025, Never expires\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_expiry" }]] }
        });
    }
    else if (step === 'expiry') {
        if (callbackData !== 'skip_expiry' && text.toLowerCase() !== 'skip') currentCert.expiry = text;
        session.data.collection_step = 'credential_id';
        await sendMarkdown(ctx, "🆔 **Credential ID?** (if any)\n*Example:* 123456789\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_credential_id" }]] }
        });
    }
    else if (step === 'credential_id') {
        if (callbackData !== 'skip_credential_id' && text.toLowerCase() !== 'skip') currentCert.credential_id = text;
        session.data.collection_step = 'url';
        await sendMarkdown(ctx, "🔗 **Certificate URL?** (if available)\n*Example:* https://certification.com/verify/123\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_cert_url" }]] }
        });
    }
    else if (step === 'url') {
        if (callbackData !== 'skip_cert_url' && text.toLowerCase() !== 'skip') currentCert.url = text;
        certifications.push({ ...currentCert });
        session.data.current_cert = null;

        const certIndex = certifications.length - 1;
        session.data.pending_cert_image = certIndex;

        const existingDocs = await db.getClientDocuments(client.id, 'certification_image');
        if (existingDocs.length > 0) {
            await sendMarkdown(ctx, `📜 *We already have a certificate image on file.*\n\nDo you want to use the existing copy or upload a new one for "${currentCert.name}"?`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📄 Use existing", callback_data: "use_existing_cert_image" }],
                        [{ text: "📸 Upload new", callback_data: "upload_new_cert_image" }],
                        [{ text: "⏭️ Skip", callback_data: "skip_cert_image" }]
                    ]
                }
            });
        } else {
            await requestDocumentUpload(ctx, client, 'certification_image', `certificate for ${currentCert.name}`, `certifications.${certIndex}.image`);
        }
        session.data.collection_step = 'waiting_cert_image';
        await db.updateSession(session.id, 'collecting_certifications', 'certifications', session.data);
        return;
    }
    else if (step === 'waiting_cert_image') {
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Certification added!\n\nAnother certification?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "cert_yes" }],
                [{ text: "❌ No", callback_data: "cert_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'cert_yes') {
            session.data.collection_step = 'name';
            session.data.current_cert = {};
            await sendMarkdown(ctx, "Certification name? 📜");
        } else {
            session.current_section = 'projects';
            session.data.collection_step = 'name';
            cvData.projects = [];
            await sendMarkdown(ctx, `${getReaction()} Let's move to projects.\n\n*Any projects you want to showcase?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Projects", callback_data: "proj_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_projects', 'projects', session.data);
        }
        return;
    }

    await db.updateSession(session.id, 'collecting_certifications', 'certifications', session.data);
}

// Certificate image reuse handlers
bot.action('use_existing_cert_image', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const existingDocs = await db.getClientDocuments(client.id, 'certification_image');
    if (existingDocs.length) {
        if (!session.data.uploaded_docs) session.data.uploaded_docs = {};
        session.data.uploaded_docs.certification_image = existingDocs[0].id;
        await ctx.editMessageText(`✅ Using existing certificate image.`);
    }
    session.data.collection_step = 'waiting_cert_image';
    await handleCertificationsCollection(ctx, client, session, null, null);
});

bot.action('upload_new_cert_image', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📸 Please upload the certificate image.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const certIndex = session.data.pending_cert_image;
    session.data.awaiting_document = { type: 'certification_image', field: `certifications.${certIndex}.image`, description: 'certificate image' };
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
});

bot.action('skip_cert_image', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`⏭️ Skipped certificate image.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.collection_step = 'waiting_cert_image';
    await handleCertificationsCollection(ctx, client, session, null, null);
});
// ============ SKILLS COLLECTION ============
async function handleSkillsCollection(ctx, client, session, text) {
    const cvData = ensureCVData(session);
    const skillsArray = text.split(',').map(s => s.trim());
    const categorized = { technical: [], soft: [], tools: [] };
    const techKeywords = ['python', 'javascript', 'java', 'react', 'node', 'sql', 'mongodb', 'aws', 'docker', 'kubernetes', 'html', 'css', 'c++', 'c#', 'php', 'laravel', 'django', 'flask', 'api', 'git', 'linux', 'excel', 'power bi', 'tableau', 'spss', 'matlab', 'autocad', 'solidworks'];
    const softKeywords = ['leadership', 'communication', 'teamwork', 'problem solving', 'critical thinking', 'time management', 'organization', 'adaptability', 'creativity', 'collaboration', 'negotiation', 'conflict resolution', 'decision making', 'project management', 'agile', 'scrum'];
    for (const skill of skillsArray) {
        const lowerSkill = skill.toLowerCase();
        if (techKeywords.some(k => lowerSkill.includes(k))) categorized.technical.push(skill);
        else if (softKeywords.some(k => lowerSkill.includes(k))) categorized.soft.push(skill);
        else categorized.tools.push(skill);
    }
    if (categorized.technical.length === 0 && categorized.soft.length === 0 && categorized.tools.length > 0) {
        categorized.technical = categorized.tools;
        categorized.tools = [];
    }
    cvData.skills = categorized;
    session.current_section = 'certifications';
    session.data.collection_step = 'name';
    cvData.certifications = [];
    await sendMarkdown(ctx, `${getReaction()} ${skillsArray.length} skills saved!\n\n📊 *Skills Categorized:*\n• Technical: ${categorized.technical.length}\n• Soft: ${categorized.soft.length}\n• Tools: ${categorized.tools.length}\n\nAny certifications? (Click SKIP if none)`, {
        reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Certifications", callback_data: "cert_skip" }]] }
    });
    await db.updateSession(session.id, 'collecting_certifications', 'certifications', session.data);
}

// ============ PROJECTS COLLECTION ============
async function handleProjectsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const projects = cvData.projects;
    if (!session.data.proj) session.data.proj = {};
    const currentProj = session.data.proj;

    if (step === 'name') {
        if (callbackData === 'proj_skip') {
            session.current_section = 'achievements';
            session.data.collection_step = 'title';
            cvData.achievements = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add achievements.\n\n*What are your key achievements?* (Type each, then DONE when finished)`);
            await db.updateSession(session.id, 'collecting_achievements', 'achievements', session.data);
            return;
        }
        currentProj.name = text;
        session.data.collection_step = 'description';
        await sendMarkdown(ctx, "📝 **Project description?** (2-3 sentences)\n*Example:* Developed a mobile app that helped 10,000+ users track their fitness goals");
    }
    else if (step === 'description') {
        currentProj.description = text;
        session.data.collection_step = 'technologies';
        await sendMarkdown(ctx, "🔧 **Technologies used?**\n*Example:* React, Node.js, MongoDB, AWS");
    }
    else if (step === 'technologies') {
        currentProj.technologies = text;
        session.data.collection_step = 'role';
        await sendMarkdown(ctx, "👤 **Your role?**\n*Example:* Lead Developer, Project Manager, UI/UX Designer");
    }
    else if (step === 'role') {
        currentProj.role = text;
        session.data.collection_step = 'team_size';
        await sendMarkdown(ctx, "👥 **Team size?** (if applicable)\n*Example:* 5 members\n\nType 'Skip' to continue.", {
            reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_team_size" }]] }
        });
    }
    else if (step === 'team_size') {
        if (callbackData !== 'skip_team_size' && text.toLowerCase() !== 'skip') currentProj.team_size = text;
        session.data.collection_step = 'duration';
        await sendMarkdown(ctx, "📅 **Duration?**\n*Example:* 3 months, Jan 2024 - Mar 2024");
    }
    else if (step === 'duration') {
        currentProj.duration = text;
        session.data.collection_step = 'link';
        await sendMarkdown(ctx, "🔗 **Project link?** (GitHub, live demo, or type 'Skip')\n*Example:* https://github.com/username/project");
    }
    else if (step === 'link') {
        if (text.toLowerCase() !== 'skip') currentProj.link = text;
        session.data.collection_step = 'outcome';
        await sendMarkdown(ctx, "📊 **Project outcome/impact?**\n*Example:* Increased user engagement by 40%, Won hackathon");
    }
    else if (step === 'outcome') {
        currentProj.outcome = text;
        projects.push({ ...currentProj });
        session.data.proj = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Project saved!\n\nAnother project?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "proj_yes" }],
                [{ text: "❌ No", callback_data: "proj_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'proj_yes') {
            session.data.collection_step = 'name';
            session.data.proj = {};
            await sendMarkdown(ctx, "Next project name? 📁");
        } else {
            session.current_section = 'achievements';
            session.data.collection_step = 'title';
            cvData.achievements = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add achievements.\n\n*What are your key achievements?* (Type each, then DONE when finished)`);
            await db.updateSession(session.id, 'collecting_achievements', 'achievements', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_projects', 'projects', session.data);
}

// ============ ACHIEVEMENTS COLLECTION ============
async function handleAchievementsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const achievements = cvData.achievements;
    
    if (step === 'title') {
        if (text.toUpperCase() === 'DONE') {
            if (achievements.length === 0) {
                await sendMarkdown(ctx, `No achievements added. Click SKIP to continue or type your achievement.`);
                return;
            }
            session.current_section = 'volunteer';
            session.data.collection_step = 'role';
            cvData.volunteer = [];
            await sendMarkdown(ctx, `${getReaction()} ${achievements.length} achievement(s) saved!\n\n*Any volunteer experience?*`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Volunteer", callback_data: "vol_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_volunteer', 'volunteer', session.data);
        } else {
            if (!session.data.current_achievement) session.data.current_achievement = {};
            session.data.current_achievement.title = text;
            session.data.collection_step = 'description';
            await sendMarkdown(ctx, "📝 **Achievement description?**\n*Example:* Led a team of 5 to deliver project 2 weeks ahead of schedule");
        }
        return;
    }
    else if (step === 'description') {
        session.data.current_achievement.description = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Date?** (or type 'Skip')\n*Example:* 2023");
    }
    else if (step === 'date') {
        if (text.toLowerCase() !== 'skip') session.data.current_achievement.date = text;
        session.data.collection_step = 'issuer';
        await sendMarkdown(ctx, "🏛️ **Issuer?** (or type 'Skip')\n*Example:* Company Name, Organization");
    }
    else if (step === 'issuer') {
        if (text.toLowerCase() !== 'skip') session.data.current_achievement.issuer = text;
        achievements.push({ ...session.data.current_achievement });
        session.data.current_achievement = {};
        session.data.collection_step = 'title';
        await sendMarkdown(ctx, `✓ Achievement added! Type another achievement or DONE to finish.`);
    }
    
    await db.updateSession(session.id, 'collecting_achievements', 'achievements', session.data);
}

// ============ VOLUNTEER COLLECTION ============
async function handleVolunteerCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const volunteer = cvData.volunteer;
    if (!session.data.vol) session.data.vol = {};
    const currentVol = session.data.vol;
    
    if (step === 'role') {
        if (callbackData === 'vol_skip') {
            session.current_section = 'leadership';
            session.data.collection_step = 'role';
            cvData.leadership = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add leadership roles.\n\n*Any leadership roles?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Leadership", callback_data: "lead_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_leadership', 'leadership', session.data);
            return;
        }
        currentVol.role = text;
        session.data.collection_step = 'organization';
        await sendMarkdown(ctx, "🏢 **Organization name?**\n*Example:* Red Cross, Local School");
    }
    else if (step === 'organization') {
        currentVol.organization = text;
        session.data.collection_step = 'duration';
        await sendMarkdown(ctx, "📅 **Duration?**\n*Example:* Jan 2022 - Present (2 years)");
    }
    else if (step === 'duration') {
        currentVol.duration = text;
        volunteer.push({ ...currentVol });
        session.data.vol = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Volunteer experience saved!\n\nAnother volunteer role?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "vol_yes" }],
                [{ text: "❌ No", callback_data: "vol_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'vol_yes') {
            session.data.collection_step = 'role';
            session.data.vol = {};
            await sendMarkdown(ctx, "Next volunteer role? 🤝");
        } else {
            session.current_section = 'leadership';
            session.data.collection_step = 'role';
            cvData.leadership = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add leadership roles.\n\n*Any leadership roles?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Leadership", callback_data: "lead_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_leadership', 'leadership', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_volunteer', 'volunteer', session.data);
}

// ============ LEADERSHIP COLLECTION ============
async function handleLeadershipCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const leadership = cvData.leadership;
    if (!session.data.lead) session.data.lead = {};
    const currentLead = session.data.lead;
    
    if (step === 'role') {
        if (callbackData === 'lead_skip') {
            session.current_section = 'awards';
            session.data.collection_step = 'name';
            cvData.awards = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add awards and recognition.\n\n*Any awards?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Awards", callback_data: "award_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_awards', 'awards', session.data);
            return;
        }
        currentLead.role = text;
        session.data.collection_step = 'organization';
        await sendMarkdown(ctx, "🏢 **Organization/Team name?**");
    }
    else if (step === 'organization') {
        currentLead.organization = text;
        session.data.collection_step = 'duration';
        await sendMarkdown(ctx, "📅 **Duration?**");
    }
    else if (step === 'duration') {
        currentLead.duration = text;
        session.data.collection_step = 'impact';
        await sendMarkdown(ctx, "💪 **Key impact/achievement?**\n*Example:* Led team to win national competition");
    }
    else if (step === 'impact') {
        currentLead.impact = text;
        leadership.push({ ...currentLead });
        session.data.lead = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Leadership role saved!\n\nAnother leadership role?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "lead_yes" }],
                [{ text: "❌ No", callback_data: "lead_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'lead_yes') {
            session.data.collection_step = 'role';
            session.data.lead = {};
            await sendMarkdown(ctx, "Next leadership role? 👔");
        } else {
            session.current_section = 'awards';
            session.data.collection_step = 'name';
            cvData.awards = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add awards and recognition.\n\n*Any awards?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Awards", callback_data: "award_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_awards', 'awards', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_leadership', 'leadership', session.data);
}

// ============ AWARDS COLLECTION ============
async function handleAwardsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const awards = cvData.awards;
    if (!session.data.award) session.data.award = {};
    const currentAward = session.data.award;
    
    if (step === 'name') {
        if (callbackData === 'award_skip') {
            session.current_section = 'publications';
            session.data.collection_step = 'title';
            cvData.publications = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add publications.\n\n*Any publications?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Publications", callback_data: "pub_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_publications', 'publications', session.data);
            return;
        }
        currentAward.name = text;
        session.data.collection_step = 'issuer';
        await sendMarkdown(ctx, "🏛️ **Issuing organization?**");
    }
    else if (step === 'issuer') {
        currentAward.issuer = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Year received?**");
    }
    else if (step === 'date') {
        currentAward.date = text;
        awards.push({ ...currentAward });
        session.data.award = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Award saved!\n\nAnother award?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "award_yes" }],
                [{ text: "❌ No", callback_data: "award_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'award_yes') {
            session.data.collection_step = 'name';
            session.data.award = {};
            await sendMarkdown(ctx, "Next award name? 🏆");
        } else {
            session.current_section = 'publications';
            session.data.collection_step = 'title';
            cvData.publications = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add publications.\n\n*Any publications?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Publications", callback_data: "pub_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_publications', 'publications', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_awards', 'awards', session.data);
}

// ============ PUBLICATIONS COLLECTION ============
async function handlePublicationsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const publications = cvData.publications;
    if (!session.data.pub) session.data.pub = {};
    const currentPub = session.data.pub;
    
    if (step === 'title') {
        if (callbackData === 'pub_skip') {
            session.current_section = 'conferences';
            session.data.collection_step = 'name';
            cvData.conferences = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add conferences.\n\n*Any conferences attended?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Conferences", callback_data: "conf_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_conferences', 'conferences', session.data);
            return;
        }
        currentPub.title = text;
        session.data.collection_step = 'publisher';
        await sendMarkdown(ctx, "📰 **Publisher/Journal name?**");
    }
    else if (step === 'publisher') {
        currentPub.publisher = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Publication date?**");
    }
    else if (step === 'date') {
        currentPub.date = text;
        publications.push({ ...currentPub });
        session.data.pub = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Publication saved!\n\nAnother publication?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "pub_yes" }],
                [{ text: "❌ No", callback_data: "pub_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'pub_yes') {
            session.data.collection_step = 'title';
            session.data.pub = {};
            await sendMarkdown(ctx, "Next publication title? 📖");
        } else {
            session.current_section = 'conferences';
            session.data.collection_step = 'name';
            cvData.conferences = [];
            await sendMarkdown(ctx, `${getReaction()} Let's add conferences.\n\n*Any conferences attended?* (Click SKIP if none)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Conferences", callback_data: "conf_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_conferences', 'conferences', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_publications', 'publications', session.data);
}

// ============ CONFERENCES COLLECTION ============
async function handleConferencesCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    let step = session.data.collection_step;
    const conferences = cvData.conferences;
    if (!session.data.conf) session.data.conf = {};
    const currentConf = session.data.conf;
    
    if (step === 'name') {
        if (callbackData === 'conf_skip') {
            session.current_section = 'interests';
            session.data.collection_step = 'list';
            cvData.interests = [];
            await sendMarkdown(ctx, `${getReaction()} Finally, let's add your interests/hobbies.\n\n*What are your interests?* (comma separated, or click SKIP)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Interests", callback_data: "int_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_interests', 'interests', session.data);
            return;
        }
        currentConf.name = text;
        session.data.collection_step = 'role';
        await sendMarkdown(ctx, "🎤 **Your role?**\n*Example:* Speaker, Attendee, Panelist, Organizer");
    }
    else if (step === 'role') {
        currentConf.role = text;
        session.data.collection_step = 'date';
        await sendMarkdown(ctx, "📅 **Date?**\n*Example:* June 2024");
    }
    else if (step === 'date') {
        currentConf.date = text;
        conferences.push({ ...currentConf });
        session.data.conf = {};
        session.data.collection_step = 'add_more';
        await sendMarkdown(ctx, `${getReaction()} Conference saved!\n\nAnother conference?`, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Yes", callback_data: "conf_yes" }],
                [{ text: "❌ No", callback_data: "conf_no" }]
            ] }
        });
    }
    else if (step === 'add_more') {
        if (callbackData === 'conf_yes') {
            session.data.collection_step = 'name';
            session.data.conf = {};
            await sendMarkdown(ctx, "Next conference name? 🎙️");
        } else {
            session.current_section = 'interests';
            session.data.collection_step = 'list';
            cvData.interests = [];
            await sendMarkdown(ctx, `${getReaction()} Finally, let's add your interests/hobbies.\n\n*What are your interests?* (comma separated, or click SKIP)`, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip Interests", callback_data: "int_skip" }]] }
            });
            await db.updateSession(session.id, 'collecting_interests', 'interests', session.data);
        }
        return;
    }
    await db.updateSession(session.id, 'collecting_conferences', 'conferences', session.data);
}

// ============ INTERESTS COLLECTION ============
async function handleInterestsCollection(ctx, client, session, text, callbackData = null) {
    const cvData = ensureCVData(session);
    if (callbackData === 'int_skip' || text.toLowerCase() === 'skip') {
        cvData.interests = [];
    } else {
        const interests = text.split(',').map(i => i.trim());
        cvData.interests = interests;
        await sendMarkdown(ctx, `${getReaction()} ${interests.length} interest(s) saved!`);
    }
    await showSummaryAndFinalize(ctx, client, session);
}

// ============ SMART DRAFT PROCESSOR (UPDATED) ============
class SmartDraftProcessor {
    async processDraftUpload(ctx, client, session, fileUrl, fileName) {
        await sendMarkdown(ctx, `📄 *Processing your document with AI...*\n\nDeepSeek AI is extracting all information from your file. This may take a moment. ⏳`);
        const extractedData = await documentGenerator.extractFullCVDataFromUrl(fileUrl, fileName);
        if (!extractedData.success) {
            await sendMarkdown(ctx, `❌ Could not extract data from your file. Please try again with a clearer document or choose manual entry.`);
            return false;
        }
        const cvData = extractedData.data;
        const missingSections = this.identifyAllMissingSections(cvData);
        session.data.cv_data = cvData;
        session.data.is_draft_upload = true;
        session.data.missing_sections = missingSections;
        session.data.current_missing_index = 0;
        
        let foundMessage = `📄 *Draft Processed Successfully!*\n\n`;
        foundMessage += `${SEP}\n`;
        foundMessage += `✅ *EXTRACTED INFORMATION*\n`;
        foundMessage += `${SEP}\n\n`;
        foundMessage += `👤 *Personal Information*\n`;
        foundMessage += `• Name: ${cvData.personal?.full_name || 'Not found'}\n`;
        foundMessage += `• Email: ${cvData.personal?.email || 'Not found'}\n`;
        foundMessage += `• Phone: ${cvData.personal?.primary_phone || 'Not found'}\n`;
        foundMessage += `• Location: ${cvData.personal?.location || 'Not found'}\n`;
        foundMessage += `• LinkedIn: ${cvData.personal?.linkedin || 'Not found'}\n`;
        foundMessage += `• GitHub: ${cvData.personal?.github || 'Not found'}\n`;
        foundMessage += `• Professional Title: ${cvData.personal?.professional_title || 'Not found'}\n\n`;
        foundMessage += `💼 *Work Experience*: ${cvData.employment?.length || 0} position(s)\n`;
        for (const job of (cvData.employment || []).slice(0, 2)) {
            foundMessage += `   • ${job.title} at ${job.company} (${job.duration || 'Duration not specified'})\n`;
        }
        if ((cvData.employment || []).length > 2) foundMessage += `   • +${cvData.employment.length - 2} more\n`;
        foundMessage += `\n`;
        foundMessage += `🎓 *Education*: ${cvData.education?.length || 0} qualification(s)\n`;
        for (const edu of (cvData.education || []).slice(0, 2)) {
            foundMessage += `   • ${edu.level} in ${edu.field || 'Field not specified'} from ${edu.institution || 'Institution not specified'}\n`;
        }
        foundMessage += `\n`;
        const skills = cvData.skills || {};
        const totalSkills = (skills.technical?.length || 0) + (skills.soft?.length || 0) + (skills.tools?.length || 0);
        foundMessage += `⚡ *Skills*: ${totalSkills} total\n`;
        if (skills.technical?.length > 0) foundMessage += `   • Technical: ${skills.technical.slice(0, 5).join(', ')}${skills.technical.length > 5 ? '...' : ''}\n`;
        if (skills.soft?.length > 0) foundMessage += `   • Soft: ${skills.soft.slice(0, 5).join(', ')}${skills.soft.length > 5 ? '...' : ''}\n`;
        if (skills.tools?.length > 0) foundMessage += `   • Tools: ${skills.tools.slice(0, 5).join(', ')}${skills.tools.length > 5 ? '...' : ''}\n`;
        foundMessage += `\n`;
        foundMessage += `📜 *Certifications*: ${cvData.certifications?.length || 0}\n`;
        for (const cert of (cvData.certifications || []).slice(0, 2)) {
            foundMessage += `   • ${cert.name}${cert.issuer ? ` (${cert.issuer})` : ''}\n`;
        }
        foundMessage += `\n`;
        foundMessage += `🌍 *Languages*: ${cvData.languages?.length || 0}\n`;
        for (const lang of (cvData.languages || []).slice(0, 3)) {
            foundMessage += `   • ${lang.name} (${lang.proficiency || 'Not specified'})\n`;
        }
        foundMessage += `\n`;
        foundMessage += `📁 *Projects*: ${cvData.projects?.length || 0}\n`;
        for (const proj of (cvData.projects || []).slice(0, 2)) {
            foundMessage += `   • ${proj.name}${proj.role ? ` (${proj.role})` : ''}\n`;
        }
        foundMessage += `\n`;
        foundMessage += `🏆 *Achievements*: ${cvData.achievements?.length || 0}\n`;
        foundMessage += `\n`;
        foundMessage += `🤝 *Volunteer*: ${cvData.volunteer?.length || 0}\n`;
        foundMessage += `\n`;
        foundMessage += `👔 *Leadership*: ${cvData.leadership?.length || 0}\n`;
        foundMessage += `\n`;
        foundMessage += `🏅 *Awards*: ${cvData.awards?.length || 0}\n`;
        foundMessage += `\n`;
        foundMessage += `📖 *Publications*: ${cvData.publications?.length || 0}\n`;
        foundMessage += `\n`;
        foundMessage += `🎤 *Conferences*: ${cvData.conferences?.length || 0}\n`;
        foundMessage += `\n`;
        foundMessage += `👥 *Referees*: ${cvData.referees?.length || 0} (need at least 2)\n`;
        foundMessage += `\n`;
        if (cvData.interests?.length > 0) {
            foundMessage += `💡 *Interests*: ${cvData.interests.slice(0, 5).join(', ')}${cvData.interests.length > 5 ? '...' : ''}\n\n`;
        }
        if (missingSections.length > 0) {
            foundMessage += `${SEP}\n`;
            foundMessage += `⚠️ *MISSING INFORMATION*\n`;
            foundMessage += `${SEP}\n`;
            for (const missing of missingSections) foundMessage += `• ${missing}\n`;
            foundMessage += `\nLet's fill in the missing information.`;
            await sendMarkdown(ctx, foundMessage);
            await this.collectNextMissingSection(ctx, client, session);
        } else {
            foundMessage += `${SEP}\n`;
            foundMessage += `🎉 *COMPLETE!* Your draft has everything needed!\n`;
            foundMessage += `${SEP}\n\n`;
            foundMessage += `Proceed to payment? Click below to continue.`;
            await sendMarkdown(ctx, foundMessage, {
                reply_markup: { inline_keyboard: [[{ text: "💰 Proceed to Payment", callback_data: "proceed_payment" }]] }
            });
            session.data.cv_complete = true;
        }
        return true;
    }
    
    identifyAllMissingSections(cvData) {
        const missing = [];
        if (!cvData.personal?.full_name) missing.push('Full Name');
        if (!cvData.personal?.email) missing.push('Email');
        if (!cvData.personal?.primary_phone) missing.push('Phone');
        if (!cvData.personal?.location) missing.push('Location');
        if (!cvData.personal?.physical_address) missing.push('Physical Address (Optional)');
        if (!cvData.personal?.nationality) missing.push('Nationality (Optional)');
        if (!cvData.personal?.linkedin) missing.push('LinkedIn (Optional)');
        if (!cvData.personal?.github) missing.push('GitHub (Optional)');
        if (!cvData.employment || cvData.employment.length === 0) missing.push('Work Experience');
        if (!cvData.education || cvData.education.length === 0) missing.push('Education');
        const totalSkills = (cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0);
        if (totalSkills === 0 && (!cvData.skills || cvData.skills.length === 0)) missing.push('Skills');
        if (!cvData.certifications || cvData.certifications.length === 0) missing.push('Certifications (Optional)');
        if (!cvData.languages || cvData.languages.length === 0) missing.push('Languages (Optional)');
        if (!cvData.projects || cvData.projects.length === 0) missing.push('Projects (Optional)');
        if (!cvData.achievements || cvData.achievements.length === 0) missing.push('Achievements (Optional)');
        if (!cvData.volunteer || cvData.volunteer.length === 0) missing.push('Volunteer Experience (Optional)');
        if (!cvData.leadership || cvData.leadership.length === 0) missing.push('Leadership Roles (Optional)');
        if (!cvData.awards || cvData.awards.length === 0) missing.push('Awards (Optional)');
        if (!cvData.publications || cvData.publications.length === 0) missing.push('Publications (Optional)');
        if (!cvData.conferences || cvData.conferences.length === 0) missing.push('Conferences (Optional)');
        if (!cvData.referees || cvData.referees.length < 2) {
            const needed = 2 - (cvData.referees?.length || 0);
            missing.push(`Referees (need ${needed} more, minimum 2 required)`);
        }
        if (!cvData.interests || cvData.interests.length === 0) missing.push('Interests (Optional)');
        return missing;
    }
    
    async collectNextMissingSection(ctx, client, session) {
        const missing = session.data.missing_sections;
        const index = session.data.current_missing_index || 0;
        if (index >= missing.length) {
            await sendMarkdown(ctx, `✅ *All information collected!*\n\nProceed to payment? Click below to continue.`, {
                reply_markup: { inline_keyboard: [[{ text: "💰 Proceed to Payment", callback_data: "proceed_payment" }]] }
            });
            session.data.cv_complete = true;
            await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
            return;
        }
        const section = missing[index];
        session.data.current_section = section;
        const prompts = {
            'Full Name': "What's your full name? 📛\n*Example:* John Mwale Doe",
            'Email': "What's your email address? 📧\n*Example:* john.doe@example.com",
            'Phone': "What's your phone number? 📞\n*Example:* +265 991 234 567 or 0991234567",
            'Location': "Where are you based? (City, Country) 📍\n*Example:* Lilongwe, Malawi",
            'Physical Address (Optional)': "🏠 *Physical address?* (Optional)\n*Example:* House No. 123, Area 47, Lilongwe\n\nClick SKIP to continue.",
            'Nationality (Optional)': "🌍 *Nationality?* (Optional)\n*Example:* Malawian\n\nClick SKIP to continue.",
            'LinkedIn (Optional)': "🔗 *LinkedIn URL?* (Optional)\n*Example:* https://linkedin.com/in/yourname\n\nClick SKIP to continue.",
            'GitHub (Optional)': "💻 *GitHub URL?* (Optional)\n*Example:* https://github.com/yourusername\n\nClick SKIP to continue.",
            'Work Experience': "Let's add your work experience. Most recent job title? 💼\n*Example:* Senior Software Engineer",
            'Education': "What's your highest qualification? 🎓\n*Example:* Bachelor of Science in Computer Science",
            'Skills': "List your key skills (comma separated) ⚡\n*Example:* Project Management, Python, Leadership, Data Analysis",
            'Certifications (Optional)': "📜 *Any certifications?* (Optional)\n*Example:* Google Project Management Professional\n\nClick SKIP to continue.",
            'Languages (Optional)': "🌍 *What languages do you speak?* (Optional)\n*Example:* English (Fluent), Chichewa (Native)\n\nClick SKIP to continue.",
            'Projects (Optional)': "📁 *Any projects you want to showcase?* (Optional)\n*Example:* E-commerce Website, Mobile App Development\n\nClick SKIP to continue.",
            'Achievements (Optional)': "🏆 *What are your key achievements?* (Optional)\n*Example:* Increased sales by 40%, Won Best Employee Award\n\nClick SKIP to continue.",
            'Volunteer Experience (Optional)': "🤝 *Any volunteer experience?* (Optional)\n*Example:* Community Tutor, Red Cross Volunteer\n\nClick SKIP to continue.",
            'Leadership Roles (Optional)': "👔 *Any leadership roles?* (Optional)\n*Example:* Team Lead, Club President\n\nClick SKIP to continue.",
            'Awards (Optional)': "🏅 *Any awards or recognition?* (Optional)\n*Example:* Employee of the Month, Best Innovation Award\n\nClick SKIP to continue.",
            'Publications (Optional)': "📖 *Any publications?* (Optional)\n*Example:* Research paper in Journal of Science\n\nClick SKIP to continue.",
            'Conferences (Optional)': "🎤 *Any conferences attended?* (Optional)\n*Example:* Tech Summit 2024 (Speaker)\n\nClick SKIP to continue.",
            'Interests (Optional)': "💡 *What are your interests/hobbies?* (Optional)\n*Example:* Reading, Chess, Photography\n\nClick SKIP to continue.",
            'Referees (need 2 more, minimum 2 required)': "Please provide professional referees (minimum 2 required).\n\n*Referee 1 - Full name?* 👥\n*Example:* Dr. Jane Mkandawire"
        };
        if (section.includes('Referees')) {
            const needed = section.match(/\d+/);
            if (needed) await sendMarkdown(ctx, `👥 *Professional Referees*\n\nPlease provide at least 2 professional referees.\n\n*Referee 1 - Full name?*`);
            else await sendMarkdown(ctx, prompts[section] || `Please provide your ${section.toLowerCase()}:`);
        } else if (section.includes('(Optional)')) {
            const basePrompt = prompts[section] || `Please provide your ${section.replace(' (Optional)', '')}:`;
            await sendMarkdown(ctx, basePrompt, {
                reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: `skip_optional_${section.replace(/ /g, '_')}` }]] }
            });
        } else {
            await sendMarkdown(ctx, prompts[section] || `Please provide your ${section.toLowerCase()}:`);
        }
        await db.updateSession(session.id, 'collecting_missing', 'missing', session.data);
    }
    
    async handleMissingCollection(ctx, client, session, text, callbackData = null) {
        const section = session.data.current_section;
        const cvData = session.data.cv_data;
        if (callbackData && callbackData.startsWith('skip_optional_')) {
            session.data.current_missing_index = (session.data.current_missing_index || 0) + 1;
            await this.collectNextMissingSection(ctx, client, session);
            await db.updateSession(session.id, 'collecting_missing', 'missing', session.data);
            return;
        }
        switch(section) {
            case 'Full Name': cvData.personal.full_name = text; break;
            case 'Email': cvData.personal.email = text; break;
            case 'Phone': cvData.personal.primary_phone = text; break;
            case 'Location': cvData.personal.location = text; break;
            case 'Physical Address (Optional)': if (text.toLowerCase() !== 'skip') cvData.personal.physical_address = text; break;
            case 'Nationality (Optional)': if (text.toLowerCase() !== 'skip') cvData.personal.nationality = text; break;
            case 'LinkedIn (Optional)': if (text.toLowerCase() !== 'skip') cvData.personal.linkedin = text; break;
            case 'GitHub (Optional)': if (text.toLowerCase() !== 'skip') cvData.personal.github = text; break;
            case 'Work Experience':
                if (!cvData.employment) cvData.employment = [];
                if (!session.data.temp_job) session.data.temp_job = {};
                const step = session.data.work_step || 'title';
                if (step === 'title') {
                    session.data.temp_job.title = text;
                    session.data.work_step = 'company';
                    await sendMarkdown(ctx, "Company name? 🏢");
                    return;
                } else if (step === 'company') {
                    session.data.temp_job.company = text;
                    session.data.work_step = 'duration';
                    await sendMarkdown(ctx, "Duration? 📅\n*Example:* Jan 2020 - Present (3 years)");
                    return;
                } else if (step === 'duration') {
                    session.data.temp_job.duration = text;
                    session.data.work_step = 'responsibilities';
                    session.data.temp_job.responsibilities = [];
                    await sendMarkdown(ctx, "Responsibilities (one per line, click DONE when finished)", {
                        reply_markup: { inline_keyboard: [[{ text: "✅ DONE", callback_data: "missing_done" }]] }
                    });
                    return;
                } else if (step === 'responsibilities') {
                    if (callbackData !== 'missing_done' && text.toUpperCase() !== 'DONE') {
                        session.data.temp_job.responsibilities.push(text);
                        await sendMarkdown(ctx, `✓ Added. Another responsibility? (click DONE when finished)`);
                        return;
                    } else {
                        cvData.employment.push(session.data.temp_job);
                        session.data.temp_job = null;
                        session.data.work_step = null;
                        await sendMarkdown(ctx, `✓ Work experience added. Another job?`, {
                            reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "more_work_yes" }, { text: "❌ No", callback_data: "more_work_no" }]] }
                        });
                        return;
                    }
                }
                break;
    
            case 'Skills':
                const skillsArray = text.split(',').map(s => s.trim());
                const categorized = { technical: [], soft: [], tools: [] };
                const techKeywords = ['python', 'javascript', 'java', 'react', 'node', 'sql', 'aws', 'docker'];
                const softKeywords = ['leadership', 'communication', 'teamwork', 'problem solving', 'management'];
                for (const skill of skillsArray) {
                    const lowerSkill = skill.toLowerCase();
                    if (techKeywords.some(k => lowerSkill.includes(k))) categorized.technical.push(skill);
                    else if (softKeywords.some(k => lowerSkill.includes(k))) categorized.soft.push(skill);
                    else categorized.tools.push(skill);
                }
                if (categorized.technical.length === 0 && categorized.tools.length > 0) {
                    categorized.technical = categorized.tools;
                    categorized.tools = [];
                }
                cvData.skills = categorized;
                break;
            case 'Certifications (Optional)':
                if (!cvData.certifications) cvData.certifications = [];
                cvData.certifications.push({ name: text, issuer: 'Not specified', date: new Date().getFullYear().toString() });
                await sendMarkdown(ctx, `✓ Certification added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "cert_done" }, { text: "⏭️ Skip", callback_data: "cert_skip_section" }]] }
                });
                return;
            case 'Languages (Optional)':
                if (!cvData.languages) cvData.languages = [];
                const langParts = text.split('(');
                const langName = langParts[0].trim();
                let proficiency = 'Professional';
                if (langParts[1]) proficiency = langParts[1].replace(')', '').trim();
                cvData.languages.push({ name: langName, proficiency: proficiency });
                await sendMarkdown(ctx, `✓ Language added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "lang_done" }, { text: "⏭️ Skip", callback_data: "lang_skip_section" }]] }
                });
                return;
            case 'Projects (Optional)':
                if (!cvData.projects) cvData.projects = [];
                cvData.projects.push({ name: text, description: 'Added', technologies: 'Not specified' });
                await sendMarkdown(ctx, `✓ Project added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "proj_done" }, { text: "⏭️ Skip", callback_data: "proj_skip_section" }]] }
                });
                return;
            case 'Achievements (Optional)':
                if (!cvData.achievements) cvData.achievements = [];
                cvData.achievements.push(text);
                await sendMarkdown(ctx, `✓ Achievement added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "ach_done" }, { text: "⏭️ Skip", callback_data: "ach_skip_section" }]] }
                });
                return;
            case 'Volunteer Experience (Optional)':
                if (!cvData.volunteer) cvData.volunteer = [];
                cvData.volunteer.push({ role: text, organization: 'Not specified', duration: 'Not specified' });
                await sendMarkdown(ctx, `✓ Volunteer experience added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "vol_done" }, { text: "⏭️ Skip", callback_data: "vol_skip_section" }]] }
                });
                return;
            case 'Leadership Roles (Optional)':
                if (!cvData.leadership) cvData.leadership = [];
                cvData.leadership.push({ role: text, organization: 'Not specified', duration: 'Not specified' });
                await sendMarkdown(ctx, `✓ Leadership role added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "lead_done" }, { text: "⏭️ Skip", callback_data: "lead_skip_section" }]] }
                });
                return;
            case 'Awards (Optional)':
                if (!cvData.awards) cvData.awards = [];
                cvData.awards.push({ name: text, issuer: 'Not specified', date: 'Not specified' });
                await sendMarkdown(ctx, `✓ Award added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "award_done" }, { text: "⏭️ Skip", callback_data: "award_skip_section" }]] }
                });
                return;
            case 'Publications (Optional)':
                if (!cvData.publications) cvData.publications = [];
                cvData.publications.push({ title: text, publisher: 'Not specified', date: 'Not specified' });
                await sendMarkdown(ctx, `✓ Publication added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "pub_done" }, { text: "⏭️ Skip", callback_data: "pub_skip_section" }]] }
                });
                return;
            case 'Conferences (Optional)':
                if (!cvData.conferences) cvData.conferences = [];
                cvData.conferences.push({ name: text, role: 'Attendee', date: 'Not specified' });
                await sendMarkdown(ctx, `✓ Conference added. Add another? (Type 'Done' to finish, 'Skip' to skip)`, {
                    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "conf_done" }, { text: "⏭️ Skip", callback_data: "conf_skip_section" }]] }
                });
                return;
            case 'Interests (Optional)':
                if (text.toLowerCase() !== 'skip') {
                    const interests = text.split(',').map(i => i.trim());
                    cvData.interests = interests;
                }
                break;
            case 'Referees (need 2 more, minimum 2 required)':
                if (!cvData.referees) cvData.referees = [];
                if (!session.data.temp_ref) session.data.temp_ref = {};
                const refStep = session.data.ref_step || 'name';
                if (refStep === 'name') {
                    session.data.temp_ref.name = text;
                    session.data.ref_step = 'position';
                    await sendMarkdown(ctx, "Their position? 📌\n*Example:* Senior Manager, HR Director");
                    return;
                } else if (refStep === 'position') {
                    session.data.temp_ref.position = text;
                    session.data.ref_step = 'company';
                    await sendMarkdown(ctx, "Company name? 🏢");
                    return;
                } else if (refStep === 'company') {
                    session.data.temp_ref.company = text;
                    session.data.ref_step = 'contact';
                    await sendMarkdown(ctx, "Their contact? (phone or email) 📞\n*Example:* +265 991 234 567 or jane@example.com");
                    return;
                } else if (refStep === 'contact') {
                    session.data.temp_ref.contact = text;
                    cvData.referees.push(session.data.temp_ref);
                    session.data.temp_ref = null;
                    session.data.ref_step = null;
                    const needed = 2 - cvData.referees.length;
                    if (needed > 0) {
                        await sendMarkdown(ctx, `✓ Referee added. Need ${needed} more.\n\nNext referee - Full name? 👥`);
                        return;
                    } else {
                        await sendMarkdown(ctx, `✓ ${cvData.referees.length} referees added. Another referee?`, {
                            reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "more_ref_yes" }, { text: "❌ No", callback_data: "more_ref_no" }]] }
                        });
                        return;
                    }
                }
                break;
        }
        session.data.current_missing_index = (session.data.current_missing_index || 0) + 1;
        await this.collectNextMissingSection(ctx, client, session);
        await db.updateSession(session.id, 'collecting_missing', 'missing', session.data);
    }
}

const smartDraft = new SmartDraftProcessor();

// ============ MISSING ACTION HANDLERS – COMPREHENSIVE FIX ============

// 1. Build method (upload draft vs manual)
bot.action('build_draft', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleBuildMethod(ctx, client, session, 'build_draft');
});
bot.action('build_manual', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleBuildMethod(ctx, client, session, 'build_manual');
});

// 2. Upload draft confirmation
bot.action('upload_draft_confirm', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleUploadDraftConfirm(ctx, client, session);
});

// 3. Delivery speed selection
bot.action(/delivery_(standard|express|rush)/, async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleDeliverySelection(ctx, client, session, ctx.match[0]);
});

// 4. Cover letter vacancy choice
bot.action('cover_has_vacancy', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleCoverVacancyChoice(ctx, client, session, 'cover_has_vacancy');
});
bot.action('cover_no_vacancy', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleCoverVacancyChoice(ctx, client, session, 'cover_no_vacancy');
});

// 5. Cover letter availability
bot.action(/cover_availability_(immediate|2weeks|1month|specific)/, async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    await handleCoverAvailabilityChoice(ctx, client, session, ctx.match[0]);
});

// 6. Cover letter continue/add info
bot.action('cover_continue', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    await handleCoverContinue(ctx, client, session, 'cover_continue');
});
bot.action('cover_add_info', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    await handleCoverContinue(ctx, client, session, 'cover_add_info');
});

// 7. Skip document upload (generic)
bot.action(/skip_doc_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    if (session?.data?.awaiting_document) {
        delete session.data.awaiting_document;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    }
    await resumeDocumentCollection(ctx, client, session);
});

// 8. Skip optional fields (smart draft)
bot.action(/skip_optional_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await smartDraft.handleMissingCollection(ctx, client, session, null, ctx.match[0]);
});

// 9. Education handlers
bot.action('edu_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleEducationCollection(ctx, client, session, null, 'edu_skip');
});
bot.action('edu_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleEducationCollection(ctx, client, session, null, 'edu_yes');
});
bot.action('edu_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleEducationCollection(ctx, client, session, null, 'edu_no');
});
bot.action('use_existing_degree_cert', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    // This is already handled in your code, but ensure it exists
    // We'll just trigger the existing handler
    const existingDocs = await db.getClientDocuments(client.id, 'degree_certificate');
    if (existingDocs.length) {
        if (!session.data.uploaded_docs) session.data.uploaded_docs = {};
        session.data.uploaded_docs.degree_certificate = existingDocs[0].id;
        await ctx.editMessageText(`✅ Using existing certificate.`);
    }
    session.data.collection_step = 'waiting_cert';
    await handleEducationCollection(ctx, client, session, null, null, true);
});
bot.action('upload_new_degree_cert', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📸 Please upload the certificate for your qualification.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const eduIndex = session.data.pending_edu_cert;
    session.data.awaiting_document = { type: 'degree_certificate', field: `education.${eduIndex}.certificate`, description: 'degree/diploma certificate' };
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
});
bot.action('skip_degree_cert', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`⏭️ Skipped certificate upload.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.collection_step = 'waiting_cert';
    await handleEducationCollection(ctx, client, session, null, null, true);
});

// 10. Certification handlers (similar pattern – add if missing)
bot.action('cert_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleCertificationsCollection(ctx, client, session, null, 'cert_skip');
});
bot.action('cert_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleCertificationsCollection(ctx, client, session, null, 'cert_yes');
});
bot.action('cert_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleCertificationsCollection(ctx, client, session, null, 'cert_no');
});
// (Add similar for skip_expiry, skip_credential_id, skip_cert_url, use_existing_cert_image, upload_new_cert_image, skip_cert_image – but many are already in your code; verify they exist)

// 11. Projects handlers
bot.action('proj_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleProjectsCollection(ctx, client, session, null, 'proj_skip');
});
bot.action('proj_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleProjectsCollection(ctx, client, session, null, 'proj_yes');
});
bot.action('proj_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleProjectsCollection(ctx, client, session, null, 'proj_no');
});
bot.action('skip_team_size', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleProjectsCollection(ctx, client, session, null, 'skip_team_size');
});

// 12. Volunteer handlers
bot.action('vol_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleVolunteerCollection(ctx, client, session, null, 'vol_skip');
});
bot.action('vol_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleVolunteerCollection(ctx, client, session, null, 'vol_yes');
});
bot.action('vol_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleVolunteerCollection(ctx, client, session, null, 'vol_no');
});

// 13. Leadership handlers
bot.action('lead_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleLeadershipCollection(ctx, client, session, null, 'lead_skip');
});
bot.action('lead_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleLeadershipCollection(ctx, client, session, null, 'lead_yes');
});
bot.action('lead_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleLeadershipCollection(ctx, client, session, null, 'lead_no');
});

// 14. Awards handlers
bot.action('award_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleAwardsCollection(ctx, client, session, null, 'award_skip');
});
bot.action('award_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleAwardsCollection(ctx, client, session, null, 'award_yes');
});
bot.action('award_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleAwardsCollection(ctx, client, session, null, 'award_no');
});

// 15. Publications handlers
bot.action('pub_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePublicationsCollection(ctx, client, session, null, 'pub_skip');
});
bot.action('pub_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePublicationsCollection(ctx, client, session, null, 'pub_yes');
});
bot.action('pub_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePublicationsCollection(ctx, client, session, null, 'pub_no');
});

// 16. Conferences handlers
bot.action('conf_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleConferencesCollection(ctx, client, session, null, 'conf_skip');
});
bot.action('conf_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleConferencesCollection(ctx, client, session, null, 'conf_yes');
});
bot.action('conf_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleConferencesCollection(ctx, client, session, null, 'conf_no');
});

// 17. Interests handlers
bot.action('int_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleInterestsCollection(ctx, client, session, null, 'int_skip');
});

// 18. Portfolio skip
bot.action('portfolio_skip', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePortfolioCollection(ctx, client, session, 'skip');
});

// 19. Proceed to payment
bot.action('proceed_payment', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    // Show payment options (you may need to implement showPaymentOptions if not already)
    const totalCharge = session.data.total_charge || formatPrice(calculateTotal(session.data.category, session.data.service, session.data.delivery_option));
    const paymentReference = generatePaymentReference();
    await showPaymentOptions(ctx, session.data.order_id || 'PENDING', totalCharge, paymentReference);
});

// 20. Add cover letter (yes/no)
bot.action('add_cover_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    session.data.include_cover = true;
    session.data.cover_service = session.data.service === 'editable cv' ? 'editable cover letter' : 'cover letter';
    await sendMarkdown(ctx, `✅ Cover letter will be included.\n\nNow, would you like to include your supporting documents (certificates, ID, etc.) as an appendix?`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ Yes, include attachments", callback_data: "include_attachments_yes" }],
                [{ text: "❌ No, just CV and cover letter", callback_data: "include_attachments_no" }]
            ]
        }
    });
    session.data.pending_attachments_choice = true;
    await db.updateSession(session.id, 'selecting_attachments_addon', null, session.data);
});
bot.action('add_cover_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    session.data.include_cover = false;
    session.data.include_attachments = false;
    await proceedWithCVOnly(ctx, client, session);
});

// 21. Include attachments (yes/no)
bot.action('include_attachments_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    await bot.action(/include_attachments_(yes|no)/, async (ctx2) => {}) // forward
    // Actually call the existing handler logic
    const existingDocs = await db.getClientDocuments(client.id);
    if (existingDocs.length > 0) {
        let msg = `📎 *We have the following documents on file:*\n\n`;
        for (const doc of existingDocs) {
            msg += `• ${getDocumentTypeLabel(doc.document_type)}: ${doc.original_filename}\n`;
        }
        msg += `\nDo you want to use these, upload new ones, or skip?`;
        await sendMarkdown(ctx, msg, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📄 Use existing", callback_data: "use_existing_attachments" }],
                    [{ text: "📸 Upload new", callback_data: "upload_new_attachments" }],
                    [{ text: "⏭️ Skip attachments", callback_data: "skip_attachments" }]
                ]
            }
        });
        session.data.pending_attachment_choice = true;
    } else {
        await sendMarkdown(ctx, `📎 *You have no documents on file.*\n\nPlease upload your supporting documents (certificates, ID, etc.) one by one.\n\nClick 'Start' to begin or 'Skip' to continue without attachments.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📸 Start Upload", callback_data: "start_attachment_upload" }],
                    [{ text: "⏭️ Skip", callback_data: "skip_attachments" }]
                ]
            }
        });
        session.data.pending_attachment_choice = true;
    }
    await db.updateSession(session.id, 'selecting_attachments', null, session.data);
});
bot.action('include_attachments_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    session.data.include_attachments = false;
    await proceedWithCVOnly(ctx, client, session);
});

// 22. Attachment existing/upload/skip
bot.action('use_existing_attachments', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const existingDocs = await db.getClientDocuments(client.id);
    session.data.attachments_list = existingDocs.map(doc => ({
        type: doc.document_type,
        id: doc.id,
        label: getDocumentTypeLabel(doc.document_type)
    }));
    session.data.include_attachments = true;
    delete session.data.pending_attachment_choice;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    await ctx.editMessageText(`✅ Using ${session.data.attachments_list.length} existing document(s).`);
    await proceedWithCVOnly(ctx, client, session);
});
bot.action('upload_new_attachments', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    delete session.data.pending_attachment_choice;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    await ctx.editMessageText(`📸 Let's upload your documents.`);
    await showAttachmentTypeMenu(ctx, client, session);
});
bot.action('skip_attachments', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.include_attachments = false;
    delete session.data.pending_attachment_choice;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    await ctx.editMessageText(`⏭️ Skipped attachments. Proceeding with your order.`);
    await proceedWithCVOnly(ctx, client, session);
});

// 23. Start attachment upload
bot.action('start_attachment_upload', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await ctx.editMessageText(`📸 Let's upload your documents.`);
    await showAttachmentTypeMenu(ctx, client, session);
});

// 24. Personal info skip handlers
bot.action('skip_alt_phone', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'Skip');
});
bot.action('whatsapp_same', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'Same');
});
bot.action('whatsapp_type', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'whatsapp_type');
});
bot.action('skip_professional_title', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'skip');
});
bot.action('skip_linkedin', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'skip');
});
bot.action('skip_github', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'skip');
});
bot.action('skip_physical_address', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'skip');
});
bot.action('skip_nationality', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'skip');
});
bot.action('skip_dob', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'skip');
});
bot.action('skip_special_docs', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'skip_special_docs');
});
bot.action('done_special_docs', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handlePersonalCollection(ctx, client, session, 'done_special_docs');
});
bot.action('use_existing_national_id', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const existingDocs = await db.getClientDocuments(client.id, 'national_id');
    if (existingDocs.length) {
        if (!session.data.uploaded_docs) session.data.uploaded_docs = {};
        session.data.uploaded_docs.national_id = existingDocs[0].id;
        await ctx.editMessageText(`✅ Using existing National ID document.`);
    }
    session.data.collection_step = 'after_id';
    await handlePersonalCollection(ctx, client, session, null, true);
});
bot.action('upload_new_national_id', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📸 Please upload a clear photo of your National ID or Driver's Licence.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.awaiting_document = { type: 'national_id', field: 'personal.id', description: 'National ID or Driver\'s Licence' };
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
});
bot.action('skip_national_id', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`⏭️ Skipped. You can upload it later.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.collection_step = 'after_id';
    await handlePersonalCollection(ctx, client, session, null, true);
});

// 25. Missing handlers for smart draft (more_work_yes, more_work_no, etc.)
bot.action('more_work_yes', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    // Re-enter work experience collection
    if (!session.data.cv_data) session.data.cv_data = {};
    if (!session.data.cv_data.employment) session.data.cv_data.employment = [];
    session.data.work_step = 'title';
    await sendMarkdown(ctx, "Next job title? 💼");
    await db.updateSession(session.id, 'collecting_missing', 'missing', session.data);
});
bot.action('more_work_no', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.current_missing_index = (session.data.current_missing_index || 0) + 1;
    await smartDraft.collectNextMissingSection(ctx, client, session);
});
bot.action('missing_done', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    // Finish current step (responsibilities)
    if (session.data.temp_job) {
        session.data.cv_data.employment.push(session.data.temp_job);
        session.data.temp_job = null;
        session.data.work_step = null;
        await sendMarkdown(ctx, `✓ Work experience added. Another job?`, {
            reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: "more_work_yes" }, { text: "❌ No", callback_data: "more_work_no" }]] }
        });
    } else {
        // Fallback: move to next missing section
        session.data.current_missing_index = (session.data.current_missing_index || 0) + 1;
        await smartDraft.collectNextMissingSection(ctx, client, session);
    }
});
// Add similar for cert_done, lang_done, proj_done, ach_done, vol_done, lead_done, award_done, pub_done, conf_done, more_ref_yes, more_ref_no
// (You can copy the pattern from your existing handlers – many are already defined in your code but may be missing due to incomplete copy. Verify they exist.)

// 26. Cancel update
bot.action('cancel_update', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.awaiting_update_request = false;
    session.data.pending_update = false;
    await db.updateSession(session.id, 'main_menu', null, session.data);
    await ctx.editMessageText(`❌ Update cancelled. Type /start to return to main menu.`);
});

// 27. Approve/modify update
bot.action('approve_update', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleApproveUpdate(ctx, client, session);
});
bot.action('modify_update', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await sendMarkdown(ctx, `Please type your modified request:`);
    session.data.awaiting_update_request = true;
    await db.updateSession(session.id, 'awaiting_update_request', 'update', session.data);
});

// 28. Payment method selection (generic pattern)
bot.action(/pay_(mobile|bank|later|installment)_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const method = ctx.match[1];
    const orderId = ctx.match[2];
    const client = await getOrCreateClient(ctx);
    const order = await db.getOrder(orderId);
    if (!order) return ctx.reply('❌ Order not found.');
    if (method === 'mobile') {
        // Show mobile payment details
        const reference = order.payment_reference;
        const total = order.total_charge;
        const airtel = process.env.PAYMENT_AIRTEL || '0991295401';
        const mpamba = process.env.PAYMENT_TNM || '0886928639';
        const msg = RESPONSES.payment.mobile_payment(reference, total, airtel, mpamba);
        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "✅ I Have Paid", callback_data: `confirm_${reference}` }]] } });
    } else if (method === 'bank') {
        const reference = order.payment_reference;
        const total = order.total_charge;
        const bankAccount = process.env.PAYMENT_MO626 || '1005653618';
        const msg = RESPONSES.payment.bank_payment(reference, total, bankAccount);
        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "✅ I Have Paid", callback_data: `confirm_${reference}` }]] } });
    } else if (method === 'later') {
        // Implement pay later
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);
        const msg = RESPONSES.payment.pay_later_created(orderId, order.total_charge, order.payment_reference, dueDate.toLocaleDateString());
        await ctx.reply(msg, { parse_mode: 'Markdown' });
        await db.updateOrderPaymentType(orderId, 'pay_later', { due_date: dueDate, status: 'pending' });
    } else if (method === 'installment') {
        // Implement installment
        const totalAmount = parseInt(order.total_charge.replace('MK', '').replace(',', ''));
        const firstAmount = Math.floor(totalAmount * 0.5);
        const secondAmount = totalAmount - firstAmount;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);
        const msg = RESPONSES.payment.installment_created(orderId, order.total_charge, firstAmount, secondAmount, order.payment_reference, dueDate.toLocaleDateString());
        await ctx.reply(msg, { parse_mode: 'Markdown' });
        await db.updateOrderPaymentType(orderId, 'installment', { first_amount: firstAmount, second_amount: secondAmount, due_date: dueDate, status: 'first_pending' });
    }
});

// 29. Confirm payment (generic)
bot.action(/confirm_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const reference = ctx.match[1];
    await handlePaymentConfirmation(ctx, reference);
});

// 30. Feedback rating
bot.action(/feedback_(.+)_(\d)/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const rating = parseInt(ctx.match[2]);
    const client = await getOrCreateClient(ctx);
    await db.saveTestimonial({
        client_id: client.id,
        name: client.first_name,
        rating: rating,
        text: `Rating: ${rating}/5`,
        approved: false
    });
    await ctx.editMessageText(`⭐ Thank you for rating ${rating}/5! Your feedback helps us improve.`);
    await ctx.reply(`Would you like to leave a written testimonial? (Type your message or click Skip)`, {
        reply_markup: { inline_keyboard: [[{ text: "⏭️ Skip", callback_data: "skip_testimonial" }]] }
    });
    const session = await db.getActiveSession(client.id);
    if (session) {
        session.data.awaiting_testimonial_text = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
    } else {
        await db.saveSession(client.id, 'awaiting_testimonial_text', null, { awaiting_testimonial_text: true }, 0);
    }
});
bot.action('skip_testimonial', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`Thank you! You can always leave feedback later with /feedback.`);
});

// 31. Vacancy library actions
bot.action(/vacancy_match_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const vacancyId = ctx.match[1];
    const vacancy = await db.getVacancyById(vacancyId);
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    session.data.vacancy_data = vacancy;
    session.data.using_library_vacancy = true;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    await ctx.editMessageText(`✅ Using existing details for *${vacancy.position}* at *${vacancy.company}*.\n\nI'll tailor your documents perfectly for this role!`, { parse_mode: 'Markdown' });
    await askCoverLetterQuestions(ctx, client, session);
});
bot.action(/vacancy_more_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const position = ctx.match[1];
    // Show more matches or just continue
    await ctx.editMessageText(`Please type the full job description or position name.`);
});
bot.action('vacancy_new', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📝 Please enter the position you're applying for:`);
});
bot.action(/vacancy_use_(.+)/, async (ctx) => {
    // Already handled above but keep for compatibility
    await ctx.answerCbQuery();
    const vacancyId = ctx.match[1];
    // Similar logic as vacancy_match
});


// ============ CV VERSIONING SYSTEM (UPDATED) ============
class CVVersioning {
    async saveVersion(orderId, cvData, versionNumber, changes, metadata = {}) {
        const completeCVData = this.ensureCompleteCVData(cvData);
        const versionData = { ...completeCVData, _metadata: { version: versionNumber, created_at: new Date().toISOString(), changes: changes, ...metadata } };
        await db.saveCVVersion(orderId, versionNumber, versionData, changes);
        console.log(`📁 Version ${versionNumber} saved for order ${orderId} - Changes: ${changes}`);
        return true;
    }
    
    ensureCompleteCVData(cvData) {
        return {
            personal: {
                full_name: cvData.personal?.full_name || '',
                email: cvData.personal?.email || '',
                primary_phone: cvData.personal?.primary_phone || '',
                alternative_phone: cvData.personal?.alternative_phone || '',
                whatsapp_phone: cvData.personal?.whatsapp_phone || '',
                location: cvData.personal?.location || '',
                physical_address: cvData.personal?.physical_address || '',
                nationality: cvData.personal?.nationality || '',
                linkedin: cvData.personal?.linkedin || '',
                github: cvData.personal?.github || '',
                portfolio: cvData.personal?.portfolio || '',
                professional_title: cvData.personal?.professional_title || '',
                date_of_birth: cvData.personal?.date_of_birth || '',
                special_documents: cvData.personal?.special_documents || []
            },
            professional_summary: cvData.professional_summary || '',
            employment: (cvData.employment || []).map(job => ({
                title: job.title || '', company: job.company || '', location: job.location || '',
                start_date: job.start_date || '', end_date: job.end_date || '', duration: job.duration || '',
                responsibilities: job.responsibilities || [], achievements: job.achievements || [],
                technologies_used: job.technologies_used || [], team_size: job.team_size || null, reporting_to: job.reporting_to || null
            })),
            education: (cvData.education || []).map(edu => ({
                level: edu.level || '', field: edu.field || '', institution: edu.institution || '',
                location: edu.location || '', start_date: edu.start_date || '', graduation_date: edu.graduation_date || '',
                gpa: edu.gpa || '', achievements: edu.achievements || [], courses: edu.courses || []
            })),
            skills: {
                technical: cvData.skills?.technical || [],
                soft: cvData.skills?.soft || [],
                tools: cvData.skills?.tools || [],
                certifications: cvData.skills?.certifications || []
            },
            certifications: (cvData.certifications || []).map(cert => ({
                name: cert.name || '', issuer: cert.issuer || '', date: cert.date || '',
                expiry_date: cert.expiry_date || '', credential_id: cert.credential_id || '', url: cert.url || ''
            })),
            languages: (cvData.languages || []).map(lang => ({
                name: lang.name || '', proficiency: lang.proficiency || '', certification: lang.certification || ''
            })),
            projects: (cvData.projects || []).map(proj => ({
                name: proj.name || '', description: proj.description || '', technologies: proj.technologies || '',
                role: proj.role || '', team_size: proj.team_size || '', duration: proj.duration || '',
                link: proj.link || '', outcome: proj.outcome || ''
            })),
            achievements: (cvData.achievements || []).map(ach => ({
                title: typeof ach === 'string' ? ach : ach.title, description: ach.description || '',
                date: ach.date || '', issuer: ach.issuer || ''
            })),
            volunteer: (cvData.volunteer || []).map(vol => ({
                role: vol.role || '', organization: vol.organization || '', duration: vol.duration || '', responsibilities: vol.responsibilities || []
            })),
            leadership: (cvData.leadership || []).map(lead => ({
                role: lead.role || '', organization: lead.organization || '', duration: lead.duration || '', impact: lead.impact || ''
            })),
            awards: (cvData.awards || []).map(award => ({
                name: award.name || '', issuer: award.issuer || '', date: award.date || '', description: award.description || ''
            })),
            publications: (cvData.publications || []).map(pub => ({
                title: pub.title || '', publisher: pub.publisher || '', date: pub.date || '', url: pub.url || '', authors: pub.authors || ''
            })),
            conferences: (cvData.conferences || []).map(conf => ({
                name: conf.name || '', role: conf.role || '', date: conf.date || '', location: conf.location || ''
            })),
            referees: (cvData.referees || []).map(ref => ({
                name: ref.name || '', position: ref.position || '', company: ref.company || '',
                email: ref.email || '', phone: ref.phone || '', relationship: ref.relationship || ''
            })),
            interests: cvData.interests || [],
            social_media: {
                linkedin: cvData.social_media?.linkedin || '', github: cvData.social_media?.github || '',
                twitter: cvData.social_media?.twitter || '', facebook: cvData.social_media?.facebook || '',
                instagram: cvData.social_media?.instagram || '', portfolio: cvData.social_media?.portfolio || ''
            },
            portfolio: cvData.portfolio || []
        };
    }
    
    async getVersions(orderId) {
        const versions = await db.getCVVersions(orderId);
        return versions.map(v => ({ ...v, version_number: v.version_number, created_at: v.created_at, changes: v.changes, is_current: v.is_current === 1, summary: this.getVersionSummary(v.cv_data) }));
    }
    
    getVersionSummary(cvData) {
        if (!cvData) return null;
        return {
            personal_complete: !!(cvData.personal?.full_name && cvData.personal?.email),
            employment_count: cvData.employment?.length || 0,
            education_count: cvData.education?.length || 0,
            skills_count: (cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0),
            certifications_count: cvData.certifications?.length || 0,
            languages_count: cvData.languages?.length || 0,
            projects_count: cvData.projects?.length || 0,
            achievements_count: cvData.achievements?.length || 0,
            volunteer_count: cvData.volunteer?.length || 0,
            leadership_count: cvData.leadership?.length || 0,
            awards_count: cvData.awards?.length || 0,
            publications_count: cvData.publications?.length || 0,
            conferences_count: cvData.conferences?.length || 0,
            referees_count: cvData.referees?.length || 0,
            interests_count: cvData.interests?.length || 0
        };
    }
    
    async getVersion(orderId, versionNumber) {
        const version = await db.getCVVersion(orderId, versionNumber);
        if (version) version.cv_data = this.ensureCompleteCVData(version.cv_data);
        return version;
    }
    
    async revertToVersion(orderId, versionNumber) {
        const version = await this.getVersion(orderId, versionNumber);
        if (version && version.cv_data) {
            const completeData = this.ensureCompleteCVData(version.cv_data);
            await db.updateOrderCVData(orderId, completeData);
            const nextVersion = versionNumber + 1;
            await this.saveVersion(orderId, completeData, nextVersion, `Reverted to version ${versionNumber}`);
            return completeData;
        }
        return null;
    }
    
    async compareVersions(orderId, version1, version2) {
        const v1 = await this.getVersion(orderId, version1);
        const v2 = await this.getVersion(orderId, version2);
        if (!v1 || !v2) return null;
        const differences = [];
        if (v1.cv_data.employment?.length !== v2.cv_data.employment?.length) differences.push(`Employment entries: ${v1.cv_data.employment?.length} → ${v2.cv_data.employment?.length}`);
        const v1Skills = (v1.cv_data.skills?.technical?.length || 0) + (v1.cv_data.skills?.soft?.length || 0);
        const v2Skills = (v2.cv_data.skills?.technical?.length || 0) + (v2.cv_data.skills?.soft?.length || 0);
        if (v1Skills !== v2Skills) differences.push(`Skills count: ${v1Skills} → ${v2Skills}`);
        if (v1.cv_data.projects?.length !== v2.cv_data.projects?.length) differences.push(`Projects: ${v1.cv_data.projects?.length} → ${v2.cv_data.projects?.length}`);
        return differences;
    }
    
    formatVersionHistory(versions, currentVersion = null) {
        if (!versions || versions.length === 0) return "📭 *No version history available.*\n\nYour CV versions will appear here as you make updates.";
        let message = "📁 *YOUR CV VERSION HISTORY*\n\n";
        message += `${SEP}\n`;
        for (const v of versions) {
            const currentMarker = v.is_current ? " ✅ CURRENT" : "";
            const date = new Date(v.created_at).toLocaleDateString();
            const time = new Date(v.created_at).toLocaleTimeString();
            message += `🔹 *Version ${v.version_number}*${currentMarker}\n`;
            message += `   📅 ${date} at ${time}\n`;
            message += `   📝 ${v.changes || 'Update'}\n`;
            const summary = this.getVersionSummary(v.cv_data);
            if (summary) message += `   📊 ${summary.employment_count} jobs · ${summary.education_count} edu · ${summary.skills_count} skills\n`;
            message += `\n`;
        }
        message += `${SEP}\n`;
        message += `💡 *Commands:*\n`;
        message += `• /version DETAILS - View full version details\n`;
        message += `• /compare V1 V2 - Compare two versions\n`;
        message += `• /revert VERSION_NUMBER - Restore a previous version\n`;
        return message;
    }
    
    formatVersionDetails(version) {
        if (!version) return "❌ Version not found.";
        const cv = version.cv_data;
        const summary = this.getVersionSummary(cv);
        let message = `📄 *VERSION ${version.version_number} DETAILS*\n\n`;
        message += `${SEP}\n`;
        message += `📅 Created: ${new Date(version.created_at).toLocaleString()}\n`;
        message += `📝 Changes: ${version.changes || 'Initial version'}\n`;
        message += `${SEP}\n\n`;
        const personal = cv.personal || {};
        message += `👤 *Personal Information*\n`;
        message += `• Name: ${personal.full_name || 'Not set'}\n`;
        message += `• Email: ${personal.email || 'Not set'}\n`;
        message += `• Phone: ${personal.primary_phone || 'Not set'}\n`;
        message += `• Location: ${personal.location || 'Not set'}\n`;
        if (personal.linkedin) message += `• LinkedIn: ${personal.linkedin}\n`;
        if (personal.github) message += `• GitHub: ${personal.github}\n`;
        message += `\n`;
        if (cv.professional_summary) message += `📝 *Professional Summary*\n${cv.professional_summary}\n\n`;
        message += `💼 *Work Experience* (${summary.employment_count})\n`;
        for (const job of (cv.employment || []).slice(0, 3)) {
            message += `• ${job.title} at ${job.company}\n`;
            if (job.duration) message += `  📅 ${job.duration}\n`;
            if (job.achievements?.length) message += `  ✓ ${job.achievements[0].substring(0, 60)}${job.achievements[0].length > 60 ? '...' : ''}\n`;
        }
        if (summary.employment_count > 3) message += `  + ${summary.employment_count - 3} more\n`;
        message += `\n`;
        message += `🎓 *Education* (${summary.education_count})\n`;
        for (const edu of (cv.education || []).slice(0, 2)) {
            message += `• ${edu.level} in ${edu.field}\n`;
            if (edu.institution) message += `  🏛️ ${edu.institution}\n`;
        }
        message += `\n`;
        message += `⚡ *Skills* (${summary.skills_count})\n`;
        if (cv.skills?.technical?.length) message += `• Technical: ${cv.skills.technical.slice(0, 8).join(', ')}${cv.skills.technical.length > 8 ? '...' : ''}\n`;
        if (cv.skills?.soft?.length) message += `• Soft: ${cv.skills.soft.slice(0, 5).join(', ')}${cv.skills.soft.length > 5 ? '...' : ''}\n`;
        message += `\n`;
        const otherSections = [];
        if (summary.certifications_count) otherSections.push(`📜 ${summary.certifications_count} certifications`);
        if (summary.languages_count) otherSections.push(`🌍 ${summary.languages_count} languages`);
        if (summary.projects_count) otherSections.push(`📁 ${summary.projects_count} projects`);
        if (summary.achievements_count) otherSections.push(`🏆 ${summary.achievements_count} achievements`);
        if (summary.volunteer_count) otherSections.push(`🤝 ${summary.volunteer_count} volunteer`);
        if (summary.leadership_count) otherSections.push(`👔 ${summary.leadership_count} leadership`);
        if (summary.referees_count) otherSections.push(`👥 ${summary.referees_count} referees`);
        if (otherSections.length > 0) {
            message += `📊 *Additional Sections*\n`;
            message += `• ${otherSections.join(' · ')}\n\n`;
        }
        message += `${SEP}\n`;
        message += `To restore this version, type: /revert ${version.version_number}`;
        return message;
    }
}
const cvVersioning = new CVVersioning();

// ============ HANDLE BUILD METHOD ============
async function handleBuildMethod(ctx, client, session, data) {
    if (data === 'build_draft') {
        session.data.build_method = 'draft';
        await sendMarkdown(ctx, `📎 *Upload Your Draft*

Send me your existing CV or cover letter (PDF, DOCX, or image).

✨ *What I'll extract using AI:*
${SEP}
📋 Personal Information (name, email, phone, location, LinkedIn, GitHub)
💼 Work Experience (titles, companies, dates, responsibilities, achievements)
🎓 Education (degrees, fields, institutions, graduation years)
⚡ Skills (technical, soft, tools - automatically categorized)
📜 Certifications (names, issuers, dates)
🌍 Languages (names, proficiency levels)
📁 Projects (names, descriptions, technologies, roles)
🏆 Achievements
🤝 Volunteer Experience
👔 Leadership Roles
🏅 Awards
📖 Publications
🎤 Conferences
👥 Referees
💡 Interests
${SEP}

*Supported formats:* PDF, DOCX, JPG, PNG

I'll extract everything and only ask for what's missing!

Click below for manual entry if you prefer.`, {
            reply_markup: { inline_keyboard: [
                [{ text: "📎 Upload Draft", callback_data: "upload_draft_confirm" }],
                [{ text: "✍️ Enter Manually", callback_data: "build_manual" }]
            ] }
        });
        session.data.awaiting_draft_upload = true;
        await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
        
    } else if (data === 'build_manual') {
        session.data.build_method = 'manual';
        const basePrice = getBasePrice(session.data.category, session.data.service);
        session.data.base_price = basePrice;
        await sendMarkdown(ctx, `✍️ *Manual Entry Selected*

Base price: ${formatPrice(basePrice)}

*What you'll provide:*
${SEP}
1️⃣ Personal Information (name, contact, location)
2️⃣ Work Experience (jobs, responsibilities, achievements)
3️⃣ Education (qualifications, institutions)
4️⃣ Skills (technical, soft, tools)
5️⃣ Certifications (optional)
6️⃣ Languages (optional)
7️⃣ Projects (optional)
8️⃣ Achievements (optional)
9️⃣ Referees (minimum 2)
${SEP}

*Select delivery speed:*`, {
            reply_markup: { inline_keyboard: [
                [{ text: "🚚 Standard (6 hours)", callback_data: "delivery_standard" }],
                [{ text: "⚡ Express (2 hours) +MK3,000", callback_data: "delivery_express" }],
                [{ text: "🏃 Rush (1 hour) +MK5,000", callback_data: "delivery_rush" }]
            ] }
        });
        await db.updateSession(session.id, 'selecting_delivery', null, session.data);
    }
}
// ============ CALCULATE TOTAL PRICE ============
function calculateTotal(category, service, delivery) {
    const basePrice = getBasePrice(category, service);
    const deliveryFee = DELIVERY_PRICES[delivery] || 0;
    return basePrice + deliveryFee;
}
// ============ DELIVERY SELECTION (UPDATED) ============
async function handleDeliverySelection(ctx, client, session, data) {
    const delivery = { delivery_standard: 'standard', delivery_express: 'express', delivery_rush: 'rush' }[data];
    session.data.delivery_option = delivery;
    session.data.delivery_time = DELIVERY_TIMES[delivery];
      // Safety check
    if (!session.data.category || !session.data.service) {
        await sendMarkdown(ctx, `❌ Missing category or service. Please start over with /start.`);
        return;
    }
    
    const totalAmount = calculateTotal(session.data.category, session.data.service, delivery);
    session.data.total_charge = formatPrice(totalAmount);

    await sendMarkdown(ctx, `✅ *Delivery Selected: ${DELIVERY_TIMES[delivery]}*

💰 Total Amount: *${session.data.total_charge}*
   (Base: ${formatPrice(getBasePrice(session.data.category, session.data.service))} + Delivery: ${DELIVERY_PRICES[delivery] > 0 ? `+MK${DELIVERY_PRICES[delivery]}` : 'Free'})

Now, let's collect your information to create your professional document.

${SEP}
📋 *What's Next*
${SEP}

I'll guide you through collecting:
• Personal Information
• Work Experience
• Education
• Skills
• And more...

Let's begin! 🚀`);
    
     if (session.data.build_method === 'manual') {
        await portfolioCollector.askForPortfolio(ctx);
        await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
    } else if (session.data.build_method === 'draft_completed') {
        if (session.data.cv_data && Object.keys(session.data.cv_data).length > 0) {
            const cvData = session.data.cv_data;
            const hasExtractedData = cvData.personal?.full_name || cvData.employment?.length || cvData.education?.length;
            if (hasExtractedData) {
                await sendMarkdown(ctx, `📄 *Draft data loaded!*\n\nI've already extracted information from your draft. Let me check what's missing and we'll fill in the gaps.`);
                await smartDraft.collectNextMissingSection(ctx, client, session);
            } else {
                await portfolioCollector.askForPortfolio(ctx);
                await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
            }
        } else {
            await portfolioCollector.askForPortfolio(ctx);
            await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
        }
    } else {
        await portfolioCollector.askForPortfolio(ctx);
        await db.updateSession(session.id, 'collecting_portfolio', 'portfolio', session.data);
    }
}


// ============ UPLOAD DRAFT CONFIRMATION ============
async function handleUploadDraftConfirm(ctx, client, session) {
    await sendMarkdown(ctx, `📎 *Ready to Upload*

Please send me your CV or cover letter file.

*Supported formats:*
📄 PDF, DOCX, DOC, TXT
🖼️ JPG, PNG, GIF, BMP, WEBP

*Maximum file size:* 20MB

*What happens next:*
1️⃣ I'll send your file to DeepSeek AI for extraction
2️⃣ All 18+ categories will be analyzed
3️⃣ You'll see a summary of what was found
4️⃣ I'll ask for any missing information

Send your file now... 📎`);
    session.data.awaiting_draft_upload = true;
    await db.updateSession(session.id, 'awaiting_draft_upload', 'draft', session.data);
}

async function checkVacancyAndSuggest(ctx, position, client) {
    const matches = await vacancyLibrary.findSimilarVacancies(position);
    if (matches.length > 0) {
        const message = vacancyLibrary.formatVacancyMatches(matches);
        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `✅ Yes - ${matches[0].company}`, callback_data: `vacancy_use_${matches[0].id}` }],
                    [{ text: "📋 Show more", callback_data: `vacancy_more_${position}` }],
                    [{ text: "📝 No, different position", callback_data: "vacancy_new" }]
                ]
            }
        });
        return true;
    }
    return false;
}

bot.action(/vacancy_use_(.+)/, async (ctx) => {
    const vacancyId = ctx.match[1];
    const vacancy = await db.getVacancyById(vacancyId);
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    session.data.vacancy_data = vacancy;
    session.data.using_library_vacancy = true;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    await ctx.answerCbQuery();
    await ctx.editMessageText(`✅ Using existing details for *${vacancy.position}* at *${vacancy.company}*.\n\nI'll tailor your documents perfectly for this role!`, { parse_mode: 'Markdown' });
    await askCoverLetterQuestions(ctx, client, session);
});

bot.action('vacancy_new', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📝 Please enter the position you're applying for:`);
});

// ============ MAIN MENU HANDLER ============
async function handleMainMenu(ctx, client, session, text) {
    const serviceMap = {
        '📄 New CV': 'service_new',
        '📝 Editable CV': 'service_editable',
        '💌 Cover Letter': 'service_cover',
        '📎 Editable Cover Letter': 'service_editable_cover',
        '✏️ Update CV': 'service_update',
        '📎 Upload Draft': 'build_draft'
    };
    
    if (serviceMap[text]) {
        if (text === '📎 Upload Draft') {
            if (!session.data.category) {
                await sendMarkdown(ctx, `Please select your category first:`, {
                     reply_markup: { inline_keyboard: [
                        [{ text: "🎓 Student - Still studying", callback_data: "cat_student" }],
                        [{ text: "📜 Recent Graduate < a year", callback_data: "cat_recent" }],
                        [{ text: "💼 Professional - currently working", callback_data: "cat_professional" }],
                        [{ text: "🌱 Non-Working - Career break", callback_data: "cat_nonworking" }],
                        [{ text: "🔄 Returning Client - Used us before", callback_data: "cat_returning" }]
                    ] }
                });
                return;
            }
            await handleBuildMethod(ctx, client, session, 'build_draft');
        } else {
            await handleServiceSelection(ctx, client, session, serviceMap[text]);
        }
        return;
    }
    
     if (text === 'ℹ️ About') {
        await sendMarkdown(ctx, `📄 *EasySuccor - Professional CVs*\n\nContact: +265 991 295 401\nWhatsApp: +265 881 193 707\n\n*Services:*\n• New CV - MK6,000 - MK10,000\n• Editable CV - MK8,000 - MK12,000\n• Cover Letter - MK5,000 - MK6,000\n• Editable Cover Letter - MK8,000\n• CV Update - MK3,000 - MK6,000\n\n*Delivery:* 6h (Standard), 2h (+3k), 1h (+5k)`);
        return;
    } else if (text === '📞 Contact') {
        await sendMarkdown(ctx, `📞 *Contact*\n\nAirtel: 0991295401\nTNM: +265 881 193 707\nWhatsApp: +265 881 193 707`);
        return;
    } else if (text === '🏠 Portal') {
        await showClientPortal(ctx, client);
        return;
    } else {
        await sendMarkdown(ctx, `Please select a category to get started:`, {
            reply_markup: { inline_keyboard: [
                [{ text: "🎓 Student", callback_data: "cat_student" }],
                [{ text: "📜 Recent Graduate", callback_data: "cat_recent" }],
                [{ text: "💼 Professional", callback_data: "cat_professional" }],
                [{ text: "🌱 Non-Working", callback_data: "cat_nonworking" }],
                [{ text: "🔄 Returning Client", callback_data: "cat_returning" }]
            ] }
        });
    }
}
// ============ HANDLE VACANCY TEXT ============
async function handleVacancyText(ctx, client, session, text) {
    ensureCoverLetterData(session);
    try {
        const vacancyData = aiAnalyzer.extractVacancyDetails(text);
        session.data.vacancy_data = vacancyData;
        session.data.awaiting_vacancy = false;
        let extractedMessage = `📊 *Vacancy Details Extracted*\n\n${SEP}\n📌 *Position:* ${vacancyData.position || 'Not detected'}\n🏢 *Company:* ${vacancyData.company || 'Not detected'}\n📍 *Location:* ${vacancyData.location || 'Not detected'}\n⏰ *Deadline:* ${vacancyData.deadline || 'Not specified'}\n📋 *Job Type:* ${vacancyData.job_type || 'Not specified'}\n${SEP}\n*Requirements:*\n${(vacancyData.requirements || []).slice(0, 3).map(r => `• ${r}`).join('\n') || '• Not specified'}\n\n*Position applying for?* (or type 'SAME')`;
        await sendMarkdown(ctx, extractedMessage);
        await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
    } catch (error) {
        console.error('Vacancy extraction error:', error);
        await sendMarkdown(ctx, `⚠️ Could not extract vacancy details. Please type the position you're applying for.`);
        session.data.awaiting_vacancy = false;
        await db.updateSession(session.id, 'collecting_coverletter_position', 'coverletter', session.data);
    }
}

// ============ ADDITIONAL MESSAGE TEMPLATES ============
const ADDITIONAL_TEMPLATES = {
    error_report: {
        received: (name, reference) => `🐛 *Error Report Received*\n\n${SEP}\nDear ${name},\n\nThank you for helping us improve EasySuccor! Your error report has been logged.\n\n*Reference:* \`${reference}\`\n\nWe'll investigate and notify you when resolved.\n\n${SEP}\n🤝 The EasySuccor Team`,
        resolved: (name, reference) => `✅ *Error Report Resolved*\n\n${SEP}\nDear ${name},\n\nGreat news! The issue you reported has been fixed.\n\n*Reference:* \`${reference}\`\n\nThank you for your patience!\n\n${SEP}\n🤝 The EasySuccor Team`
    },
    followup: {
        after_7_days: (name) => `👋 *Checking In*\n\n${SEP}\nDear ${name},\n\nIt's been a week since you received your CV. How's the job search going?\n\nIf you've landed an interview or got hired, we'd love to celebrate! Use /hired to share your success.\n\n${SEP}\n🤝 The EasySuccor Team`,
        after_30_days: (name) => `🌟 *Still Here for You*\n\n${SEP}\nDear ${name},\n\nIt's been a month since we created your CV. We're always here if you need:\n• CV Updates\n• Cover Letters\n• Referral rewards (/referral)\n\nWishing you continued success!\n\n${SEP}\n🤝 The EasySuccor Team`
    },
    whatsapp: {
        document_ready: (name, orderId) => `Hello ${name}, your document (Order: ${orderId}) is ready! Please check your Telegram chat to download it. - EasySuccor`,
        payment_reminder: (name, amount, reference) => `Hello ${name}, friendly reminder about your pending payment of ${amount} for EasySuccor. Reference: ${reference}. Thank you!`,
        order_update: (name, status) => `Hello ${name}, your EasySuccor order status is now: ${status}. Check Telegram for details.`
    }
};

function getWhatsAppLink(phone, type, variables) {
    const template = ADDITIONAL_TEMPLATES.whatsapp?.[type];
    if (!template) return null;
    let message = template;
    for (const [key, value] of Object.entries(variables)) message = message.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    return `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message)}`;
}

// ============ PROCESS VACANCY FILE ============
async function processVacancyFile(ctx, client, session, fileUrl, fileName) {
    await sendMarkdown(ctx, `📄 Processing your vacancy details with AI...`);
    const vacancyData = await aiAnalyzer.extractVacancyFromFile(fileUrl, fileName);
    session.data.vacancy_data = vacancyData;
    session.data.awaiting_vacancy = false;
    let message = `📊 *Vacancy Details Extracted*\n\n${SEP}\n📌 *Position:* ${vacancyData.position || 'Not detected'}\n🏢 *Company:* ${vacancyData.company || 'Not detected'}\n📍 *Location:* ${vacancyData.location || 'Not detected'}\n⏰ *Deadline:* ${vacancyData.deadline || 'Not specified'}\n💰 *Salary:* ${vacancyData.salary || 'Not specified'}\n📋 *Job Type:* ${vacancyData.job_type || 'Not specified'}\n🎓 *Experience Required:* ${vacancyData.experience_required || 'Not specified'}\n🎓 *Education Required:* ${vacancyData.education_required || 'Not specified'}\n${SEP}\n*Key Requirements:*\n${(vacancyData.requirements || []).slice(0, 5).map(r => `• ${r}`).join('\n') || '• No specific requirements listed'}\n\n*Responsibilities:*\n${(vacancyData.responsibilities || []).slice(0, 3).map(r => `• ${r}`).join('\n') || '• No specific responsibilities listed'}\n\n*Benefits:*\n${(vacancyData.benefits || []).slice(0, 3).map(b => `• ${b}`).join('\n') || '• Not specified'}\n\n${SEP}\n*Contact:* ${vacancyData.contact_email || vacancyData.contact_phone || 'Not specified'}\n\nDo you want to add any additional information?`;
    await sendMarkdown(ctx, message, {
        reply_markup: { inline_keyboard: [
            [{ text: "✅ Yes, add more info", callback_data: "cover_add_info" }],
            [{ text: "📝 No, continue", callback_data: "cover_continue" }]
        ] }
    });
    session.data.cover_has_vacancy = true;
    await db.updateSession(session.id, 'cover_review_vacancy', 'cover', session.data);
}

// ============ HANDLE COVER CONTINUE ============
async function handleCoverContinue(ctx, client, session, data) {
    if (data === 'cover_add_info') {
        await askCoverLetterQuestions(ctx, client, session);
    } else {
        const coverData = session.data.cover_data || {};
        const vacancyData = session.data.vacancy_data || {};
        const summary = `📝 *Cover Letter Summary*\n\n${SEP}\n📋 *Your Details*\n${SEP}\nPosition: ${coverData.position || vacancyData.position || 'Not specified'}\nCompany: ${coverData.company || vacancyData.company || 'Not specified'}\nExperience: ${coverData.experience_highlight || 'Provided'}\nSkills: ${(coverData.skills || []).join(', ') || 'Provided'}\nAchievement: ${coverData.achievement || 'Provided'}\nMotivation: ${coverData.motivation || 'Provided'}\nAvailability: ${coverData.availability || 'Not specified'}\n\n${SEP}\n✅ Type *CONFIRM* to proceed or *EDIT* to make changes.`;
        await sendMarkdown(ctx, summary);
        session.data.awaiting_cover_confirmation = true;
        await db.updateSession(session.id, 'awaiting_cover_confirmation', 'cover', session.data);
    }
}
// ============ NEW USER CATEGORY HANDLERS ============
bot.action('category_student', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleCategorySelection(ctx, client, session, 'cat_student');
});
bot.action('category_professional', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleCategorySelection(ctx, client, session, 'cat_professional');
});
bot.action('category_nonworking', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleCategorySelection(ctx, client, session, 'cat_nonworking');
});
bot.action('category_returning', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleCategorySelection(ctx, client, session, 'cat_returning');
});

// ============ CERTIFICATION OPTIONAL HANDLERS ============
bot.action('skip_expiry', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    // Call handleCertificationsCollection with 'skip_expiry' as callbackData
    await handleCertificationsCollection(ctx, client, session, null, 'skip_expiry');
});
bot.action('skip_credential_id', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleCertificationsCollection(ctx, client, session, null, 'skip_credential_id');
});
bot.action('skip_cert_url', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    await handleCertificationsCollection(ctx, client, session, null, 'skip_cert_url');
});
bot.action('use_existing_cert_image', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const existingDocs = await db.getClientDocuments(client.id, 'certification_image');
    if (existingDocs.length) {
        if (!session.data.uploaded_docs) session.data.uploaded_docs = {};
        session.data.uploaded_docs.certification_image = existingDocs[0].id;
        await ctx.editMessageText(`✅ Using existing certificate image.`);
    }
    session.data.collection_step = 'waiting_cert_image';
    await handleCertificationsCollection(ctx, client, session, null, null);
});
bot.action('upload_new_cert_image', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📸 Please upload the certificate image.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    const certIndex = session.data.pending_cert_image;
    session.data.awaiting_document = { type: 'certification_image', field: `certifications.${certIndex}.image`, description: 'certificate image' };
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
});
bot.action('skip_cert_image', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`⏭️ Skipped certificate image.`);
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    session.data.collection_step = 'waiting_cert_image';
    await handleCertificationsCollection(ctx, client, session, null, null);
});

// ============ INTELLIGENT UPDATE HANDLERS ============
async function handleIntelligentUpdate(ctx, client, session) {
    const orders = await db.getClientOrders(client.id);
    const latestCV = orders.find(o => o.service === 'new cv' || o.service === 'editable cv');
    if (!latestCV || !latestCV.cv_data) {
        await sendMarkdown(ctx, `❌ I couldn't find your existing CV. Please create a CV first using /start.`);
        return;
    }
    session.data.existing_cv = latestCV.cv_data;
    session.data.update_mode = 'intelligent';
    await sendMarkdown(ctx, `✏️ *Intelligent CV Update*

I see you have an existing CV. Tell me what changes you want in plain English.

*What you can update:*
${SEP}
📋 Personal Information
💼 Work Experience
🎓 Education
⚡ Skills
📜 Certifications
🌍 Languages
📁 Projects
🏆 Achievements
🤝 Volunteer Experience
👔 Leadership Roles
🏅 Awards
📖 Publications
🎤 Conferences
👥 Referees
${SEP}

*Examples:*
• "Add 5 years as Project Manager at ABC Corp"
• "Remove my high school education"
• "Update my phone number to 0999123456"
• "Add a certification in Digital Marketing"
• "Add a project: E-commerce Website using React"

You can also upload vacancy details, and I'll tailor your CV accordingly.

*Type your request or upload a file:*`);
    session.data.awaiting_update_request = true;
    await db.updateSession(session.id, 'awaiting_update_request', 'update', session.data);
}

async function handleUpdateRequest(ctx, client, session, text, fileUrl = null, fileType = null) {
    try {
        let vacancyData = null;
        let userRequest = text;
        if (fileUrl) {
            await sendMarkdown(ctx, `📄 Processing your file...`);
            if (fileType === 'document' || fileType === 'photo') {
                const extractedVacancy = await aiAnalyzer.extractVacancyFromFile(fileUrl, 'uploaded_file');
                if (extractedVacancy && extractedVacancy.has_vacancy) {
                    vacancyData = extractedVacancy;
                    userRequest = `Update my CV for ${vacancyData.position} at ${vacancyData.company}`;
                    await sendMarkdown(ctx, `📊 *Vacancy Detected:*\n${SEP}\n📌 Position: ${vacancyData.position}\n🏢 Company: ${vacancyData.company}\n📋 Requirements: ${(vacancyData.requirements || []).slice(0, 3).join(', ')}\n\nI'll tailor your CV for this role.`);
                }
            }
        }
        const result = await intelligentUpdate.processUpdate(session.data.existing_cv, userRequest, vacancyData);
        if (!result.success) {
            await sendMarkdown(ctx, `❌ I couldn't understand your request. Please be more specific.

*Examples:*
• "Add 3 years as Marketing Manager at XYZ Ltd"
• "Remove my diploma in Business"
• "Update my email to new@email.com"

Click Cancel to go back.`, {
                reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cancel_update" }]] }
            });
            return;
        }
        let changeSummary = `📝 *Proposed Changes:*\n\n`;
        for (const change of result.changes_summary) changeSummary += `• ${change}\n`;
        if (vacancyData) changeSummary += `\n🎯 *Tailored for:* ${vacancyData.position} at ${vacancyData.company}\n`;
        changeSummary += `\nDo you approve these changes?`;
        session.data.proposed_cv = result.updated_cv;
        session.data.pending_update = true;
        await sendMarkdown(ctx, changeSummary, {
            reply_markup: { inline_keyboard: [
                [{ text: "✅ Approve Changes", callback_data: "approve_update" }],
                [{ text: "✏️ Modify Request", callback_data: "modify_update" }],
                [{ text: "❌ Cancel", callback_data: "cancel_update" }]
            ] }
        });
        await db.updateSession(session.id, 'reviewing_update', 'update', session.data);
    } catch (error) {
        console.error('Update request error:', error);
        await sendMarkdown(ctx, `⚠️ Something went wrong. Please try again.`);
    }
}

async function handleApproveUpdate(ctx, client, session) {
    const updatedCV = session.data.proposed_cv;
    const orderId = `UPD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const completeCV = cvVersioning.ensureCompleteCVData(updatedCV);
    await db.createOrder({
        id: orderId, client_id: client.id, service: 'cv update', category: session.data.category || 'professional',
        delivery_option: 'standard', delivery_time: '6 hours',
        base_price: getBasePrice('professional', 'cv update'), delivery_fee: 0,
        total_charge: formatPrice(getBasePrice('professional', 'cv update')),
        payment_status: 'pending', cv_data: completeCV
    });
    await cvVersioning.saveVersion(orderId, completeCV, 2, 'Intelligent update');
    await sendMarkdown(ctx, `✅ *Update Applied Successfully!*

Your CV has been updated as requested.

Order: \`${orderId}\`
Total: ${formatPrice(getBasePrice('professional', 'cv update'))}

Click below to complete payment and receive your updated CV.`, {
        reply_markup: { inline_keyboard: [[{ text: "💰 Pay Now", callback_data: "proceed_payment" }]] }
    });
    session.data.awaiting_update_request = false;
    session.data.pending_update = false;
    await db.updateSession(session.id, 'awaiting_payment_choice', 'payment', session.data);
}

async function handleUpdateFlow(ctx, client, session) {
    await handleIntelligentUpdate(ctx, client, session);
}

async function handleUpdateCollection(ctx, client, session, text) {
    await handleUpdateRequest(ctx, client, session, text);
}


// ============ SHOW CLIENT PORTAL ============
async function showClientPortal(ctx, client) {
    const orders = await db.getClientOrders(client.id);
    const cvOrders = orders.filter(o => o.service === 'new cv' || o.service === 'editable cv');
    const coverOrders = orders.filter(o => o.service === 'cover letter' || o.service === 'editable cover letter');
    const updateOrders = orders.filter(o => o.service === 'cv update');
    let latestCVInfo = '';
    if (cvOrders.length > 0) {
        const latestCV = cvOrders[0];
        const versions = await db.getCVVersions(latestCV.id);
        latestCVInfo = `\n📄 *Latest CV:* v${latestCV.version || 1} - ${new Date(latestCV.created_at).toLocaleDateString()}`;
    }
    let message = `🏠 *YOUR PORTAL*

${SEP}
👤 *ACCOUNT INFORMATION*
${SEP}

• Name: ${client.first_name} ${client.last_name || ''}
• Phone: ${client.phone || '❌ Not set'}
• Email: ${client.email || '❌ Not set'}
• Location: ${client.location || '❌ Not set'}
• Nationality: ${client.nationality || '❌ Not set'}
• Member since: ${new Date(client.created_at).toLocaleDateString()}

${SEP}
📊 *YOUR STATISTICS*
${SEP}

• Total Orders: ${orders.length}
• CVs: ${cvOrders.length}
• Cover Letters: ${coverOrders.length}
• Updates: ${updateOrders.length}
• Completed: ${orders.filter(o => o.payment_status === 'completed').length}
${latestCVInfo}

${SEP}
📄 *RECENT DOCUMENTS*
${SEP}`;
    if (orders.length > 0) {
        message += orders.slice(0, 5).map(o => `\n📌 *${o.service}* - ${o.status}\n   📅 ${new Date(o.created_at).toLocaleDateString()}\n   💰 ${o.total_charge}`).join('');
    } else {
        message += `\nNo documents yet. Start your first order with /start`;
    }
    message += `\n\n${SEP}
⚙️ *QUICK ACTIONS*
${SEP}

• /mydocs - View all documents
• /versions - View CV version history
• /referral - Share & earn
• /feedback - Rate your experience
• /support - Contact support

Need help? Type /help anytime.`;
    await sendMarkdown(ctx, message);
}

// ============ MISSING HELPER FUNCTIONS ============
async function showPaymentOptions(ctx, orderId, total, reference) {
    const message = RESPONSES.payment.payment_options(reference, total);
    await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📱 Mobile Money", callback_data: `pay_mobile_${orderId}` }],
                [{ text: "🏦 Bank Transfer", callback_data: `pay_bank_${orderId}` }],
                [{ text: "⏳ Pay Later", callback_data: `pay_later_${orderId}` }],
                [{ text: "📅 Installments", callback_data: `pay_installment_${orderId}` }]
            ]
        }
    });
}

async function collectFeedback(ctx, client, orderId) {
    await ctx.reply(`⭐ *Share Your Experience*\n\nHow would you rate our service?`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "1", callback_data: `feedback_${orderId}_1` },
                 { text: "2", callback_data: `feedback_${orderId}_2` },
                 { text: "3", callback_data: `feedback_${orderId}_3` },
                 { text: "4", callback_data: `feedback_${orderId}_4` },
                 { text: "5", callback_data: `feedback_${orderId}_5` }]
            ]
        }
    });
}

async function handlePaymentConfirmation(ctx, reference) {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getAllOrders();
    const order = orders.find(o => o.payment_reference === reference);
    if (!order) return ctx.reply('❌ No order found with that reference.');
    await db.updateOrderPaymentStatus(order.id, 'pending_verification');
    await ctx.reply(`✅ Payment confirmation received!\n\nWe'll verify and notify you shortly.`);
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
        await bot.telegram.sendMessage(adminChatId, `💰 *Payment Confirmation*\n\nOrder: ${order.id}\nClient: ${client.first_name}\nAmount: ${order.total_charge}\nReference: ${reference}`, { parse_mode: 'Markdown' });
    }
}

async function showSummaryAndFinalize(ctx, client, session) {
    const cvData = session.data.cv_data || {};
    const total = session.data.total_charge || formatPrice(calculateTotal(session.data.category, session.data.service, session.data.delivery_option));
    let summary = `📄 *CV SUMMARY*\n\n`;
    summary += `${SEP}\n`;
    summary += `👤 ${cvData.personal?.full_name || 'Not provided'}\n`;
    summary += `💼 ${cvData.employment?.length || 0} jobs · 🎓 ${cvData.education?.length || 0} education\n`;
    summary += `⚡ ${(cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0)} skills\n`;
    summary += `${SEP}\n`;
    summary += `💰 Total: ${total}\n\n`;
    summary += `Type *CONFIRM* to proceed to payment or *EDIT* to make changes.`;
    await sendMarkdown(ctx, summary);
    session.data.awaiting_confirmation = true;
    await db.updateSession(session.id, 'awaiting_confirmation', 'summary', session.data);
}

// ============ DOWNLOAD ALL DOCUMENTS AS ZIP ============
const archiver = require('archiver');
app.get('/admin/download-all-documents', adminAuth, async (req, res) => {
    try {
        const documents = await db.getAllDocuments();
        if (!documents || documents.length === 0) return res.status(404).json({ error: 'No documents found' });
        const timestamp = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=easysuccor-documents-${timestamp}.zip`);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);
        for (const doc of documents) {
            const clientName = doc.client_name || 'unknown';
            const docType = doc.document_type || 'document';
            const version = doc.version || '1';
            const orderId = String(doc.order_id || '').slice(-8);
            let filename = `${clientName}_${docType}_v${version}_${orderId}`;
            if (doc.format === 'pdf') filename += '.pdf';
            else if (doc.format === 'docx') filename += '.docx';
            else filename += '.txt';
            const content = doc.content || doc.file_path ? await fs.readFile(doc.file_path) : Buffer.from(JSON.stringify(doc, null, 2));
            archive.append(content, { name: filename });
        }
        const manifest = { export_date: new Date().toISOString(), total_documents: documents.length, documents: documents.map(d => ({ order_id: d.order_id, client: d.client_name, type: d.document_type, version: d.version, created: d.created_at })) };
        archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
        await archive.finalize();
    } catch (error) {
        console.error('Document export error:', error);
        res.status(500).json({ error: error.message });
    }
});
// ============ START COMMAND ============
bot.start(async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    const startPayload = ctx.startPayload;
    console.log('📥 Start command received from:', ctx.from.first_name, ctx.from.id);
    
    // Handle referral payload
    if (startPayload && startPayload.startsWith('ref_')) {
        const parts = startPayload.split('_');
        if (parts.length >= 3) {
            const referralCode = parts[1];
            const visitorName = decodeURIComponent(parts.slice(2).join('_'));
            await handleReferralWithName(ctx, referralCode, visitorName);
            return;
        } else {
            const referralCode = startPayload.replace('ref_', '');
            await handleReferralStart(ctx, referralCode);
            return;
        }
    }
    
    let telegramName = ctx.from.first_name || 'Valued Professional';
    if (startPayload && !startPayload.startsWith('ref_')) telegramName = decodeURIComponent(startPayload);
    
    if (!client) {
        // Brand new user (never interacted)
        const newClient = await db.createClient(ctx.from.id, ctx.from.username, telegramName, ctx.from.last_name || '');
        const welcomeMessage = getTimeBasedFirstTimeWelcome(telegramName);
        await ctx.reply(welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎓 Student / Recent Graduate", callback_data: "category_student" }],
                    [{ text: "💼 Professional (3+ years)", callback_data: "category_professional" }],
                    [{ text: "🌱 Career Starter / Non-Working", callback_data: "category_nonworking" }],
                    [{ text: "🔄 Returning Client", callback_data: "category_returning" }]
                ]
            }
        });
        await ctx.reply('💡 *Quick Tip:* Use the keyboard below for quick access!', { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
        await db.logAdminAction({ admin_id: 'system', action: 'warm_welcome', details: `New client ${telegramName} joined` });
        console.log('✅ New client welcome completed for:', telegramName);
        return;
    }
    
    // Existing client – check if they have any orders
    const orders = await db.getClientOrders(client.id);
    const hasOrders = orders && orders.length > 0;
    
    if (!hasOrders) {
        // Client exists but has never completed an order → treat as first-time user
        const welcomeMessage = getTimeBasedFirstTimeWelcome(client.first_name || telegramName);
        await ctx.reply(welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎓 Student / Recent Graduate", callback_data: "category_student" }],
                    [{ text: "💼 Professional (3+ years)", callback_data: "category_professional" }],
                    [{ text: "🌱 Career Starter / Non-Working", callback_data: "category_nonworking" }],
                    [{ text: "🔄 Returning Client", callback_data: "category_returning" }]
                ]
            }
        });
        await ctx.reply('💡 *Quick Tip:* Use the keyboard below for quick access!', { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
        await db.logAdminAction({ admin_id: 'system', action: 'warm_welcome', details: `Client ${client.first_name} restarted with no orders` });
        console.log('✅ First-time welcome (after reset) completed for:', client.first_name);
        return;
    }
    
    // Returning client with at least one order
    const clientName = client.first_name || telegramName;
    const welcomeBackMessage = getTimeBasedReturningWelcome(clientName);
    await ctx.reply(welcomeBackMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "📄 New CV", callback_data: "service_new_cv" }],
                [{ text: "📝 Editable CV", callback_data: "service_editable_cv" }],
                [{ text: "💌 Cover Letter", callback_data: "service_cover_letter" }],
                [{ text: "📎 Editable Cover Letter", callback_data: "service_editable_cover" }],
                [{ text: "✏️ Update Existing CV", callback_data: "prefill_update" }],
                [{ text: "🏢 Client Portal", callback_data: "portal_main" }]
            ]
        }
    });
    await ctx.reply('💡 *Quick Tip:* Use the keyboard below for quick access!', { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard });
    console.log('✅ Returning client welcome completed for:', clientName);
});
// ============ HEALTH CHECK COMMAND ============
bot.command('health', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    const healthStatus = { bot: 'online', timestamp: new Date().toISOString(), uptime: process.uptime(), database: 'checking', deepseek: 'checking' };
    try { const dbCheck = await db.getClient(ctx.from.id); healthStatus.database = dbCheck ? 'connected' : 'connected'; } catch (error) { healthStatus.database = `error: ${error.message}`; }
    try {
        const { OpenAI } = require('openai');
        const deepseek = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/v1' });
        const testResponse = await deepseek.chat.completions.create({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'Say "API is working!"' }], max_tokens: 10 });
        healthStatus.deepseek = 'working';
        healthStatus.deepseek_response = testResponse.choices[0].message.content;
    } catch (error) { healthStatus.deepseek = `error: ${error.message}`; }
    const message = `🩺 *HEALTH CHECK REPORT*\n\n${SEP}\n🤖 *Bot Status:* ${healthStatus.bot}\n🕐 *Uptime:* ${Math.floor(healthStatus.uptime / 60)} minutes\n📅 *Timestamp:* ${healthStatus.timestamp}\n${SEP}\n🗄️ *Database:* ${healthStatus.database}\n🧠 *DeepSeek API:* ${healthStatus.deepseek}\n${healthStatus.deepseek_response ? `📝 *Test:* ${healthStatus.deepseek_response}` : ''}\n${SEP}\n✅ All systems operational.`;
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// ============ WEBSITE COMMAND ============
bot.command('website', async (ctx) => {
    const webhookUrl = process.env.WEBHOOK_URL || 'https://easysuccor-bot-production.up.railway.app';
    await sendMarkdown(ctx, `🌐 *EasySuccor Home Page*\n\nVisit our professional Home Page:\n${webhookUrl}\n\n*What you'll find there:*\n• Service descriptions and pricing\n• Sample CV templates\n• Client testimonials\n• FAQ section\n• Easy access to our Telegram bot\n\nShare this link with anyone who needs a professional CV!`);
});

// ============ ADMIN COMMANDS ============
bot.command('admin_orders', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    const orders = await db.getAllOrders();
    if (orders.length === 0) return await ctx.reply("📭 No orders found.");
    let message = "📋 *ALL ORDERS*\n\n";
    for (const order of orders.slice(0, 20)) {
        const cvData = order.cv_data || {};
        const stats = {
            jobs: cvData.employment?.length || 0,
            edu: cvData.education?.length || 0,
            skills: (cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0),
            certs: cvData.certifications?.length || 0,
            projects: cvData.projects?.length || 0
        };
        message += `🔹 *${order.id}*\n   Service: ${order.service}\n   Status: ${order.status}\n   Payment: ${order.payment_status}\n   Total: ${order.total_charge}\n   Date: ${new Date(order.created_at).toLocaleDateString()}\n   📊 ${stats.jobs} jobs · ${stats.edu} edu · ${stats.skills} skills · ${stats.certs} certs\n\n`;
    }
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('admin_view', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return await ctx.reply("Usage: /admin_view ORDER_ID");
    const orderId = args[1];
    const order = await db.getOrder(orderId);
    if (!order) return await ctx.reply(`❌ Order ${orderId} not found.`);
    const cvData = order.cv_data || {};
    const personal = cvData.personal || {};
    let message = `📄 *FULL CV DATA FOR ORDER ${orderId}*\n\n`;
    message += `${SEP}\n👤 *PERSONAL INFORMATION*\n${SEP}\n• Name: ${personal.full_name || 'N/A'}\n• Email: ${personal.email || 'N/A'}\n• Phone: ${personal.primary_phone || 'N/A'}\n• Location: ${personal.location || 'N/A'}\n• LinkedIn: ${personal.linkedin || 'N/A'}\n• GitHub: ${personal.github || 'N/A'}\n• Professional Title: ${personal.professional_title || 'N/A'}\n\n`;
    message += `${SEP}\n💼 *WORK EXPERIENCE* (${cvData.employment?.length || 0})\n${SEP}\n`;
    for (const job of (cvData.employment || [])) message += `• ${job.title} at ${job.company}\n  📅 ${job.duration || 'Duration not specified'}\n${job.achievements?.length ? `  🏆 ${job.achievements[0].substring(0, 60)}${job.achievements[0].length > 60 ? '...' : ''}\n` : ''}`;
    message += `\n${SEP}\n🎓 *EDUCATION* (${cvData.education?.length || 0})\n${SEP}\n`;
    for (const edu of (cvData.education || [])) message += `• ${edu.level} in ${edu.field}\n  🏛️ ${edu.institution}\n  📅 ${edu.graduation_date || edu.year || 'Year not specified'}\n`;
    message += `\n${SEP}\n⚡ *SKILLS*\n${SEP}\n`;
    const skills = cvData.skills || {};
    if (skills.technical?.length) message += `• Technical: ${skills.technical.join(', ')}\n`;
    if (skills.soft?.length) message += `• Soft: ${skills.soft.join(', ')}\n`;
    if (skills.tools?.length) message += `• Tools: ${skills.tools.join(', ')}\n`;
    message += `\n`;
    if (cvData.certifications?.length) {
        message += `${SEP}\n📜 *CERTIFICATIONS* (${cvData.certifications.length})\n${SEP}\n`;
        for (const cert of cvData.certifications) message += `• ${cert.name}${cert.issuer ? ` (${cert.issuer})` : ''}\n`;
        message += `\n`;
    }
    if (cvData.languages?.length) {
        message += `${SEP}\n🌍 *LANGUAGES* (${cvData.languages.length})\n${SEP}\n`;
        for (const lang of cvData.languages) message += `• ${lang.name} (${lang.proficiency || 'Not specified'})\n`;
        message += `\n`;
    }
    if (cvData.projects?.length) {
        message += `${SEP}\n📁 *PROJECTS* (${cvData.projects.length})\n${SEP}\n`;
        for (const proj of cvData.projects.slice(0, 5)) message += `• ${proj.name}${proj.role ? ` (${proj.role})` : ''}\n`;
        message += `\n`;
    }
    if (cvData.referees?.length) {
        message += `${SEP}\n👥 *REFEREES* (${cvData.referees.length})\n${SEP}\n`;
        for (const ref of cvData.referees) message += `• ${ref.name} - ${ref.position || 'Position not specified'} at ${ref.company || 'Company not specified'}\n`;
        message += `\n`;
    }
    message += `${SEP}\n💾 *Raw JSON available in database*`;
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('admin_clients', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    const clients = await db.getAllClients();
    if (clients.length === 0) return await ctx.reply("📭 No clients found.");
    let message = "👥 *ALL CLIENTS*\n\n";
    for (const client of clients.slice(0, 20)) {
        const orders = await db.getClientOrders(client.id);
        const completed = orders.filter(o => o.payment_status === 'completed').length;
        const totalSpent = orders.reduce((sum, o) => sum + (parseInt(o.total_charge?.replace('MK', '').replace(',', '') || 0), 0));
        message += `🔹 ID: ${client.id} - ${client.first_name} ${client.last_name || ''}\n   📞 ${client.phone || 'No phone'} | 📧 ${client.email || 'No email'}\n   📦 Orders: ${orders.length} (${completed} completed)\n   💰 Spent: MK${totalSpent.toLocaleString()}\n   📅 Joined: ${new Date(client.created_at).toLocaleDateString()}\n\n`;
    }
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('admin_delete_client', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return await ctx.reply("Usage: /admin_delete_client CLIENT_ID");
    const clientId = parseInt(args[1]);
    const client = await db.getClientById(clientId);
    if (!client) return await ctx.reply(`❌ Client ${clientId} not found.`);
    await db.deleteClientData(clientId);
    await ctx.reply(`✅ Client ${client.first_name} ${client.last_name || ''} (ID: ${clientId}) deleted successfully.`);
});

bot.command('admin_clear_all', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    await ctx.reply(`⚠️ *DANGER: This will delete ALL data!*\n\nType /confirm_clear_all to confirm.`);
});
bot.command('confirm_clear_all', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    await db.clearAllData();
    await ctx.reply(`✅ ALL DATA CLEARED successfully.`);
});

bot.command('admin_price', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    const args = ctx.message.text.split(' ');
    if (args.length < 4) return await ctx.reply("Usage: /admin_price CATEGORY SERVICE PRICE\n\nCategories: student, recent, professional, nonworking, returning\nServices: cv, editable_cv, editable_cover, update, cover\nExample: /admin_price student cv 7000");
    const category = args[1], service = args[2], price = parseInt(args[3]);
    if (PRICE_CONFIG[category] && PRICE_CONFIG[category][service] !== undefined) {
        PRICE_CONFIG[category][service] = price;
        fs.writeFileSync('./price_config.json', JSON.stringify(PRICE_CONFIG, null, 2));
        await ctx.reply(`✅ Price updated: ${category}.${service} = MK${price.toLocaleString()}`);
    } else await ctx.reply(`❌ Invalid category or service.`);
});

bot.command('admin_deepseek', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    await ctx.reply(`🔍 *Checking DeepSeek API Status...*`);
    try {
        const { OpenAI } = require('openai');
        const deepseek = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/v1' });
        const startTime = Date.now();
        const response = await deepseek.chat.completions.create({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'Say "API OK"' }], max_tokens: 10 });
        const responseTime = Date.now() - startTime;
        await ctx.reply(`✅ *DeepSeek API is WORKING*\n\n${SEP}\n📊 *Status:* Online\n⏱️ *Response Time:* ${responseTime}ms\n📝 *Test Response:* ${response.choices[0].message.content}\n${SEP}\nDeepSeek AI is ready to process CV extractions!`);
    } catch (error) {
        await ctx.reply(`❌ *DeepSeek API ERROR*\n\n${SEP}\n📊 *Status:* Offline\n❌ *Error:* ${error.message}\n${SEP}\nPlease check your DEEPSEEK_API_KEY environment variable.`);
    }
});

bot.command('reports', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return;
    const reports = await db.getErrorReports('pending', 20);
    if (reports.length === 0) return ctx.reply('✅ No pending error reports.');
    let message = `🐛 *Pending Error Reports*\n\n`;
    for (const r of reports) {
        const client = await db.getClientById(r.client_id);
        message += `*ID:* ${r.id}\n*Client:* ${client?.first_name || 'Unknown'}\n*Desc:* ${r.description.slice(0, 50)}${r.description.length > 50 ? '...' : ''}\n*Date:* ${new Date(r.created_at).toLocaleDateString()}\n*File:* \`${r.file_id.slice(0, 8)}\`\n/resolve ${r.id}\n\n`;
    }
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('resolve', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return;
    const reportId = ctx.message.text.split(' ')[1];
    if (!reportId) return ctx.reply('Usage: /resolve [report_id]');
    const report = await db.getErrorReportById(parseInt(reportId));
    if (!report) return ctx.reply('❌ Report not found.');
    await db.updateErrorReportStatus(reportId, 'resolved', 'Issue fixed');
    const client = await db.getClientById(report.client_id);
    if (client) await bot.telegram.sendMessage(client.telegram_id, `✅ *Issue Resolved!*\n\nThank you for your patience. The issue you reported has been fixed!\n\n*Reference:* \`${report.file_id.slice(0, 8)}\`\n\nWe appreciate you helping us improve EasySuccor! 🤝`, { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Report #${reportId} resolved. Client ${client?.first_name || 'Unknown'} has been notified.`);
});

bot.command('resolve_report', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return;
    const fileId = ctx.message.text.split(' ')[1];
    if (!fileId) return ctx.reply('Usage: /resolve_report [file_id]');
    const reports = await db.getErrorReports('pending', 100);
    const report = reports.find(r => r.file_id === fileId || r.file_id.startsWith(fileId));
    if (!report) return ctx.reply('❌ Report not found.');
    await db.updateErrorReportStatus(report.id, 'resolved', 'Issue fixed');
    const client = await db.getClientById(report.client_id);
    if (client) await bot.telegram.sendMessage(client.telegram_id, `✅ *Issue Resolved!*\n\nThank you for your patience. The issue you reported has been fixed!\n\n*Reference:* \`${report.file_id.slice(0, 8)}\`\n\nWe appreciate you helping us improve EasySuccor! 🤝`, { parse_mode: 'Markdown' });
    await ctx.reply(`✅ Report resolved. Client ${client?.first_name || 'Unknown'} has been notified.`);
});

bot.command('admin_stats', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("⛔ Unauthorized.");
    const orders = await db.getAllOrders();
    const clients = await db.getAllClients();
    const completed = orders.filter(o => o.payment_status === 'completed');
    const pending = orders.filter(o => o.payment_status === 'pending');
    const revenue = completed.reduce((sum, o) => sum + (parseInt(String(o.total_charge).replace(/[^0-9]/g, '') || 0)), 0);
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = orders.filter(o => o.created_at?.startsWith(today));
    const message = `📊 *QUICK STATISTICS*\n\n${SEP}\n👥 *Clients:* ${clients.length}\n📦 *Total Orders:* ${orders.length}\n✅ *Completed:* ${completed.length}\n⏳ *Pending:* ${pending.length}\n💰 *Revenue:* MK${revenue.toLocaleString()}\n📅 *Today's Orders:* ${todayOrders.length}\n${SEP}\n📊 *Full Dashboard:* ${process.env.WEBHOOK_URL}/admin`;
    await ctx.reply(message, { parse_mode: 'Markdown' });
});

// ============ USER COMMANDS ============
bot.command('portal', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getClientOrders(client.id);
    const cvOrders = orders.filter(o => o.service === 'new cv' || o.service === 'editable cv');
    const coverOrders = orders.filter(o => o.service === 'cover letter' || o.service === 'editable cover letter');
    let message = `🏠 *YOUR PORTAL*\n\n${SEP}\n👤 *PROFILE*\n${SEP}\n• Name: ${client.first_name} ${client.last_name || ''}\n• Phone: ${client.phone || '❌ Not set'}\n• Email: ${client.email || '❌ Not set'}\n• Location: ${client.location || '❌ Not set'}\n\n${SEP}\n📊 *STATISTICS*\n${SEP}\n• Total Orders: ${orders.length}\n• CVs: ${cvOrders.length}\n• Cover Letters: ${coverOrders.length}\n• Completed: ${orders.filter(o => o.payment_status === 'completed').length}\n\n${SEP}\n📄 *RECENT DOCUMENTS*\n${SEP}`;
    if (orders.length > 0) message += orders.slice(0, 5).map(o => `\n• ${o.service} - ${o.status}\n  📅 ${new Date(o.created_at).toLocaleDateString()}\n  💰 ${o.total_charge}`).join('');
    else message += `\nNo documents yet. Start with /start`;
    message += `\n\n${SEP}\n⚙️ *QUICK ACTIONS*\n${SEP}\n• /mydocs - View all documents\n• /versions - View CV history\n• /referral - Share & earn\n• /feedback - Rate your experience\n\nNeed help? Type /help`;
    await sendMarkdown(ctx, message);
});

bot.command('mydocs', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getClientOrders(client.id);
    let msg = "📄 *YOUR DOCUMENTS*\n\n";
    if (orders.length === 0) msg += "No documents yet. Type /start to create one!";
    else orders.forEach(o => { msg += `📌 *${o.service}* - ${o.status}\n   🆔 Order: \`${o.id}\`\n   📅 Date: ${new Date(o.created_at).toLocaleDateString()}\n   💰 Amount: ${o.total_charge}\n\n`; });
    await sendMarkdown(ctx, msg);
});

bot.command('versions', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getClientOrders(client.id);
    const cvOrders = orders.filter(o => o.service === 'new cv' || o.service === 'editable cv');
    if (cvOrders.length === 0) return await sendMarkdown(ctx, `📭 No CV versions found. Create your first CV with /start`);
    let msg = "📁 *YOUR CV VERSIONS*\n\n";
    for (const order of cvOrders) {
        const versions = await db.getCVVersions(order.id);
        const versionCount = versions.length || 1;
        msg += `📌 *${order.service}* - ${order.status}\n   🆔 Order: \`${order.id}\`\n   🔄 Versions: ${versionCount}\n   📅 Created: ${new Date(order.created_at).toLocaleDateString()}\n\n`;
    }
    msg += `To view a specific version, type: /view_version ORDER_ID`;
    await sendMarkdown(ctx, msg);
});

bot.command('view_version', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return await sendMarkdown(ctx, `Usage: /view_version ORDER_ID\n\nExample: /view_version ORD_1234567890`);
    const orderId = args[1];
    const order = await db.getOrder(orderId);
    if (!order) return await sendMarkdown(ctx, `❌ Order not found.`);
    const cvData = order.cv_data || {};
    const personal = cvData.personal || {};
    let message = `📄 *CV DATA FOR ORDER ${orderId}*\n\n`;
    message += `👤 *Personal:* ${personal.full_name || 'N/A'} | ${personal.email || 'N/A'}\n`;
    message += `📍 *Location:* ${personal.location || 'N/A'}\n`;
    message += `💼 *Experience:* ${cvData.employment?.length || 0} job(s)\n`;
    message += `🎓 *Education:* ${cvData.education?.length || 0} qualification(s)\n`;
    message += `⚡ *Skills:* ${(cvData.skills?.technical?.length || 0) + (cvData.skills?.soft?.length || 0) + (cvData.skills?.tools?.length || 0)} skill(s)\n`;
    message += `📜 *Certifications:* ${cvData.certifications?.length || 0}\n`;
    message += `🌍 *Languages:* ${cvData.languages?.length || 0}\n`;
    message += `📁 *Projects:* ${cvData.projects?.length || 0}\n`;
    message += `👥 *Referees:* ${cvData.referees?.length || 0}\n\n`;
    message += `💾 *Full data available in your portal.`;
    await sendMarkdown(ctx, message);
});

bot.command('referral', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const refInfo = await db.getReferralInfo(client.id);
    const websiteUrl = process.env.WEBSITE_URL || 'https://easysuccor-bot-production.up.railway.app';
    const shareLink = `${websiteUrl}?ref=${refInfo.referral_code}`;
    const message = `🎁 <b>REFERRAL PROGRAM</b>\n\n${SEP}\n📋 <b>YOUR REFERRAL LINK</b>\n${SEP}\n<b>Your code:</b> <code>${refInfo.referral_code}</code>\n\n🔗 <b>Share this link:</b>\n<a href="${shareLink}">${shareLink}</a>\n\n${SEP}\n📊 <b>YOUR STATISTICS</b>\n${SEP}\n• Tier: ${getReferralTier(refInfo.completed_referrals)}\n• Total referrals: ${refInfo.total_referrals}\n• Completed: ${refInfo.completed_referrals}\n• Pending reward: MK${(refInfo.pending_reward || 0).toLocaleString()}\n• Available credit: MK${(refInfo.available_credit || 0).toLocaleString()}\n\n${SEP}\n📤 <b>SHARE NOW</b>\n${SEP}\nTap the link above to copy and share!\n\nEvery referral brings you closer to a free CV! 🎉`;
    await ctx.replyWithHTML(message);
});

function getReferralTier(count) {
    if (count >= 50) return '👑 Diamond';
    if (count >= 25) return '💎 Platinum';
    if (count >= 10) return '🥇 Gold';
    if (count >= 5) return '🥈 Silver';
    return '🥉 Bronze';
}

bot.command('pay', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    if (!session || !session.data || !session.data.total_charge) return await sendMarkdown(ctx, `❌ No active order found. Type /start to create a new order.`);
    const paymentReference = generatePaymentReference();
    const totalCharge = session.data.total_charge;
    session.data.payment_reference = paymentReference;
    await db.updateSession(session.id, session.stage, session.current_section, session.data);
    const paymentMessage = `💳 *COMPLETE YOUR PAYMENT*\n\n${SEP}\n📋 ORDER SUMMARY\n${SEP}\nOrder: \`${session.data.order_id || 'Pending'}\`\nAmount: *${totalCharge}*\nReference: \`${paymentReference}\`\n\n${SEP}\n💳 PAYMENT OPTIONS\n${SEP}\n*1️⃣ Mobile Money*\n   📱 Airtel: 0991295401\n   📱 Mpamba: 0886928639\n\n*2️⃣ Bank Account*\n   🏦 MO626: 1005653618\n\n*3️⃣ USSD*\n   📞 Dial *211# (Airtel)\n   📞 Dial *444# (Mpamba)\n\n*4️⃣ Pay Later*\n   ⏳ Pay within 7 days\n\n*5️⃣ Installments*\n   📅 2 parts over 7 days\n\n${SEP}\n📌 NEXT STEPS\n${SEP}\n1️⃣ Send exactly *${totalCharge}* to any account above\n2️⃣ Use reference: \`${paymentReference}\`\n3️⃣ After payment, click the button below:\n\nNeed help? Contact +265 991 295 401`;
    await sendMarkdown(ctx, paymentMessage, {
        reply_markup: { inline_keyboard: [[ { text: "✅ I Have Made Payment", callback_data: `confirm_${paymentReference}` } ]] }
    });
});

bot.command('cancel', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    if (session && session.data) {
        session.data.payment_confirmed = false;
        session.data.payment_reference = null;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
        await sendMarkdown(ctx, `❌ Payment confirmation cancelled. You can start over with /start or /pay again.`);
    } else await sendMarkdown(ctx, `No active payment to cancel.`);
});

bot.command('pause', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await db.getActiveSession(client.id);
    if (session && session.stage !== 'main_menu') {
        session.is_paused = true;
        await db.updateSession(session.id, session.stage, session.current_section, session.data, 1);
        await sendMarkdown(ctx, `⏸️ *Session Paused*\n\nType /resume when you're ready to continue. I'll be here! 👋`);
    } else await sendMarkdown(ctx, `No active session to pause.`);
});

bot.command('resume', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const pausedSession = await db.getPausedSession(client.id);
    if (!pausedSession) {
        await sendMarkdown(ctx, `No paused session found. Type /start to begin fresh.`);
        return;
    }
    
    // Parse session data if string
    if (typeof pausedSession.data === 'string') {
        try { pausedSession.data = JSON.parse(pausedSession.data); } catch(e) { pausedSession.data = {}; }
    }
    
    // Reactivate the session (set is_paused = 0)
    await db.updateSession(pausedSession.id, pausedSession.stage, pausedSession.current_section, pausedSession.data, 0);
    
    let resumeMessage = "🔄 Welcome back! Let's continue where we left off.\n\n";
    
    // Determine the correct prompt based on stage and collection step
    switch (pausedSession.stage) {
        case 'collecting_personal':
            const step = pausedSession.data.collection_step;
            if (step === 'name') resumeMessage += getQuestion('name');
            else if (step === 'email') resumeMessage += getQuestion('email');
            else if (step === 'phone') resumeMessage += getQuestion('phone');
            else if (step === 'alt_phone') resumeMessage += "📞 Alternative phone number?\n\nClick 'Skip' if none.";
            else if (step === 'whatsapp') resumeMessage += "📱 WhatsApp for delivery?\n\nClick 'Same' or type a new number.";
            else if (step === 'location') resumeMessage += getQuestion('location');
            else if (step === 'professional_title') resumeMessage += "💼 Professional title? (Optional)\n\nType 'Skip' to continue.";
            else if (step === 'linkedin') resumeMessage += "🔗 LinkedIn URL? (Optional)\n\nType 'Skip' to continue.";
            else if (step === 'github') resumeMessage += "💻 GitHub URL? (Optional)\n\nType 'Skip' to continue.";
            else if (step === 'physical_address') resumeMessage += "🏠 Physical address? (Optional)\n\nType 'Skip' to continue.";
            else if (step === 'nationality') resumeMessage += "🌍 Nationality? (Optional)\n\nType 'Skip' to continue.";
            else if (step === 'date_of_birth') resumeMessage += "🎂 Date of birth? (Optional)\n\nType 'Skip' to continue.";
            else if (step === 'id_upload') resumeMessage += "Please upload your National ID or Driver's Licence, or click Skip.";
            else if (step === 'after_id') resumeMessage += "Do you have any special documents? (e.g., Professional License)\n\nType each, then click 'Done'.";
            else resumeMessage += getQuestion('name');
            break;
            
        case 'collecting_education':
            const eduStep = pausedSession.data.collection_step;
            if (eduStep === 'level') resumeMessage += "What's your highest qualification? 🎓";
            else if (eduStep === 'field') resumeMessage += "Field of study? 📚";
            else if (eduStep === 'institution') resumeMessage += "Institution? 🏛️";
            else if (eduStep === 'year') resumeMessage += "Year of completion? 📅";
            else if (eduStep === 'add_more') resumeMessage += "Another qualification? (Click Yes/No)";
            else resumeMessage += "Let's continue with your education.";
            break;
            
        case 'collecting_skills':
            resumeMessage += getQuestion('skills');
            break;
            
        case 'collecting_certifications':
            const certStep = pausedSession.data.collection_step;
            if (certStep === 'name') resumeMessage += "Certification name? 📜";
            else if (certStep === 'issuer') resumeMessage += "Issuing organization? 🏛️";
            else if (certStep === 'date') resumeMessage += "Date obtained? 📅";
            else if (certStep === 'expiry') resumeMessage += "Expiry date? (or type 'Skip')";
            else if (certStep === 'credential_id') resumeMessage += "Credential ID? (or type 'Skip')";
            else if (certStep === 'url') resumeMessage += "Certificate URL? (or type 'Skip')";
            else if (certStep === 'add_more') resumeMessage += "Another certification? (Click Yes/No)";
            else resumeMessage += "Any certifications? (Click SKIP if none)";
            break;
            
        case 'collecting_projects':
            const projStep = pausedSession.data.collection_step;
            if (projStep === 'name') resumeMessage += "Project name? 📁";
            else if (projStep === 'description') resumeMessage += "Project description? (2-3 sentences)";
            else if (projStep === 'technologies') resumeMessage += "Technologies used? 🔧";
            else if (projStep === 'role') resumeMessage += "Your role? 👤";
            else if (projStep === 'team_size') resumeMessage += "Team size? (or type 'Skip')";
            else if (projStep === 'duration') resumeMessage += "Duration? 📅";
            else if (projStep === 'link') resumeMessage += "Project link? (or type 'Skip')";
            else if (projStep === 'outcome') resumeMessage += "Project outcome/impact? 📊";
            else if (projStep === 'add_more') resumeMessage += "Another project? (Click Yes/No)";
            else resumeMessage += "Any projects? (Click SKIP if none)";
            break;
            
        case 'collecting_achievements':
            resumeMessage += "What are your key achievements? (Type each, then DONE when finished)";
            break;
            
        case 'collecting_volunteer':
            resumeMessage += "Any volunteer experience? (Click SKIP if none)";
            break;
            
        case 'collecting_leadership':
            resumeMessage += "Any leadership roles? (Click SKIP if none)";
            break;
            
        case 'collecting_awards':
            resumeMessage += "Any awards? (Click SKIP if none)";
            break;
            
        case 'collecting_publications':
            resumeMessage += "Any publications? (Click SKIP if none)";
            break;
            
        case 'collecting_conferences':
            resumeMessage += "Any conferences? (Click SKIP if none)";
            break;
            
        case 'collecting_interests':
            resumeMessage += "What are your interests/hobbies? (comma separated, or click SKIP)";
            break;
            
        case 'collecting_portfolio':
            resumeMessage += "📎 Please provide your portfolio links (one per line) or click SKIP.";
            break;
            
        case 'collecting_missing':
            const missingSection = pausedSession.data.current_section;
            resumeMessage += `Let's continue with: ${missingSection}\n\n${getMissingPrompt(missingSection)}`;
            break;
            
        case 'cover_selecting_vacancy':
            resumeMessage += "Do you have a job vacancy in mind? (Yes/No)";
            break;
            
        case 'cover_collecting_position':
            resumeMessage += "What position are you applying for?";
            break;
            
        case 'cover_collecting_company':
            resumeMessage += "Which company are you applying to?";
            break;
            
        case 'cover_collecting_experience':
            resumeMessage += "What's your most relevant experience for this role? (2-3 sentences)";
            break;
            
        case 'cover_collecting_skills':
            resumeMessage += "What are your top 3 skills for this role? (comma separated)";
            break;
            
        case 'cover_collecting_achievement':
            resumeMessage += "What's your biggest professional achievement?";
            break;
            
        case 'cover_collecting_why':
            resumeMessage += "Why are you interested in this role/company? (2-3 sentences)";
            break;
            
        case 'cover_collecting_availability':
            resumeMessage += "When are you available to start? (Immediately / 2 weeks / 1 month / Specific date)";
            break;
            
        case 'awaiting_cover_confirmation':
            resumeMessage += "Please type CONFIRM to proceed or EDIT to make changes.";
            break;
            
        case 'selecting_delivery':
            resumeMessage += "Please select delivery speed: Standard (6h), Express (+MK3,000), Rush (+MK5,000)";
            break;
            
        case 'awaiting_payment':
            resumeMessage += "You have a pending payment. Use /pay to complete it.";
            break;
            
        default:
            resumeMessage += "Type /start to begin or /help for commands.";
            break;
    }
    
    await sendMarkdown(ctx, resumeMessage);
});

// Helper function for missing section prompts (used in smart draft resume)
function getMissingPrompt(section) {
    const prompts = {
        'Full Name': "What's your full name? 📛",
        'Email': "What's your email address? 📧",
        'Phone': "What's your phone number? 📞",
        'Location': "Where are you based? (City, Country) 📍",
        'Physical Address (Optional)': "🏠 Physical address? (Optional)\n\nType 'Skip' to continue.",
        'Nationality (Optional)': "🌍 Nationality? (Optional)\n\nType 'Skip' to continue.",
        'LinkedIn (Optional)': "🔗 LinkedIn URL? (Optional)\n\nType 'Skip' to continue.",
        'GitHub (Optional)': "💻 GitHub URL? (Optional)\n\nType 'Skip' to continue.",
        'Work Experience': "Let's add your work experience. Most recent job title? 💼",
        'Education': "What's your highest qualification? 🎓",
        'Skills': "List your key skills (comma separated) ⚡",
        'Certifications (Optional)': "📜 Any certifications? (Optional)\n\nClick SKIP to continue.",
        'Languages (Optional)': "🌍 What languages do you speak? (Optional)\n\nClick SKIP to continue.",
        'Projects (Optional)': "📁 Any projects you want to showcase? (Optional)\n\nClick SKIP to continue.",
        'Achievements (Optional)': "🏆 What are your key achievements? (Optional)\n\nClick SKIP to continue.",
        'Volunteer Experience (Optional)': "🤝 Any volunteer experience? (Optional)\n\nClick SKIP to continue.",
        'Leadership Roles (Optional)': "👔 Any leadership roles? (Optional)\n\nClick SKIP to continue.",
        'Awards (Optional)': "🏅 Any awards or recognition? (Optional)\n\nClick SKIP to continue.",
        'Publications (Optional)': "📖 Any publications? (Optional)\n\nClick SKIP to continue.",
        'Conferences (Optional)': "🎤 Any conferences attended? (Optional)\n\nClick SKIP to continue.",
        'Interests (Optional)': "💡 What are your interests/hobbies? (Optional)\n\nClick SKIP to continue.",
        'Referees (need 2 more, minimum 2 required)': "Please provide professional referees (minimum 2 required).\n\nReferee 1 - Full name? 👥"
    };
    return prompts[section] || `Please provide your ${section.toLowerCase()}:`;
};

bot.command('confirm', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return await sendMarkdown(ctx, "Usage: /confirm REFERENCE");
    const reference = args[1];
    await handlePaymentConfirmation(ctx, reference);
});

bot.command('test_email', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_CHAT_ID) return await ctx.reply("Unauthorized");
    const result = await notificationService.sendEmail(process.env.EMAIL_USER, 'Test Email from EasySuccor', 'This is a test email to verify your email notification system is working correctly.\n\nIf you received this, email notifications are configured properly!');
    if (result.success) await ctx.reply(`✅ Test email sent successfully to ${process.env.EMAIL_USER}`);
    else await ctx.reply(`❌ Test email failed: ${result.error}`);
});

bot.command('feedback', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const orders = await db.getClientOrders(client.id);
    const lastOrder = orders[orders.length - 1];
    if (lastOrder) await collectFeedback(ctx, client, lastOrder.id);
    else await sendMarkdown(ctx, `You haven't ordered any documents yet. Type /start to create one!`);
});

bot.command('testimonials', async (ctx) => {
    const testimonials = await db.getApprovedTestimonials(10);
    if (testimonials.length === 0) await sendMarkdown(ctx, `No testimonials yet. Be the first to share your success story with /feedback after you get a job! 🎯`);
    else {
        let message = `🌟 *Success Stories*\n\n`;
        for (const t of testimonials) message += `⭐️⭐️⭐️⭐️⭐️ "${t.text}"\n— ${t.name}\n\n`;
        await sendMarkdown(ctx, message);
    }
});

bot.command('reset', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    await db.endSession(client.id);
    await sendMarkdown(ctx, `🔄 *Session reset.* Type /start to begin fresh.`);
});
// ============ SERVICE SELECTION HANDLERS ============
bot.action('service_new', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleServiceSelection(ctx, client, session, 'service_new');
});

bot.action('service_editable', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleServiceSelection(ctx, client, session, 'service_editable');
});

bot.action('service_cover', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleServiceSelection(ctx, client, session, 'service_cover');
});

bot.action('service_editable_cover', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleServiceSelection(ctx, client, session, 'service_editable_cover');
});

bot.action('service_update', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleServiceSelection(ctx, client, session, 'service_update');
});
bot.action('service_new_cv', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleServiceSelection(ctx, client, session, 'service_new');
});

bot.action('service_editable_cv', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleServiceSelection(ctx, client, session, 'service_editable');
});

bot.action('service_cover_letter', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleServiceSelection(ctx, client, session, 'service_cover');
});

bot.action('service_editable_cover', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleServiceSelection(ctx, client, session, 'service_editable_cover');
});

bot.action('prefill_update', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleIntelligentUpdate(ctx, client, session);
});

bot.action('portal_main', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await getOrCreateClient(ctx);
    await showClientPortal(ctx, client);
});
// ============ HANDLE PERSISTENT KEYBOARD BUTTONS ============
bot.hears('📄 New CV', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    session.data.service = 'new cv';
    await handleServiceSelection(ctx, client, session, 'service_new');
});
bot.hears('📝 Editable CV', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    session.data.service = 'editable cv';
    await handleServiceSelection(ctx, client, session, 'service_editable');
});
bot.hears('💌 Cover Letter', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    session.data.service = 'cover letter';
    await handleServiceSelection(ctx, client, session, 'service_cover');
});
bot.hears('📎 Editable Cover Letter', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    session.data.service = 'editable cover letter';
    await handleServiceSelection(ctx, client, session, 'service_editable_cover');
});
bot.hears('✏️ Update CV', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleIntelligentUpdate(ctx, client, session);
});
bot.hears('📎 Upload Draft', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    const session = await getOrCreateSession(client.id);
    await handleBuildMethod(ctx, client, session, 'build_draft');
});
bot.hears('ℹ️ About', async (ctx) => {
    await ctx.reply(`📄 *EasySuccor - Professional CVs*\n\nContact: +265 991 295 401\nWhatsApp: +265 881 193 707\n\n*Services:*\n• New CV - MK6,000 - MK10,000\n• Editable CV - MK8,000 - MK12,000\n• Cover Letter - MK5,000 - MK6,000\n• Editable Cover Letter - MK8,000\n• CV Update - MK3,000 - MK6,000`, { parse_mode: 'Markdown' });
});
bot.hears('📞 Contact', async (ctx) => {
    await ctx.reply(`📞 *Contact*\n\nAirtel: 0991295401\nTNM: 0886928639\nWhatsApp: +265 881 193 707`, { parse_mode: 'Markdown' });
});
bot.hears('🏠 Portal', async (ctx) => {
    const client = await getOrCreateClient(ctx);
    await showClientPortal(ctx, client);
});

bot.help(async (ctx) => {
    await sendMarkdown(ctx, `🆘 *HELP CENTER*\n\n${SEP}\n📋 *COMMANDS*\n${SEP}\n/start - Begin or restart\n/resume - Continue paused session\n/pause - Save progress and pause\n/pay - Make a payment\n/confirm REF - Confirm payment\n/portal - Your dashboard\n/mydocs - Your documents\n/versions - View CV versions\n/referral - Share & earn\n/feedback - Share your experience\n/testimonials - See success stories\n/reset - Reset current session\n/help - Show this help\n\n${SEP}\n📞 *CONTACT*\n${SEP}\nPhone: +265 991 295 401\nWhatsApp: +265 881 193 707\nEmail: ${process.env.EMAIL_USER}\n\n${SEP}\n🌐 *WEBSITE*\n${SEP}\n${process.env.WEBHOOK_URL || 'https://easysuccor-bot-production.up.railway.app'}\n\nWe're here to help! 💙`);
});

bot.command('extend', async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    const orders = await db.getClientOrders(client.id);
    const activeInstallment = orders.find(o => o.payment_type === 'installment' && o.installment_status === 'active');
    if (!activeInstallment) return ctx.reply('❌ No active installment plan found.');
    const result = await installmentTracker.requestExtension(activeInstallment.id, ctx);
    if (result.success) await ctx.reply(result.message, { parse_mode: 'Markdown' });
    else await ctx.reply(`❌ ${result.error}`, { parse_mode: 'Markdown' });
});

bot.command('report', async (ctx) => {
    const client = await db.getClient(ctx.from.id);
    await ctx.reply(`🐛 *Report a Bug*\n\n${SEP}\n📸 *How to Report*\n${SEP}\n1️⃣ Take a screenshot of the issue\n2️⃣ Send the screenshot here with a brief description\n3️⃣ We'll investigate and notify you when fixed!\n\n*Please describe what happened:*\n(Type your description or click Cancel)`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[ { text: "❌ Cancel", callback_data: "report_cancel" } ]] }
    });
    const session = await db.getActiveSession(client.id);
    if (session) { session.data.awaiting_report = true; await db.updateSession(session.id, session.stage, session.current_section, session.data); }
    else await db.saveSession(client.id, 'awaiting_report', null, { awaiting_report: true }, 0);
});

bot.action('report_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    const client = await db.getClient(ctx.from.id);
    const session = await db.getActiveSession(client.id);
    if (session?.data?.awaiting_report) { session.data.awaiting_report = false; await db.updateSession(session.id, session.stage, session.current_section, session.data); }
    await ctx.editMessageText('❌ Report cancelled. Type /report if you need to report an issue later.');
});

bot.on('text', async (ctx, next) => {
    const client = await db.getClient(ctx.from.id);
    if (!client) return next();
    
    const session = await db.getActiveSession(client.id);
    if (!session) return next();
    
    // Ensure session.data is an object (already done in getOrCreateSession, but double-check)
    if (typeof session.data === 'string') {
        try { session.data = JSON.parse(session.data); } catch(e) { session.data = {}; }
    }
    
    // 1. Awaiting hire story (from /hired command)
    if (session.data?.awaiting_hire_story && !ctx.message.text.startsWith('/')) {
        const story = ctx.message.text;
        const isAnonymous = session.data.hire_anonymous || false;
        await db.saveTestimonial({
            client_id: client.id,
            name: isAnonymous ? 'Anonymous' : (client.first_name || 'Valued Client'),
            text: story,
            rating: 5,
            position: 'Hired Client',
            approved: false,
            is_hire_story: true,
            anonymous: isAnonymous
        });
        session.data.awaiting_hire_story = false;
        session.data.hire_anonymous = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
        await ctx.reply(`🌟 *Thank You for Sharing Your Success!*\n\n${SEP}\nYour story will inspire countless others on their career journey.\n${SEP}\nWe're truly honored to have been part of your success. Wishing you continued growth and achievement!\n\n🤝 With gratitude,\nThe EasySuccor Team`, { parse_mode: 'Markdown' });
        await db.logAdminAction({ admin_id: 'system', action: 'client_hired', details: `Client ${client.first_name || 'Anonymous'} reported getting hired. Story: ${story.substring(0, 100)}` });
        const adminChatId = process.env.ADMIN_CHAT_ID;
        if (adminChatId) {
            await bot.telegram.sendMessage(adminChatId, `🎉 *Client Got Hired!*\n\nClient: ${isAnonymous ? 'Anonymous' : (client.first_name || 'Unknown')}\nStory: ${story}\n\nUse /approve_testimonial to review.`, { parse_mode: 'Markdown' });
        }
        return;
    }
    
    // 2. Awaiting bug report
    if (session.data?.awaiting_report && !ctx.message.text.startsWith('/')) {
        session.data.report_description = ctx.message.text;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
        await ctx.reply(`📝 *Description saved!*\n\nNow please send the screenshot of the issue.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[ { text: "❌ Cancel", callback_data: "report_cancel" } ]] }
        });
        return;
    }
    
    // 3. Portfolio collection (user types links or 'skip')
    if (session.stage === 'collecting_portfolio' && !ctx.message.text.startsWith('/')) {
        await handlePortfolioCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 4. Personal information collection
    if (session.stage === 'collecting_personal' && !ctx.message.text.startsWith('/')) {
        await handlePersonalCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 5. Education collection
    if (session.stage === 'collecting_education' && !ctx.message.text.startsWith('/')) {
        await handleEducationCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 6. Skills collection
    if (session.stage === 'collecting_skills' && !ctx.message.text.startsWith('/')) {
        await handleSkillsCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 7. Certifications collection
    if (session.stage === 'collecting_certifications' && !ctx.message.text.startsWith('/')) {
        await handleCertificationsCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 8. Projects collection
    if (session.stage === 'collecting_projects' && !ctx.message.text.startsWith('/')) {
        await handleProjectsCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 9. Achievements collection
    if (session.stage === 'collecting_achievements' && !ctx.message.text.startsWith('/')) {
        await handleAchievementsCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 10. Volunteer collection
    if (session.stage === 'collecting_volunteer' && !ctx.message.text.startsWith('/')) {
        await handleVolunteerCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 11. Leadership collection
    if (session.stage === 'collecting_leadership' && !ctx.message.text.startsWith('/')) {
        await handleLeadershipCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 12. Awards collection
    if (session.stage === 'collecting_awards' && !ctx.message.text.startsWith('/')) {
        await handleAwardsCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 13. Publications collection
    if (session.stage === 'collecting_publications' && !ctx.message.text.startsWith('/')) {
        await handlePublicationsCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 14. Conferences collection
    if (session.stage === 'collecting_conferences' && !ctx.message.text.startsWith('/')) {
        await handleConferencesCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 15. Interests collection
    if (session.stage === 'collecting_interests' && !ctx.message.text.startsWith('/')) {
        await handleInterestsCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 16. Missing sections (smart draft)
    if (session.stage === 'collecting_missing' && !ctx.message.text.startsWith('/')) {
        await smartDraft.handleMissingCollection(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 17. Cover letter questions (position, company, etc.)
    if (session.stage === 'cover_collecting_position' && !ctx.message.text.startsWith('/')) {
        await handleCoverPosition(ctx, client, session, ctx.message.text);
        return;
    }
    if (session.stage === 'cover_collecting_company' && !ctx.message.text.startsWith('/')) {
        await handleCoverCompany(ctx, client, session, ctx.message.text);
        return;
    }
    if (session.stage === 'cover_collecting_experience' && !ctx.message.text.startsWith('/')) {
        await handleCoverExperience(ctx, client, session, ctx.message.text);
        return;
    }
    if (session.stage === 'cover_collecting_skills' && !ctx.message.text.startsWith('/')) {
        await handleCoverSkills(ctx, client, session, ctx.message.text);
        return;
    }
    if (session.stage === 'cover_collecting_achievement' && !ctx.message.text.startsWith('/')) {
        await handleCoverAchievement(ctx, client, session, ctx.message.text);
        return;
    }
    if (session.stage === 'cover_collecting_why' && !ctx.message.text.startsWith('/')) {
        await handleCoverWhy(ctx, client, session, ctx.message.text);
        return;
    }
    if (session.stage === 'cover_collecting_availability_specific' && !ctx.message.text.startsWith('/')) {
        await handleCoverAvailabilitySpecific(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 18. Awaiting cover confirmation (CONFIRM / EDIT)
    if (session.stage === 'awaiting_cover_confirmation' && !ctx.message.text.startsWith('/')) {
        await handleCoverConfirmation(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 19. Editing cover letter (if user typed EDIT)
    if (session.stage === 'editing_cover' && !ctx.message.text.startsWith('/')) {
        // You may implement editing logic; for now just acknowledge
        await sendMarkdown(ctx, `✅ Changes saved. Please type CONFIRM to proceed.`);
        session.data.editing_cover = false;
        await db.updateSession(session.id, 'awaiting_cover_confirmation', 'cover', session.data);
        return;
    }
    
    // 20. Awaiting vacancy upload (text input for vacancy)
    if (session.stage === 'awaiting_vacancy_upload' && !ctx.message.text.startsWith('/')) {
        await handleVacancyText(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 21. Awaiting update request (intelligent update)
    if (session.stage === 'awaiting_update_request' && !ctx.message.text.startsWith('/')) {
        await handleUpdateRequest(ctx, client, session, ctx.message.text);
        return;
    }
    
    // 22. Awaiting confirmation (summary confirmation)
    if (session.stage === 'awaiting_confirmation' && !ctx.message.text.startsWith('/')) {
        if (ctx.message.text.toUpperCase() === 'CONFIRM') {
            // Proceed to payment
            const totalCharge = session.data.total_charge;
            const paymentReference = generatePaymentReference();
            session.data.payment_reference = paymentReference;
            await db.updateSession(session.id, session.stage, session.current_section, session.data);
            await showPaymentOptions(ctx, session.data.order_id || 'PENDING', totalCharge, paymentReference);
        } else if (ctx.message.text.toUpperCase().startsWith('EDIT')) {
            await sendMarkdown(ctx, `What would you like to change? Type the section name (personal, employment, education, skills, etc.)`);
            session.data.editing_cv = true;
            await db.updateSession(session.id, 'editing_cv', 'summary', session.data);
        } else {
            await sendMarkdown(ctx, `Please type *CONFIRM* to proceed or *EDIT* to make changes.`);
        }
        return;
    }
    
    // 23. Awaiting testimonial text (after rating)
    if (session.data?.awaiting_testimonial_text && !ctx.message.text.startsWith('/')) {
        await db.saveTestimonial({
            client_id: client.id,
            name: client.first_name,
            rating: 5,
            text: ctx.message.text,
            approved: false
        });
        session.data.awaiting_testimonial_text = false;
        await db.updateSession(session.id, session.stage, session.current_section, session.data);
        await ctx.reply(`✅ Thank you for your testimonial! It will be reviewed and published soon.`);
        return;
    }
    
    // If none of the above match, let other handlers process (e.g., commands)
    return next();
});

// ============ START BOT ============
async function startBot() {
    console.log('🚀 Starting EasySuccor Bot...');
    try { await db.initDatabase(); console.log('✅ Database initialized successfully'); } catch (dbError) { console.error('❌ Database initialization failed:', dbError.message); process.exit(1); }

    console.log('🔍 Verifying DeepSeek API connection...');
    try {
        const { OpenAI } = require('openai');
        const deepseek = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/v1' });
        const testResponse = await deepseek.chat.completions.create({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'Say "API OK"' }], max_tokens: 10 });
        console.log('✅ DeepSeek API connected:', testResponse.choices[0].message.content);
    } catch (deepseekError) { console.error('❌ DeepSeek API connection failed:', deepseekError.message); console.log('⚠️ Bot will run but CV extraction will use fallback mode'); }

    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🚀 Begin your journey' },
            { command: 'resume', description: '▶️ Resume where you left off' },
            { command: 'pause', description: '⏸️ Save and pause session' },
            { command: 'pay', description: '💰 Make a payment' },
            { command: 'portal', description: '🏠 Your client dashboard' },
            { command: 'mydocs', description: '📄 View your documents' },
            { command: 'versions', description: '📁 CV version history' },
            { command: 'referral', description: '🎁 Refer friends, earn credit' },
            { command: 'feedback', description: '⭐ Leave feedback' },
            { command: 'testimonials', description: '🌟 Read success stories' },
            { command: 'website', description: '🌐 Visit our Home Page' },
            { command: 'report', description: '🐛 Report an issue' },
            { command: 'thankyou', description: '🙏 We appreciate you' },
            { command: 'hired', description: '🎉 Report you got hired!' },
            { command: 'help', description: '🆘 Get help' },
            { command: 'reset', description: '🔄 Start fresh' },
            { command: 'admin_orders', description: '📋 View all orders' },
            { command: 'admin_clients', description: '👥 View all clients' },
            { command: 'admin_price', description: '💲 Update pricing' },
            { command: 'admin_deepseek', description: '🧠 Check AI status' },
            { command: 'reports', description: '🐛 View error reports' },
            { command: 'appreciate', description: '💝 Send appreciation' },
            { command: 'health', description: '🩺 System health' }
        ]);
        console.log('✅ Bot commands registered');
    } catch (cmdError) { console.log('⚠️ Could not set commands:', cmdError.message); }

    const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://easysuccor-bot-production.up.railway.app';
    const webhookPath = '/webhook';
    const fullWebhookUrl = `${WEBHOOK_URL}${webhookPath}`;

    // Retry webhook setting
    let webhookSet = false;
    let retries = 0;
    while (!webhookSet && retries < 3) {
        try {
            await bot.telegram.deleteWebhook();
            await bot.telegram.setWebhook(fullWebhookUrl, { allowed_updates: ['message', 'callback_query', 'inline_query'] });
            console.log(`✅ Webhook set to ${fullWebhookUrl}`);
            webhookSet = true;
        } catch (webhookError) {
            console.error(`❌ Webhook attempt ${retries + 1} failed:`, webhookError.message);
            retries++;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    if (!webhookSet) {
        console.error('❌ Could not set webhook after 3 attempts. Falling back to polling.');
        bot.launch();
    }

    app.post(webhookPath, (req, res) => { try { bot.handleUpdate(req.body, res); } catch (handleError) { console.error('Webhook handle error:', handleError.message); res.status(500).send('Error processing update'); } });

    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`✅ EasySuccor Express Server Started`);
        console.log(`${'='.repeat(60)}`);
        console.log(`🌐 Home Page:    http://0.0.0.0:${PORT}/`);
        console.log(`🔐 Admin panel:     http://0.0.0.0:${PORT}/admin`);
        console.log(`❤️  Health check:    http://0.0.0.0:${PORT}/health`);
        console.log(`🤖 DeepSeek status: http://0.0.0.0:${PORT}/api/deepseek-status`);
        console.log(`${'='.repeat(60)}`);
        console.log(`📤 Admin upload endpoints:`);
        console.log(`   POST /admin/upload-cv`);
        console.log(`   POST /admin/upload-batch`);
        console.log(`   POST /admin/upload-cover`);
        console.log(`🔑 Admin API Key required in header: x-admin-key`);
        console.log(`${'='.repeat(60)}\n`);
    });

    // ============ KEEP-ALIVE: Self-ping every 5 minutes ============
    const cron = require('node-cron');
    const axios = require('axios');
    cron.schedule('*/5 * * * *', async () => {
        try {
            const url = `http://localhost:${PORT}/health`;
            await axios.get(url);
            console.log(`✅ Keep-alive ping sent at ${new Date().toISOString()}`);
        } catch (err) {
            console.error('❌ Keep-alive ping failed:', err.message);
        }
    });

    // Keep event loop busy 
    setInterval(() => { const now = Date.now(); }, 60000);

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    🤖 EASYSUCCOR BOT RUNNING                    ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('║  ✅ NO welcome message - Direct to category selection          ║');
    console.log('║  ✅ AI generates professional summary (DeepSeek)               ║');
    console.log('║  ✅ Clickable buttons for all user choices                     ║');
    console.log('║  ✅ MO626 payment method added                                 ║');
    console.log('║  ✅ Health check endpoint: /health                             ║');
    console.log('║  ✅ Home Page: / (index.html)                                  ║');
    console.log('║  ✅ Admin panel: /admin.html                                   ║');
    console.log('║  ✅ 18+ CV categories fully supported                          ║');
    console.log('║  ✅ Admin full control (delete, clear, price update)           ║');
    console.log('║  ✅ Email notifications (priority) + Telegram backup           ║');
    console.log('║  ✅ Installment plans & Pay Later options                      ║');
    console.log('║  ✅ Referral program & Testimonials                            ║');
    console.log('║  ✅ CV Versioning & Intelligent Update                         ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  🕐 Started at: ${new Date().toLocaleString()}                    ║`);
    console.log(`║  🌐 Webhook URL: ${WEBHOOK_URL}                                  ║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

   // Prevent Railway from stopping the container – do NOT exit
process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM received – ignoring to keep container alive');
    // Do nothing – container stays up
});

// For local development (Ctrl+C) – exit gracefully
process.on('SIGINT', async () => {
    console.log('\n🛑 SIGINT received – shutting down for local testing');
    try { await bot.telegram.deleteWebhook(); } catch (e) {}
    process.exit(0);
});
}

startBot().catch(console.error);