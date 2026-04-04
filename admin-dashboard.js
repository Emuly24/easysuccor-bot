// admin-dashboard.js - Success Metrics Dashboard
const db = require('./database');
const cron = require('node-cron');

class AdminDashboard {
  constructor() {
    this.stats = {};
  }

  async refreshStats() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];

    // Get all orders
    const allOrders = await db.getAllOrders();
    const todayOrders = allOrders.filter(o => o.created_at.split('T')[0] === today);
    const monthOrders = allOrders.filter(o => o.created_at >= firstDayOfMonth);
    
    // Get all clients
    const allClients = await db.getAllClients();
    const newClientsMonth = allClients.filter(c => c.created_at >= firstDayOfMonth);
    
    // Get all feedback
    const allFeedback = await db.getAllFeedback();
    const recentFeedback = allFeedback.filter(f => f.created_at >= thirtyDaysAgo);
    
    // Calculate average rating
    const avgRating = recentFeedback.length > 0 
      ? recentFeedback.reduce((sum, f) => sum + f.rating, 0) / recentFeedback.length 
      : 0;
    
    // Calculate returning clients
    const returningClients = allClients.filter(c => c.total_orders > 1);
    
    // Most requested service
    const serviceCount = {};
    allOrders.forEach(o => {
      serviceCount[o.service] = (serviceCount[o.service] || 0) + 1;
    });
    const mostRequested = Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0];
    
    // Calculate revenue
    const todayRevenue = todayOrders.reduce((sum, o) => sum + this.parseAmount(o.total_charge), 0);
    const monthRevenue = monthOrders.reduce((sum, o) => sum + this.parseAmount(o.total_charge), 0);
    
    this.stats = {
      today: {
        orders: todayOrders.length,
        completed: todayOrders.filter(o => o.status === 'completed').length,
        pending: todayOrders.filter(o => o.status === 'pending').length,
        revenue: todayRevenue
      },
      month: {
        clients: newClientsMonth.length,
        returning: returningClients.length,
        returning_percentage: Math.round((returningClients.length / allClients.length) * 100),
        avg_rating: avgRating.toFixed(1),
        most_requested: mostRequested ? mostRequested[0] : 'None',
        most_requested_count: mostRequested ? mostRequested[1] : 0,
        revenue: monthRevenue
      }
    };
    
    return this.stats;
  }

  parseAmount(amount) {
    if (!amount) return 0;
    return parseInt(amount.replace('MK', '').replace(',', ''));
  }

  formatStats() {
    return `
╔══════════════════════════════════════════════════════════════════╗
║                    📊 EASYSUCCOR DASHBOARD                       ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  📅 TODAY'S STATS                                                ║
║  ─────────────────────────────────────────────────────────────── ║
║  • Orders received: ${this.stats.today.orders.toString().padStart(10)}                              ║
║  • Completed:       ${this.stats.today.completed.toString().padStart(10)}                              ║
║  • Pending:         ${this.stats.today.pending.toString().padStart(10)}                              ║
║  • Revenue today:   MK${this.stats.today.revenue.toLocaleString().padStart(10)}                           ║
║                                                                  ║
║  📆 THIS MONTH                                                   ║
║  ─────────────────────────────────────────────────────────────── ║
║  • New clients:     ${this.stats.month.clients.toString().padStart(10)}                              ║
║  • Returning:       ${this.stats.month.returning.toString().padStart(10)} (${this.stats.month.returning_percentage}%)                 ║
║  • Average rating:  ${this.stats.month.avg_rating.toString().padStart(10)} ★                                         ║
║  • Most requested:  ${this.stats.month.most_requested.padEnd(20)} (${this.stats.month.most_requested_count})        ║
║  • Revenue month:   MK${this.stats.month.revenue.toLocaleString().padStart(10)}                           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
    `;
  }

  async showDashboard() {
    await this.refreshStats();
    console.log(this.formatStats());
    return this.stats;
  }
}

// Auto-refresh every hour
const dashboard = new AdminDashboard();
cron.schedule('0 * * * *', () => {
  dashboard.refreshStats();
});

module.exports = dashboard;