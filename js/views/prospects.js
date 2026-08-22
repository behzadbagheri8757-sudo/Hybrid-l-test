/* js/views/prospects.js — SPA Prospects list view (Phase 8).
   Extracted from prospects.html. Reuses prospectState, PROSPECT_RANK_INFO,
   prospectComputeScore, prospectScoreToRank, prospectRouteName,
   prospectNeighborhoodName, prospectFaDate, queueProspectTargetMilestoneMessage,
   setProspectDailyTargetValue, ensureProspectDailyTarget.
   No new financial logic.
*/
'use strict';

(function (global) {
  let pQuery = '';
  let pFilter = 'all'; // all | active | converted | A+ | A | B
  let pSort = 'score_desc'; // score_desc | score_asc | name | newest

  let searchHandler = null;
  let chipHandlers = [];
  let sortHandler = null;
  let fabHandler = null;
  let targetBtnHandler = null;
  function rankPill(rank) {
    const info = PROSPECT_RANK_INFO[rank] || PROSPECT_RANK_INFO['D'];
    return `<span class="rank-pill" style="background:${info.color}">${esc(rank)}</span>`;
  }

  function navigateToProspect(id) {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/prospect', { id: id });
    } else {
      location.href = '#/prospect?id=' + encodeURIComponent(id);
    }
  }

  function navigateToEvaluation(shopId) {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      const params = shopId ? { shopId: shopId } : {};
      AppRouter.navigate('/evaluation', params);
    } else {
      const url = shopId ? '#/evaluation?shopId=' + encodeURIComponent(shopId) : '#/evaluation';
      location.href = url;
    }
  }

  function renderTargetCard() {
    const el = document.getElementById('prospect-target');
    if (!el) return;
    const dt = prospectState.dailyTarget || { target: 0, count: 0 };
    if (!dt.target) {
      el.innerHTML = `<div class="card wide"><div class="label">تارگت ویزیت امروز</div>
        <div class="value" style="font-size:.95rem;">تنظیم نشده</div>
        <div class="btn-row" style="margin-top:8px;"><button type="button" class="btn small" id="set-target-btn">تنظیم تارگت</button></div></div>`;
    } else {
      const pct = Math.min(100, Math.round((dt.count / dt.target) * 100));
      el.innerHTML = `<div class="card wide"><div class="label">تارگت ویزیت امروز</div>
        <div class="value">${dt.count} / ${dt.target} <span class="sub">(${pct}٪)</span></div>
        <div class="btn-row" style="margin-top:8px;"><button type="button" class="btn small secondary" id="set-target-btn">ویرایش تارگت</button></div></div>`;
    }
    const b = document.getElementById('set-target-btn');
    if (b) {
      targetBtnHandler = function () {
        const v = prompt('تارگت ویزیت امروز (عدد):', String(dt.target || 20));
        if (v == null) return;
        const n = parseInt(v, 10);
        if (!n || n <= 0) { showToast('عدد معتبر وارد کن'); return; }
        setProspectDailyTargetValue(n).then(() => {
          renderTargetCard();
          showToast('تارگت ذخیره شد');
        });
      };
      b.onclick = targetBtnHandler;
    }
  }

  function renderProspectListOnly() {
    const list = document.getElementById('prospect-list');
    const sum = document.getElementById('prospect-summary');
    if (!list || !sum) return;
    let rows = prospectState.shops.slice();
    const q = (pQuery || '').trim().toLowerCase();
    if (q) rows = rows.filter(s => (s.name || '').toLowerCase().includes(q));
    if (pFilter === 'active') rows = rows.filter(s => s.status !== 'converted');
    else if (pFilter === 'converted') rows = rows.filter(s => s.status === 'converted');
    else if (['A+', 'A', 'B', 'C', 'D'].includes(pFilter)) rows = rows.filter(s => s.latestRank === pFilter);

    if (pSort === 'score_asc') rows.sort((a,b) => a.latestScore - b.latestScore);
    else if (pSort === 'name') rows.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'fa'));
    else if (pSort === 'newest') rows.sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    else rows.sort((a,b) => b.latestScore - a.latestScore);

    sum.innerHTML = `<div class="card"><div class="label">تعداد</div><div class="value">${rows.length}</div></div>
      <div class="card"><div class="label">کل مغازه‌ها</div><div class="value">${prospectState.shops.length}</div></div>`;

    if (!rows.length) {
      list.innerHTML = `<div class="empty">${prospectState.shops.length ? 'موردی پیدا نشد' : 'هنوز مغازه‌ای ثبت نشده. با + یا «ثبت مغازه» شروع کنید.'}</div>`;
      return;
    }
    list.innerHTML = rows.map(s => `
      <a class="ledger-row" data-open-prospect="${esc(s.id)}" style="text-decoration:none;color:inherit;">
        <span class="name">${esc(s.name)}${s.status === 'converted' ? ' ✅' : ''}
          <span class="sub">${esc(prospectRouteName(s.routeId))} — ${prospectFaDate(s.updatedAt)}</span>
        </span>
        <span class="filler"></span>
        <span class="amount">${s.latestScore} ${rankPill(s.latestRank)}</span>
      </a>`).join('');

    // Delegated click for row navigation
    list.addEventListener('click', function (e) {
      const row = e.target.closest('[data-open-prospect]');
      if (row) {
        e.preventDefault();
        navigateToProspect(row.getAttribute('data-open-prospect'));
      }
    });
  }

  function drawProspectsPage(root) {
    const chip = function (id, label) {
      return `<button type="button" class="chip ${pFilter === id ? 'active' : ''}" data-pf="${id}">${label}</button>`;
    };
    root.innerHTML = `
      <h2 class="section-title">مغازه‌های بالقوه</h2>
      <div class="prospect-subnav">
        <a class="btn small secondary" data-nav-evaluation href="#/evaluation">ثبت مغازه + ارزیابی</a>
        <a class="btn small secondary" data-nav-routes href="#/prospect-routes">مسیرها</a>
      </div>
      <div id="prospect-target" class="cards" style="margin-bottom:12px;"></div>
      <div class="field"><input id="prospect-search" placeholder="جستجوی نام مغازه..." value="${esc(pQuery)}" autocomplete="off"></div>
      <div class="chip-row" id="prospect-chips">
        ${chip('all','همه')}
        ${chip('active','فعال')}
        ${chip('converted','تبدیل‌شده')}
        ${chip('A+','رتبه A+')}
        ${chip('A','رتبه A')}
        ${chip('B','رتبه B')}
      </div>
      <div class="field"><label>مرتب‌سازی</label>
        <select id="prospect-sort">
          <option value="score_desc" ${pSort === 'score_desc' ? 'selected' : ''}>بیشترین امتیاز</option>
          <option value="score_asc" ${pSort === 'score_asc' ? 'selected' : ''}>کمترین امتیاز</option>
          <option value="name" ${pSort === 'name' ? 'selected' : ''}>نام</option>
          <option value="newest" ${pSort === 'newest' ? 'selected' : ''}>جدیدترین</option>
        </select>
      </div>
      <div id="prospect-summary" class="cards" style="margin-bottom:10px;"></div>
      <div id="prospect-list"></div>
    `;

    const searchEl = document.getElementById('prospect-search');
    searchHandler = function (e) {
      pQuery = e.target.value;
      renderProspectListOnly();
    };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#prospect-chips [data-pf]').forEach(function (btn) {
      const fn = function () {
        pFilter = btn.getAttribute('data-pf');
        document.querySelectorAll('#prospect-chips [data-pf]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-pf') === pFilter);
        });
        renderProspectListOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const sortEl = document.getElementById('prospect-sort');
    sortHandler = function (e) {
      pSort = e.target.value;
      renderProspectListOnly();
    };
    sortEl.addEventListener('change', sortHandler);

    // Navigation buttons
    root.querySelector('[data-nav-evaluation]').addEventListener('click', function (e) {
      e.preventDefault();
      navigateToEvaluation(null);
    });
    root.querySelector('[data-nav-routes]').addEventListener('click', function (e) {
      e.preventDefault();
      if (
        typeof isSpaShell === 'function' &&
        isSpaShell() &&
        typeof AppRouter !== 'undefined' &&
        AppRouter.navigate
      ) {
        AppRouter.navigate('/prospect-routes');
      } else {
        location.href = '#/prospect-routes';
      }
    });

    renderTargetCard();
    renderProspectListOnly();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'block';
      fabHandler = function () {
        navigateToEvaluation(null);
      };
      fab.onclick = fabHandler;
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    pQuery = '';
    pFilter = 'all';
    pSort = 'score_desc';
    drawProspectsPage(root);

    refreshToken = ViewHost.setRefresh(renderProspectListOnly);
    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (searchHandler) {
        const se = document.getElementById('prospect-search');
        if (se) se.removeEventListener('input', searchHandler);
      }
      searchHandler = null;

      chipHandlers.forEach(function (h) {
        try {
          h.el.removeEventListener('click', h.fn);
        } catch (e) {}
      });
      chipHandlers = [];

      if (sortHandler) {
        const so = document.getElementById('prospect-sort');
        if (so) so.removeEventListener('change', sortHandler);
      }
      sortHandler = null;

      if (fab) {
        fab.style.display = 'none';
        fab.onclick = null;
      }
      fabHandler = null;
      targetBtnHandler = null;
      root.innerHTML = '';
    };
  }

  global.ProspectsView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);