// admin-dashboard.js - Enterprise Success Metrics Dashboard
const db = require('./database');
const cron = require('node-cron');

class AdminDashboard {
  constructor() {
    this.stats = {};
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.startAutoRefresh();
  }

  startAutoRefresh() {
    // Refresh every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      await this.refreshStats();
    });
    
    // Daily summary at 9 PM
    cron.schedule('0 21 * * *', async () => {
      await this.sendDailySummary();
    });
  }

  async refreshStats() {
    const startTime = Date.now();
    
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay())).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
    
    // Get all data in parallel for performance
    const [
      allOrders, allClients, allFeedback, testimonials,
      pendingPayments, weeklyOrders, monthlyOrders, yearlyOrders
    ] = await Promise.all([
      db.getAllOrders(),
      db.getAllClients(),
      db.getAllFeedback(),
      db.getAllTestimonials(),
      db.getPendingPaymentOrders(),
      db.getOrdersByDateRange(firstDayOfWeek, today),
      db.getOrdersByDateRange(firstDayOfMonth, today),
      db.getOrdersByYear(now.getFullYear())
    ]);
    
    // Today's orders
    const todayOrders = allOrders.filter(o => o.created_at.split('T')[0] === today);
    const todayRevenue = this.calculateRevenue(todayOrders);
    
    // Weekly stats
    const weeklyRevenue = this.calculateRevenue(weeklyOrders);
    const weeklyCompleted = weeklyOrders.filter(o => o.status === 'delivered').length;
    
    // Monthly stats
    const monthlyRevenue = this.calculateRevenue(monthlyOrders);
    const monthlyNewClients = allClients.filter(c => c.created_at >= firstDayOfMonth).length;
    const monthlyReturning = allClients.filter(c => c.total_orders > 1 && c.created_at < firstDayOfMonth).length;
    
    // Yearly stats
    const yearlyRevenue = this.calculateRevenue(yearlyOrders);
    const yearlyOrdersCount = yearlyOrders.length;
    
    // Feedback analysis
    const recentFeedback = allFeedback.filter(f => f.created_at >= thirtyDaysAgo);
    const avgRating = recentFeedback.length > 0 
      ? recentFeedback.reduce((sum, f) => sum + (f.rating || 0), 0) / recentFeedback.length 
      : 0;
    
    const ratingDistribution = {
      5: recentFeedback.filter(f => f.rating === 5).length,
      4: recentFeedback.filter(f => f.rating === 4).length,
      3: recentFeedback.filter(f => f.rating === 3).length,
      2: recentFeedback.filter(f => f.rating === 2).length,
      1: recentFeedback.filter(f => f.rating === 1).length
    };
    
    // Service popularity
    const serviceCount = {};
    allOrders.forEach(o => {
      serviceCount[o.service] = (serviceCount[o.service] || 0) + 1;
    });
    const mostRequested = Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0];
    
    // Client retention
    const totalClients = allClients.length;
    const activeClients = allClients.filter(c => {
      const lastOrder = allOrders.find(o => o.client_id === c.id);
      return lastOrder && new Date(lastOrder.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }).length;
    const retentionRate = totalClients > 0 ? (activeClients / totalClients) * 100 : 0;
    
    // Conversion metrics
    const ordersCompleted = allOrders.filter(o => o.payment_status === 'completed').length;
    const ordersPending = allOrders.filter(o => o.payment_status === 'pending').length;
    const conversionRate = allOrders.length > 0 ? (ordersCompleted / allOrders.length) * 100 : 0;
    
    // Testimonial stats
    const approvedTestimonials = testimonials.filter(t => t.approved).length;
    const pendingTestimonials = testimonials.filter(t => !t.approved).length;
    
    this.stats = {
      timestamp: new Date().toISOString(),
      generation_time: Date.now() - startTime,
      
      today: {
        orders: todayOrders.length,
        completed: todayOrders.filter(o => o.status === 'delivered').length,
        pending: todayOrders.filter(o => o.status === 'pending').length,
        revenue: todayRevenue,
        avg_order_value: todayOrders.length > 0 ? todayRevenue / todayOrders.length : 0
      },
      
      week: {
        orders: weeklyOrders.length,
        completed: weeklyCompleted,
        revenue: weeklyRevenue,
        growth: this.calculateGrowth(weeklyRevenue, monthlyRevenue / 4)
      },
      
      month: {
        orders: monthlyOrders.length,
        new_clients: monthlyNewClients,
        returning_clients: monthlyReturning,
        revenue: monthlyRevenue,
        avg_rating: avgRating.toFixed(1),
        rating_distribution: ratingDistribution,
        most_requested: mostRequested ? mostRequested[0] : 'None',
        most_requested_count: mostRequested ? mostRequested[1] : 0
      },
      
      year: {
        orders: yearlyOrdersCount,
        revenue: yearlyRevenue,
        projected_annual: yearlyRevenue * (12 / (new Date().getMonth() + 1))
      },
      
      clients: {
        total: totalClients,
        active: activeClients,
        retention_rate: retentionRate.toFixed(1),
        conversion_rate: conversionRate.toFixed(1),
        pending_payments: pendingPayments.length
      },
      
      testimonials: {
        approved: approvedTestimonials,
        pending: pendingTestimonials,
        total: testimonials.length
      }
    };
    
    this.cache.set('stats', this.stats);
    return this.stats;
  }

  calculateRevenue(orders) {
    return orders.reduce((sum, o) => {
      const amount = parseInt(o.total_charge?.replace('MK', '').replace(',', '') || 0);
      return sum + amount;
    }, 0);
  }

  calculateGrowth(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  formatStats() {
    const s = this.stats;
    if (!s.today) return 'Stats not available. Run refreshStats() first.';
    
    return `
╔══════════════════════════════════════════════════════════════════════════════╗
║                         📊 EASYSUCCOR EXECUTIVE DASHBOARD                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  📅 TODAY'S PERFORMANCE                                                     ║
║  ────────────────────────────────────────────────────────────────────────── ║
║  • Orders received:     ${s.today.orders.toString().padStart(10)}                                         ║
║  • Completed:           ${s.today.completed.toString().padStart(10)}                                         ║
║  • Pending:             ${s.today.pending.toString().padStart(10)}                                         ║
║  • Revenue:             MK${s.today.revenue.toLocaleString().padStart(12)}                                      ║
║  • Avg order value:     MK${Math.round(s.today.avg_order_value).toLocaleString().padStart(12)}                                      ║
║                                                                              ║
║  📈 WEEKLY METRICS                                                          ║
║  ────────────────────────────────────────────────────────────────────────── ║
║  • Orders:              ${s.week.orders.toString().padStart(10)}                                         ║
║  • Completed:           ${s.week.completed.toString().padStart(10)}                                         ║
║  • Revenue:             MK${s.week.revenue.toLocaleString().padStart(12)}                                      ║
║  • Growth:              ${s.week.growth.toFixed(1).padStart(10)}%                                        ║
║                                                                              ║
║  📆 MONTHLY SNAPSHOT                                                        ║
║  ────────────────────────────────────────────────────────────────────────── ║
║  • New clients:         ${s.month.new_clients.toString().padStart(10)}                                         ║
║  • Returning:           ${s.month.returning_clients.toString().padStart(10)}                                         ║
║  • Revenue:             MK${s.month.revenue.toLocaleString().padStart(12)}                                      ║
║  • Avg rating:          ${s.month.avg_rating.toString().padStart(10)} ★                                       ║
║  • Most requested:      ${s.month.most_requested.padEnd(20)} (${s.month.most_requested_count})              ║
║                                                                              ║
║  👥 CLIENT INSIGHTS                                                         ║
║  ────────────────────────────────────────────────────────────────────────── ║
║  • Total clients:       ${s.clients.total.toString().padStart(10)}                                         ║
║  • Active (30d):        ${s.clients.active.toString().padStart(10)}                                         ║
║  • Retention rate:      ${s.clients.retention_rate.toString().padStart(10)}%                                        ║
║  • Conversion rate:     ${s.clients.conversion_rate.toString().padStart(10)}%                                        ║
║  • Pending payments:    ${s.clients.pending_payments.toString().padStart(10)}                                         ║
║                                                                              ║
║  📝 TESTIMONIALS                                                           ║
║  ────────────────────────────────────────────────────────────────────────── ║
║  • Approved:            ${s.testimonials.approved.toString().padStart(10)}                                         ║
║  • Pending review:      ${s.testimonials.pending.toString().padStart(10)}                                         ║
║                                                                              ║
║  📅 YEAR-TO-DATE                                                           ║
║  ────────────────────────────────────────────────────────────────────────── ║
║  • Total orders:        ${s.year.orders.toString().padStart(10)}                                         ║
║  • Revenue:             MK${s.year.revenue.toLocaleString().padStart(12)}                                      ║
║  • Projected annual:    MK${Math.round(s.year.projected_annual).toLocaleString().padStart(12)}                                      ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
    `;
  }

  async sendDailySummary() {
    await this.refreshStats();
    const summary = this.formatStats();
    console.log(summary);
    
    // Also send to admin Telegram if configured
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId && this.bot) {
      await this.bot.telegram.sendMessage(adminChatId, `📊 *Daily Business Summary*\n\`\`\`\n${summary}\n\`\`\``, { parse_mode: 'Markdown' });
    }
  }

  async getFormattedReport() {
    await this.refreshStats();
    return this.formatStats();
  }

  async getRevenueByService() {
    const orders = await db.getAllOrders();
    const revenueByService = {};
    
    for (const order of orders) {
      const service = order.service;
      const amount = this.calculateRevenue([order]);
      revenueByService[service] = (revenueByService[service] || 0) + amount;
    }
    
    return revenueByService;
  }

  async getClientAcquisitionTrend(days = 30) {
    const clients = await db.getAllClients();
    const trend = [];
    const today = new Date();
    
    for (let i = days; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const count = clients.filter(c => c.created_at.split('T')[0] === dateStr).length;
      trend.push({ date: dateStr, new_clients: count });
    }
    
    return trend;
  }
}

// Auto-refresh every hour
const dashboard = new AdminDashboard();
dashboard.refreshStats().catch(console.error);

module.exports = dashboard;