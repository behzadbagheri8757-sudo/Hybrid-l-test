/* js/views/dashboard.js — SPA Dashboard view (Phase 2).
   Reuses existing globalTotals / inventoryValue / prospect helpers.
   No new financial formulas. Mount/unmount lifecycle only.
*/
'use strict';

(function (global) {
  const ICO = {
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    invoice: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    bank: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 9 4 9"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    warehouse: '<svg viewBox="0 0 24 24" fill="none" stroke="#5c4a30" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/></svg>'
  };

  function dashTile(href, ico, title, sub) {
    return (
      '<a class="dash-tile" href="' +
      href +
      '">' +
      '<span class="dash-ico">' +
      ico +
      '</span>' +
      '<span class="dash-title">' +
      title +
      '</span>' +
      (sub ? '<span class="dash-sub">' + sub + '</span>' : '') +
      '</a>'
    );
  }

  function recentInvoicesHtml() {
    const invs = (data.invoices || [])
      .slice()
      .sort(function (a, b) {
        return (
          (b.date || '').localeCompare(a.date || '') ||
          String(b.number).localeCompare(String(a.number))
        );
      });
    const top = invs.slice(0, 5);
    if (!top.length) return '';
    const rows = top
      .map(function (inv) {
        const cust = data.customers.find(function (c) {
          return c.id === inv.customerId;
        });
        const name = cust ? cust.name : '—';
        return (
          '<a class="ledger-row" href="#/invoice?id=' +
          encodeURIComponent(inv.id) +
          '">' +
          '<span class="name">فاکتور #' +
          esc(String(inv.number || '')) +
          '<span class="sub">' +
          esc(name) +
          ' — ' +
          faDate(inv.date) +
          '</span></span>' +
          '<span class="filler"></span>' +
          '<span class="amount">' +
          toman(inv.total) +
          ' ت</span>' +
          '</a>'
        );
      })
      .join('');
    return (
      '<div class="dash-section-label">آخرین فاکتورها</div><div class="dash-activity">' +
      rows +
      '</div>'
    );
  }

  function recentVisitsHtml() {
    const items = [];
    (data.customers || []).forEach(function (c) {
      (c.visits || []).forEach(function (v) {
        items.push({
          customerId: c.id,
          name: c.name,
          date: v.date,
          time: v.time,
          result: v.result
        });
      });
    });
    items.sort(function (a, b) {
      return (
        (b.date || '').localeCompare(a.date || '') ||
        (b.time || '').localeCompare(a.time || '')
      );
    });
    const top = items.slice(0, 5);
    if (!top.length) return '';
    const rows = top
      .map(function (v) {
        return (
          '<a class="ledger-row" href="#/customer?id=' +
          encodeURIComponent(v.customerId) +
          '">' +
          '<span class="name">' +
          esc(v.name) +
          '<span class="sub">' +
          faDate(v.date) +
          (v.time ? ' ' + esc(v.time) : '') +
          ' — ' +
          esc(v.result || '') +
          '</span></span>' +
          '<span class="filler"></span>' +
          '<span class="amount">ویزیت</span>' +
          '</a>'
        );
      })
      .join('');
    return (
      '<div class="dash-section-label">آخرین ویزیت‌ها</div><div class="dash-activity">' +
      rows +
      '</div>'
    );
  }

  /** Read-only UI for existing ProspectScout dailyTarget — same as original dashboard shell. */
  function renderDashboardTargetBar(dt) {
    const target = dt ? Number(dt.target) || 0 : 0;
    const count = dt ? Number(dt.count) || 0 : 0;
    if (!dt || target <= 0 || count < 1) {
      return (
        '<a class="dash-target dash-target-compact" href="#/prospects">' +
        '<span class="dash-target-title">تارگت امروز تنظیم نشده</span>' +
        '<span class="dash-target-link">تنظیم ←</span>' +
        '</a>'
      );
    }
    const pct = Math.min(100, Math.round((count / target) * 100));
    const remain = Math.max(0, target - count);
    const done = count >= target;
    const status = done
      ? '<span class="dash-target-done">تارگت امروز تکمیل شد ✓</span>'
      : '<span class="dash-target-remain">' + remain + ' بازدید تا تارگت</span>';
    return (
      '<a class="dash-target' +
      (done ? ' is-done' : '') +
      '" href="#/prospects">' +
      '<div class="dash-target-top">' +
      '<span class="dash-target-title">تارگت امروز</span>' +
      '<span class="dash-target-pct">' +
      pct +
      '٪</span>' +
      '</div>' +
      '<div class="dash-target-nums">' +
      count +
      ' / ' +
      target +
      '</div>' +
      '<div class="dash-target-bar"><span style="width:' +
      pct +
      '%"></span></div>' +
      '<div class="dash-target-foot">' +
      status +
      '<span class="dash-target-link">جزئیات ←</span></div>' +
      '</a>'
    );
  }

  async function renderInto(root, isStale) {
    const g = globalTotals();
    const invVal = inventoryValue();
    const custN = data.customers.length;
    const prodN = data.products.length;
    const invN = data.invoices.length;
    const supN = data.suppliers.length;
    const payN = (data.payments || []).length;
    const chkN = (data.checks || []).length;

    let targetHtml = '';
    try {
      if (typeof openProspectDatabase === 'function' && !prospectDbInstance) {
        await openProspectDatabase();
      }
      if (typeof ensureProspectDailyTarget === 'function') {
        const dt = await ensureProspectDailyTarget();
        targetHtml = renderDashboardTargetBar(dt);
      }
    } catch (err) {
      console.warn('dashboard target read skipped', err);
      targetHtml = '';
    }

    // Guard against the async prospect-target lookup above resolving after this view
    // was unmounted (e.g. user navigated away while awaiting IndexedDB). Without this,
    // the pending write below would land in whatever view now occupies #main.
    if (typeof isStale === 'function' && isStale()) return;

    root.innerHTML =
      '<h2 class="section-title" style="margin-top:4px;">داشبورد</h2>' +
      targetHtml +
      '<div class="dash-section-label">خلاصه وضعیت</div>' +
      '<div class="dash-stats">' +
      '<div class="dash-stat"><div class="label">فروش امروز</div>' +
      '<div class="value accent-olive">' +
      toman(g.todaySales) +
      ' ت</div>' +
      '<div class="label" style="margin-top:4px;">' +
      (g.todayCount || 0) +
      ' فاکتور</div></div>' +
      '<div class="dash-stat"><div class="label">فروش این ماه</div>' +
      '<div class="value accent-olive">' +
      toman(g.monthSales) +
      ' ت</div>' +
      '<div class="label" style="margin-top:4px;">' +
      (g.monthCount || 0) +
      ' فاکتور</div></div>' +
      '<div class="dash-stat"><div class="label">بدهی مشتریان</div>' +
      '<div class="value accent-rust">' +
      toman(g.customerDebt) +
      ' ت</div></div>' +
      '<div class="dash-stat"><div class="label">بدهی به تامین‌کننده‌ها</div>' +
      '<div class="value accent-rust">' +
      toman(g.supplierDebt) +
      ' ت</div></div>' +
      '<div class="dash-stat"><div class="label">ارزش موجودی انبار</div>' +
      '<div class="value">' +
      toman(invVal) +
      ' ت</div></div>' +
      '<div class="dash-stat"><div class="label">سود کل (از فاکتورها)</div>' +
      '<div class="value accent-amber">' +
      toman(g.totalProfit) +
      ' ت</div></div>' +
      '<div class="dash-stat wide"><div class="label">جمع کل فروش فاکتورها</div>' +
      '<div class="value">' +
      toman(g.totalSales) +
      ' ت</div></div>' +
      '</div>' +
      '<div class="dash-section-label">دسترسی سریع</div>' +
      '<div class="dash-grid">' +
      dashTile('#/invoices', ICO.invoice, 'فاکتورها', invN + ' فاکتور') +
      dashTile(
        '#/customers',
        ICO.users,
        'مشتریان',
        custN + ' نفر'
      ) +
      dashTile('#/payments', ICO.card, 'پرداخت‌ها', payN + ' مورد') +
      dashTile('#/products', ICO.box, 'اجناس', prodN + ' قلم') +
      dashTile('#/suppliers', ICO.truck, 'تامین‌کنندگان', supN + ' نفر') +
      dashTile('#/checks', ICO.bank, 'چک‌ها', chkN + ' فقره') +
      dashTile('#/inventory', ICO.warehouse, 'انبار', toman(invVal) + ' ت') +
      dashTile('#/visits', ICO.map, 'ویزیت مشتریان', '') +
      dashTile('#/prospects', ICO.map, 'ارزیابی مغازه‌ها', '') +
      dashTile('#/reports', ICO.chart, 'گزارش‌ها', '') +
      dashTile('#/settings', ICO.gear, 'تنظیمات و بکاپ', '') +
      '</div>' +
      recentInvoicesHtml() +
      recentVisitsHtml();
  }

  /**
   * mount(root, params) → returns cleanup function for unmount
   */
  function mount(root, params) {
    if (!root) return function () {};
    // Dashboard hides top nav (same as original)
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = 'none';

    let cancelled = false;
    const isStale = function () {
      return cancelled;
    };
    renderInto(root, isStale).catch(function (e) {
      if (!cancelled) {
        console.error('DashboardView mount failed', e);
        root.innerHTML =
          '<div class="empty">خطا در بارگذاری داشبورد. صفحه را دوباره باز کنید.</div>';
      }
    });

    return function unmount() {
      cancelled = true;
      if (nav) nav.style.display = '';
      root.innerHTML = '';
    };
  }

  function unmount() {
    /* cleanup is returned from mount; router calls that */
  }

  global.DashboardView = {
    mount: mount,
    unmount: unmount
  };
})(typeof window !== 'undefined' ? window : this);
