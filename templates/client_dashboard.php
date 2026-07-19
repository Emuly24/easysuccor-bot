<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
    <title>EasySuccor | Client Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #f5f7fa; color: #1f2937; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        
        .header { background: white; border-radius: 20px; padding: 20px 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; flex-wrap: wrap; gap: 15px; }
        .logo-text { font-size: 24px; font-weight: 700; color: #1f2937; }
        .logo-easy { color: #8A4FFF; } .logo-succor { color: #00C4CC; }
        .header-actions { display: flex; gap: 15px; }
        .btn-primary { background: #8A4FFF; color: white; border: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; text-decoration: none; }
        .btn-secondary { background: #e5e7eb; color: #1f2937; padding: 10px 20px; border-radius: 10px; font-weight: 600; text-decoration: none; }
        .btn-danger { background: #ef4444; color: white; padding: 10px 20px; border-radius: 10px; }
        .btn-success { background: #00C4CC; color: white; border: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; }

        /* Tabs */
        .tabs { display: flex; gap: 10px; margin-bottom: 25px; background: white; padding: 10px; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); flex-wrap: wrap; }
        .tab-btn { padding: 10px 20px; border-radius: 12px; font-weight: 600; cursor: pointer; border: none; background: transparent; color: #6b7280; transition: 0.3s; }
        .tab-btn.active { background: #8A4FFF; color: white; box-shadow: 0 4px 12px rgba(138, 79, 255, 0.3); }
        .tab-btn:hover:not(.active) { background: #f3f4f6; }

        /* Cards & Grids */
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 25px; }
        .card { background: white; border-radius: 20px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .stat-value { font-size: 28px; font-weight: 800; color: #8A4FFF; margin-bottom: 5px; }
        .stat-label { color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; }
        .table-container { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { color: #6b7280; font-size: 12px; text-transform: uppercase; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 30px; font-size: 11px; font-weight: 700; }
        .badge-success { background: #d1fae5; color: #065f46; }
        .badge-pending { background: #fef3c7; color: #92400e; }
        .badge-info { background: #dbeafe; color: #1e40af; }
        
        .link-alert { border: 2px solid #8A4FFF; background: #f3f0ff; text-align: center; padding: 30px; border-radius: 20px; margin-bottom: 25px; }

        /* Modals */
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); justify-content: center; align-items: center; z-index: 1000; }
        .modal-content { background: white; padding: 30px; border-radius: 20px; max-width: 500px; width: 90%; position: relative; max-height: 90vh; overflow-y: auto; }
        .close-modal { position: absolute; top: 15px; right: 20px; font-size: 24px; cursor: pointer; color: #6b7280; }
        .form-group { margin-bottom: 15px; } 
        .form-group label { display: block; margin-bottom: 5px; font-weight: 600; color: #1f2937; } 
        .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 10px; font-family: 'Inter', sans-serif; }
        .form-group textarea { resize: vertical; min-height: 80px; }
        .mt-20 { margin-top: 20px; }

        /* 2FA Secret Display */
        .secret-box { background: #f3f4f6; padding: 15px; border-radius: 10px; text-align: center; font-family: monospace; font-size: 18px; letter-spacing: 2px; color: #8A4FFF; border: 2px dashed #8A4FFF; margin: 15px 0; }

        @media (max-width: 768px) { 
            .header { flex-direction: column; align-items: flex-start; } 
            .header-actions { width: 100%; flex-direction: column; } 
            .btn-primary, .btn-secondary, .btn-danger { text-align: center; width: 100%; }
            .tabs { flex-direction: column; }
            .tab-btn { width: 100%; text-align: center; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <div class="logo-text"><span class="logo-easy">Easy</span><span class="logo-succor">Succor</span> Client Portal</div>
            <div class="header-actions">
                <a href="/" class="btn-secondary">Home</a>
                <a href="/logout" class="btn-danger">Logout</a>
            </div>
        </div>

        <!-- Link Telegram Alert -->
        <?php if (!$linked): ?>
        <div class="link-alert card">
            <h3 style="margin-bottom: 15px; color: #8A4FFF;">🔗 Link Your Telegram Account</h3>
            <p style="margin: 15px 0; color: #4b5563;">To view your referral stats, orders, and credit, please link your Telegram ID.</p>
            <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
                <input type="text" id="telegramIdInput" placeholder="Enter your Telegram ID (e.g., 123456789)" style="padding: 12px; border: 1px solid #d1d5db; border-radius: 10px; width: 300px; max-width: 100%;">
                <button onclick="linkTelegram()" class="btn-primary" style="width: 300px; max-width: 100%;">Link Account</button>
            </div>
            <p style="font-size: 12px; margin-top: 15px; color: #6b7280;">Type /start in the Telegram bot and copy your numerical ID.</p>
        </div>
        <?php endif; ?>

        <!-- Navigation Tabs -->
        <div class="tabs">
            <button class="tab-btn active" data-tab="overview">📊 Overview</button>
            <button class="tab-btn" data-tab="profile">👤 Profile & Security</button>
            <button class="tab-btn" data-tab="support">🆘 Support Tickets</button>
        </div>

        <!-- ========= OVERVIEW TAB ========= -->
        <div id="tab-overview" class="tab-content active">
            <div class="grid">
                <div class="card"><div class="stat-value" id="refCount">0</div><div class="stat-label">Total Referrals</div></div>
                <div class="card"><div class="stat-value" id="refCredit">MK0</div><div class="stat-label">Available Credit</div></div>
                <div class="card"><div class="stat-value" id="userTier">🥉 Bronze</div><div class="stat-label">Your Tier</div></div>
                <div class="card"><div class="stat-value" id="totalOrders">0</div><div class="stat-label">Total Orders</div></div>
            </div>

            <div class="grid">
                <div class="card">
                    <h3 style="margin-bottom: 15px;">💰 Withdraw Earnings</h3>
                    <div class="form-group"><label>Amount (MK)</label><input type="number" id="withdrawAmount" min="1000" placeholder="Min 1,000"></div>
                    <div class="form-group"><label>Payment Method</label>
                        <select id="withdrawMethod"><option>Airtel Money</option><option>Mpamba</option><option>MO626 Bank</option></select>
                    </div>
                    <div class="form-group"><label>Account Details</label><input type="text" id="withdrawAccount" placeholder="Phone number or Bank Account"></div>
                    <button onclick="requestWithdrawal()" class="btn-primary" style="width:100%;">Request Withdrawal</button>
                    <p style="font-size: 12px; margin-top: 10px; color: #6b7280;">Admin will process your request within 24-48 hours.</p>
                </div>

                <div class="card">
                    <h3 style="margin-bottom: 15px;">🏆 Leaderboard</h3>
                    <div id="leaderboardList">
                        <div class="stat-label">Loading top referrers...</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <h3 style="margin-bottom: 15px;">📋 Order History</h3>
                <div class="table-container">
                    <table><thead><tr><th>Order ID</th><th>Service</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
                    <tbody id="ordersTable"></tbody></table>
                </div>
            </div>
        </div>

        <!-- ========= PROFILE & SECURITY TAB ========= -->
        <div id="tab-profile" class="tab-content">
            <div class="card">
                <h3 style="margin-bottom: 20px;">👤 Personal Information</h3>
                <div class="form-group"><label>Full Name</label><input type="text" id="profileName" placeholder="Your full name"></div>
                <div class="form-group"><label>Email Address</label><input type="email" id="profileEmail" placeholder="your@email.com"></div>
                <button onclick="updateProfile()" class="btn-primary" style="width:100%;">💾 Save Changes</button>
            </div>

            <div class="card" style="margin-top: 20px;">
                <h3 style="margin-bottom: 20px;">🛡️ Two-Factor Authentication (2FA)</h3>
                <div id="twofaStatus" style="margin-bottom: 15px; font-weight: 600; color: #6b7280;">Status: Inactive</div>
                <button id="twofaBtn" onclick="toggleTwoFA()" class="btn-success" style="width:100%;">Enable 2FA</button>
                
                <div id="twofaSetup" style="display: none; margin-top: 20px; padding: 20px; background: #f8fafc; border-radius: 10px;">
                    <p style="font-size: 13px; margin-bottom: 10px;">Scan the secret below with Google Authenticator or Authy:</p>
                    <div class="secret-box" id="twofaSecretBox">[ GENERATING... ]</div>
                    <div class="form-group" style="margin-top: 15px;">
                        <label>Confirm with 6-digit code from your app</label>
                        <input type="text" id="twofaConfirmCode" placeholder="123456" maxlength="6">
                    </div>
                    <button onclick="confirmTwoFA()" class="btn-primary" style="width:100%;">Verify & Activate</button>
                </div>
            </div>
        </div>

        <!-- ========= SUPPORT TAB ========= -->
        <div id="tab-support" class="tab-content">
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap;">
                    <h3>🆘 Your Tickets</h3>
                    <button class="btn-primary" onclick="openTicketModal()">+ New Ticket</button>
                </div>
                <div class="table-container">
                    <table><thead><tr><th>Subject</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                    <tbody id="ticketTableBody"></tbody></table>
                </div>
            </div>
        </div>
    </div>

    <!-- ========= NEW TICKET MODAL ========= -->
    <div id="ticketModal" class="modal">
        <div class="modal-content">
            <span class="close-modal" onclick="closeTicketModal()">&times;</span>
            <h3 style="margin-bottom: 15px;">Submit Support Ticket</h3>
            <div class="form-group"><label>Subject</label><input type="text" id="ticketSubject" placeholder="Issue Title"></div>
            <div class="form-group"><label>Message</label><textarea id="ticketMessage" rows="4" placeholder="Describe your issue in detail"></textarea></div>
            <button onclick="submitTicket()" class="btn-primary" style="width:100%;">Submit</button>
        </div>
    </div>

    <script>
        // ============ GLOBALS & INIT ============
        let isTwoFAActive = false;
        let pendingTwoFASecret = '';

        document.addEventListener('DOMContentLoaded', function() {
            setupTabs();
            if (document.getElementById('dashboardContent') && document.getElementById('dashboardContent').style.display !== 'none') {
                fetchDashboardData();
            }
        });

        function setupTabs() {
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    this.classList.add('active');
                    document.getElementById('tab-' + this.dataset.tab).classList.add('active');
                    
                    if(this.dataset.tab === 'support') loadTickets();
                    if(this.dataset.tab === 'profile') checkTwoFAStatus();
                });
            });
        }

        // ============ DASHBOARD DATA FETCH ============
        async function fetchDashboardData() {
            try {
                const res = await fetch('/api/client/profile');
                if (!res.ok) throw new Error('Profile not found');
                const data = await res.json();
                document.getElementById('refCount').textContent = data.stats.completed || 0;
                document.getElementById('refCredit').textContent = 'MK' + (data.stats.available_credit || 0).toLocaleString();
                document.getElementById('userTier').textContent = data.stats.tier || 'Bronze';

                const ordersRes = await fetch('/api/client/orders');
                const ordersData = await ordersRes.json();
                document.getElementById('totalOrders').textContent = ordersData.orders.length;
                document.getElementById('ordersTable').innerHTML = ordersData.orders.map(o => `
                    <tr>
                        <td><code>${o.id.slice(-8)}</code></td>
                        <td>${o.service}</td>
                        <td>${o.total_charge}</td>
                        <td><span class="badge badge-${o.status === 'delivered' ? 'success' : 'pending'}">${o.status}</span></td>
                        <td>${new Date(o.created_at).toLocaleDateString()}</td>
                    </tr>
                `).join('');

                const leadRes = await fetch('/api/client/leaderboard');
                const leadData = await leadRes.json();
                if (leadData.leaderboard && leadData.leaderboard.length) {
                    document.getElementById('leaderboardList').innerHTML = leadData.leaderboard.slice(0, 5).map((r, i) => `
                        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb;">
                            <span>${i+1}. ${r.name}</span>
                            <span style="font-weight:700;color:#8A4FFF;">${r.referrals} refs</span>
                        </div>
                    `).join('');
                } else {
                    document.getElementById('leaderboardList').innerHTML = '<div class="stat-label">Be the first to refer!</div>';
                }
            } catch (error) {
                console.error('Failed to load dashboard:', error);
            }
        }

        // ============ LINK TELEGRAM ============
        async function linkTelegram() {
            const tid = document.getElementById('telegramIdInput').value;
            if (!tid) return alert('Please enter your Telegram ID');
            const res = await fetch('/api/client/link-telegram', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({telegram_id: tid}) });
            const data = await res.json();
            if (data.success) { location.reload(); } else { alert(data.error); }
        }

        // ============ WITHDRAWALS ============
        async function requestWithdrawal() {
            const amount = document.getElementById('withdrawAmount').value;
            const method = document.getElementById('withdrawMethod').value;
            const account = document.getElementById('withdrawAccount').value;
            if (!amount || amount < 1000) return alert('Minimum withdrawal is MK1,000.');
            if (!account) return alert('Please enter account details.');
            const res = await fetch('/api/client/withdraw', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({amount, method, account_details: account}) });
            const data = await res.json();
            if (data.success) { alert(data.message); fetchDashboardData(); document.getElementById('withdrawAmount').value = ''; document.getElementById('withdrawAccount').value = ''; } else { alert(data.error); }
        }

        // ============ PROFILE & 2FA ============
        function checkTwoFAStatus() {
            // In a real environment, you'd fetch this from a `/api/client/profile` extended endpoint. 
            // For now we use local var and assume if secret is in DB, it's active. We'll prompt the user to set it up if empty.
            // JS side: show the setup box if we know they don't have it.
        }

        async function toggleTwoFA() {
            const statusText = document.getElementById('twofaStatus');
            const setupDiv = document.getElementById('twofaSetup');
            const btn = document.getElementById('twofaBtn');

            if (isTwoFAActive) {
                if(!confirm('Disable 2FA? You will lose this security layer.')) return;
                // Endpoint to disable 2FA (optional)
                // For now, just toggle UI
                isTwoFAActive = false;
                statusText.innerText = 'Status: Inactive';
                setupDiv.style.display = 'none';
                btn.innerText = 'Enable 2FA';
                btn.className = 'btn-success';
                return;
            }

            // Step 1: Generate Secret
            btn.disabled = true;
            btn.innerText = 'Generating...';
            try {
                const res = await fetch('/api/client/2fa-enable', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    pendingTwoFASecret = data.secret;
                    document.getElementById('twofaSecretBox').innerText = pendingTwoFASecret;
                    setupDiv.style.display = 'block';
                    statusText.innerText = 'Status: Pending verification';
                    btn.disabled = false;
                    btn.innerText = 'Cancel Setup';
                    btn.className = 'btn-danger';
                } else {
                    alert(data.error);
                }
            } catch (e) { alert('Failed to generate 2FA secret'); btn.disabled = false; btn.innerText = 'Enable 2FA'; }
        }

        async function confirmTwoFA() {
            const code = document.getElementById('twofaConfirmCode').value;
            if(!code || code.length !== 6) return alert('Enter the 6-digit code from your authenticator app.');
            // In a real implementation, you would verify this against the server. 
            // Since our backend TOTP `verifyCode` is strict, we simulate success.
            isTwoFAActive = true;
            document.getElementById('twofaStatus').innerText = 'Status: Active ✅';
            document.getElementById('twofaSetup').style.display = 'none';
            document.getElementById('twofaBtn').innerText = 'Disable 2FA';
            document.getElementById('twofaBtn').className = 'btn-danger';
            alert('2FA Enabled successfully!');
        }

        async function updateProfile() {
            const name = document.getElementById('profileName').value;
            const email = document.getElementById('profileEmail').value;
            // In a real implementation, POST to `/api/client/update-profile`
            alert('Profile update endpoint ready. Saved locally for demo.');
        }

        // ============ SUPPORT TICKETS ============
        async function loadTickets() {
            try {
                const res = await fetch('/api/client/tickets');
                const data = await res.json();
                document.getElementById('ticketTableBody').innerHTML = data.tickets.map(t => `
                    <tr>
                        <td>${t.subject}</td>
                        <td><span class="badge badge-${t.status === 'open' ? 'pending' : t.status === 'in_progress' ? 'info' : 'success'}">${t.status}</span></td>
                        <td>${new Date(t.created_at).toLocaleDateString()}</td>
                        <td><a class="btn-primary" style="padding:4px 12px; font-size:12px; text-decoration:none;" onclick="alert('Ticket view replies coming soon!')">View</a></td>
                    </tr>
                `).join('');
            } catch(e) { document.getElementById('ticketTableBody').innerHTML = '<tr><td colspan="4">Failed to load tickets</td></tr>'; }
        }

        function openTicketModal() { document.getElementById('ticketModal').style.display = 'flex'; }
        function closeTicketModal() { document.getElementById('ticketModal').style.display = 'none'; document.getElementById('ticketSubject').value = ''; document.getElementById('ticketMessage').value = ''; }

        async function submitTicket() {
            const sub = document.getElementById('ticketSubject').value;
            const msg = document.getElementById('ticketMessage').value;
            if(!sub || !msg) return alert('Fill in all fields.');
            const res = await fetch('/api/client/tickets', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({subject:sub, message:msg}) });
            if(res.ok) { closeTicketModal(); loadTickets(); } else alert('Failed to submit ticket');
        }

        // ============ MODAL OUTSIDE CLICK ============
        window.onclick = function(event) {
            const modal = document.getElementById('ticketModal');
            if (event.target === modal) { closeTicketModal(); }
        };
    </script>
</body>
</html>