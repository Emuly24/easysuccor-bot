// health.js - Health check server for Railway
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        bot: 'EasySuccor',
        version: '5.0.0'
    });
});

app.get('/', (req, res) => {
    res.redirect('https://t.me/EasySuccor_bot');
});

app.listen(PORT, () => {
    console.log(`🏥 Health check server running on port ${PORT}`);
});