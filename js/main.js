/* =========================================================
   SUBHA INFRA — site interactions
   Contact details, social links, team and rates live in site-config.js
   ========================================================= */
(() => {
  const CFG = window.SITE_CONFIG || {};
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const body = document.body;
  const inr = n => Math.round(n).toLocaleString('en-IN');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const waLink = text => `https://wa.me/${String(CFG.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(text || CFG.whatsappMessage || '')}`;
  const BASE = String(window.SITE_BASE || '');   // '' at a domain root, '/folder' when served from a sub-folder
  const asset = p => (/^(https?:|data:)/i.test(String(p)) ? String(p) : BASE + '/' + String(p).replace(/^\//, ''));
  const rateOf = path => path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), CFG.rates || {});

  /* ---------- Apply site-config.js ---------- */
  const setText = (el, t) => { if (!el.children.length && t) el.textContent = t; };
  $$('[data-cfg]').forEach(el => {
    const k = el.dataset.cfg;
    if (k === 'tel' && CFG.phone) { el.href = 'tel:' + CFG.phone; setText(el, CFG.phoneDisplay); }
    if (k === 'email' && CFG.email) { el.href = 'mailto:' + CFG.email; setText(el, CFG.email); }
    if (k === 'wa' && CFG.whatsapp) el.href = waLink();
    if (k === 'address' && CFG.address) el.textContent = CFG.address;
    if (k === 'map' && CFG.mapQuery) el.src = 'https://www.google.com/maps?q=' + encodeURIComponent(CFG.mapQuery) + '&output=embed';
  });
  $$('[data-cfg-text]').forEach(el => {
    const k = el.dataset.cfgText;
    if (k === 'phone' && CFG.phoneDisplay) el.textContent = CFG.phoneDisplay;
    if (k === 'email' && CFG.email) el.textContent = CFG.email;
  });
  $$('[data-social]').forEach(a => {
    const k = a.dataset.social;
    const url = k === 'whatsapp' ? (CFG.whatsapp ? waLink() : '') : ((CFG.social || {})[k] || '');
    if (url) a.href = url; else a.hidden = true;
  });
  $$('[data-rate]').forEach(el => {
    const v = Number(rateOf(el.dataset.rate));
    if (v > 0) el.textContent = inr(v);
    else { el.textContent = 'On enquiry'; el.classList.add('enq'); const p = el.closest('.tier-rate, .dz-rate'); if (p) p.classList.add('enq'); }
  });
  $$('[data-rate-inline]').forEach(el => { const v = Number(rateOf(el.dataset.rateInline)); el.textContent = v > 0 ? `(₹${inr(v)} / sq ft)` : '(on enquiry)'; });
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

  /* ---------- Team (from config) ---------- */
  const teamBox = $('[data-team]');
  if (teamBox && Array.isArray(CFG.team) && CFG.team.length) {
    teamBox.innerHTML = CFG.team.map((m, i) => `<article class="tm zoom reveal"><div class="img"><img data-slot="TEAM-MEMBER-${i + 1}" src="${esc(asset(m.photo || 'assets/images/team/placeholder.svg'))}" alt="${esc(m.name || '')}${m.role ? ', ' + esc(m.role) : ''}" loading="lazy"></div><b>${esc(m.name || '')}</b><span>${esc(m.role || '')}</span></article>`).join('');
  }
  const gp = $('[data-group-photo]');
  if (gp && CFG.groupPhoto) gp.innerHTML = `<img src="${esc(asset(CFG.groupPhoto))}" alt="The SUBHA INFRA team" loading="lazy">`;

  /* ---------- Header ---------- */
  const hdr = $('.hdr');
  let lastY = scrollY;
  const onScroll = () => {
    const y = scrollY;
    if (hdr) {
      hdr.classList.toggle('scrolled', y > 30);
      const hold = $('.has-mega.open') || body.classList.contains('nav-open');
      if (y > 600 && y > lastY + 6 && !hold) hdr.classList.add('hide');
      else if (y < lastY - 6 || y < 600) hdr.classList.remove('hide');
    }
    lastY = y;
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mega menus ---------- */
  $$('.has-mega').forEach(li => {
    let t;
    const trigger = li.firstElementChild;
    const open = () => { clearTimeout(t); $$('.has-mega.open').forEach(o => o !== li && o.classList.remove('open')); li.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); };
    const close = () => { t = setTimeout(() => { li.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }, 180); };
    li.addEventListener('pointerenter', e => e.pointerType === 'mouse' && open());
    li.addEventListener('pointerleave', e => e.pointerType === 'mouse' && close());
    li.addEventListener('focusin', open);
    li.addEventListener('focusout', e => { if (!li.contains(e.relatedTarget)) close(); });
    trigger.addEventListener('click', e => { if (!li.classList.contains('open') && matchMedia('(hover: none)').matches) { e.preventDefault(); open(); } });
  });

  /* ---------- Mobile nav ---------- */
  const burger = $('.burger');
  const toggleNav = force => {
    const on = typeof force === 'boolean' ? force : !body.classList.contains('nav-open');
    body.classList.toggle('nav-open', on);
    if (burger) burger.setAttribute('aria-expanded', String(on));
    const m = $('.mnav'); if (m) m.setAttribute('aria-hidden', String(!on));
  };
  if (burger) burger.addEventListener('click', () => toggleNav());
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    $$('.has-mega.open').forEach(li => { li.classList.remove('open'); li.firstElementChild.focus(); });
    if (body.classList.contains('nav-open')) toggleNav(false);
  });

  /* ---------- Reveal on scroll ---------- */
  const watch = $$('.reveal, .reveal-img, .split-line, .tl, .jr-step');
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    watch.forEach(el => io.observe(el));
  } else watch.forEach(el => el.classList.add('in'));

  /* ---------- Home hero ---------- */
  const hh = $('.hh');
  if (hh) {
    const slides = $$('.hh-slide', hh);
    const aside = $('.hh-aside', hh);
    const prog = $('.hh-progress', hh);
    const interval = Number(CFG.heroInterval) || 3000;
    hh.style.setProperty('--hh-int', interval + 'ms');
    if (prog) prog.innerHTML = slides.map(() => '<span><i></i></span>').join('');
    const bars = prog ? $$('span', prog) : [];
    let i = 0, timer;
    const show = n => {
      const prev = i;
      i = (n + slides.length) % slides.length;
      slides.forEach((s, k) => s.classList.toggle('on', k === i));
      bars.forEach((b, k) => { b.classList.remove('run'); b.classList.toggle('done', k < i); });
      if (bars[i]) { void bars[i].offsetWidth; if (!reduce) bars[i].classList.add('run'); }
      if (aside && prev !== i) {
        aside.classList.add('swap');
        setTimeout(() => {
          $('.hh-num', aside).textContent = String(i + 1).padStart(2, '0');
          $('.hh-caption small', aside).textContent = slides[i].dataset.cat || '';
          $('.hh-caption b', aside).textContent = slides[i].dataset.title || '';
          const cap = $('a.hh-caption', aside), href = slides[i].dataset.href;
          if (cap) { if (href) { cap.href = asset(href); cap.removeAttribute('aria-disabled'); } else { cap.removeAttribute('href'); } }
          aside.classList.remove('swap');
        }, 420);
      }
      clearTimeout(timer);
      if (!reduce) timer = setTimeout(() => show(i + 1), interval);
    };
    // preload the remaining hero images so crossfades are seamless
    slides.forEach(s => { const im = $('img', s); if (im && im.loading === 'lazy') { im.loading = 'eager'; } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else show(i); });
    requestAnimationFrame(() => requestAnimationFrame(() => { hh.classList.add('in'); $$('.split-line', hh).forEach(l => l.classList.add('in')); }));
    show(0);
  }

  /* ---------- Auto-advancing horizontal rails ---------- */
  $$('[data-rail]').forEach(wrap => {
    const rail = $('.rail', wrap);
    if (!rail) return;
    const step = () => (rail.firstElementChild ? rail.firstElementChild.getBoundingClientRect().width + 24 : 400);
    const prog = $('.rail-progress i', wrap);
    const upd = () => {
      if (!prog) return;
      const max = rail.scrollWidth - rail.clientWidth, vis = rail.clientWidth / rail.scrollWidth;
      prog.style.width = (vis * 100) + '%';
      prog.style.transform = `translateX(${max > 0 ? (rail.scrollLeft / max) * ((1 - vis) / vis) * 100 : 0}%)`;
    };
    rail.addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd); upd();
    let paused = false, resumeT;
    const pause = () => { paused = true; clearTimeout(resumeT); };
    const resume = (ms = 0) => { clearTimeout(resumeT); resumeT = setTimeout(() => { paused = false; }, ms); };
    wrap.addEventListener('pointerenter', e => e.pointerType === 'mouse' && pause());
    wrap.addEventListener('pointerleave', e => e.pointerType === 'mouse' && resume());
    wrap.addEventListener('focusin', pause); wrap.addEventListener('focusout', () => resume());
    rail.addEventListener('touchstart', pause, { passive: true });
    rail.addEventListener('touchend', () => resume(6000), { passive: true });
    if (!reduce) setInterval(() => {
      if (paused || document.hidden) return;
      const r = rail.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const max = rail.scrollWidth - rail.clientWidth;
      if (rail.scrollLeft >= max - 8) rail.scrollTo({ left: 0, behavior: 'smooth' });
      else rail.scrollBy({ left: step(), behavior: 'smooth' });
    }, 3000);
    // mouse drag
    let down = false, sx = 0, sl = 0, moved = false;
    rail.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; down = true; moved = false; sx = e.clientX; sl = rail.scrollLeft; });
    addEventListener('pointermove', e => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 5) { moved = true; rail.classList.add('drag'); } rail.scrollLeft = sl - dx; });
    addEventListener('pointerup', () => { if (!down) return; down = false; setTimeout(() => rail.classList.remove('drag'), 0); });
    rail.addEventListener('click', e => { if (moved) { e.preventDefault(); moved = false; } }, true);
  });

  /* ---------- Portfolio filters ---------- */
  $$('[data-filter-group]').forEach(group => {
    const target = group.dataset.filterGroup;
    const items = $$(`[data-filter-item="${target}"]`);
    const chips = $$('.chip', group);
    const count = $(`[data-filter-count="${target}"]`);
    const apply = key => {
      chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.filter === key)));
      let n = 0;
      items.forEach(it => { const show = key === 'all' || (it.dataset.cats || '').split(' ').includes(key); it.classList.toggle('hidden', !show); if (show) n++; });
      if (count) count.textContent = n;
    };
    chips.forEach(c => c.addEventListener('click', () => {
      apply(c.dataset.filter);
      if (group.hasAttribute('data-hash')) history.replaceState(null, '', c.dataset.filter === 'all' ? location.pathname : '#' + c.dataset.filter);
    }));
    const fromHash = () => { const h = location.hash.slice(1); apply(chips.some(c => c.dataset.filter === h) ? h : 'all'); };
    fromHash();
    if (group.hasAttribute('data-hash')) addEventListener('hashchange', fromHash);
  });

  /* ---------- Package tabs ---------- */
  const tabs = $$('.pkg-tabs [data-tab]');
  if (tabs.length) {
    const panels = $$('[data-panel]');
    const bar = $('.pkg-tabs-bar');
    const select = (id, scroll) => {
      if (!panels.some(p => p.dataset.panel === id)) return false;
      tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
      panels.forEach(p => p.classList.toggle('on', p.dataset.panel === id));
      if (scroll && bar) scrollTo({ top: bar.getBoundingClientRect().top + scrollY - 82 + 1, behavior: reduce ? 'auto' : 'smooth' });
      return true;
    };
    tabs.forEach(t => t.addEventListener('click', () => { select(t.dataset.tab); history.replaceState(null, '', '#' + t.dataset.tab); }));
    const fromHash = () => { const h = location.hash.slice(1); if (!select(h, true)) select(tabs[0].dataset.tab); };
    if (!select(location.hash.slice(1), true)) select(tabs[0].dataset.tab);
    addEventListener('hashchange', fromHash);
  }

  /* ---------- Package tiers: expand / collapse the full specification ---------- */
  $$('[data-acc-all]').forEach(btn => {
    const tier = btn.closest('.tier'), label = $('span', btn);
    const sync = () => { const all = $$('details.acc', tier); const open = all.length && all.every(d => d.open); label.textContent = open ? 'Collapse all' : 'Expand all'; };
    btn.addEventListener('click', () => { const all = $$('details.acc', tier); const open = !all.every(d => d.open); all.forEach(d => { d.open = open; }); sync(); });
    $$('details.acc', tier).forEach(d => d.addEventListener('toggle', sync));
  });

  /* ---------- Cost estimator ---------- */
  const calc = $('[data-calc]');
  if (calc) initCalc(calc);

  function initCalc(box) {
    const form = $('form', box);
    const TIERS = {
      residential: [['essential', 'Essential'], ['premium', 'Premium'], ['signature', 'Signature']],
      commercial: [['core', 'Shell & Core'], ['standard', 'Standard Commercial'], ['premium', 'Premium Commercial']],
      peb: [['basic', 'Basic Shed'], ['standard', 'Standard PEB'], ['premium', 'Premium Insulated PEB']],
      tensile: [['shade', 'Shade Structure'], ['canopy', 'Cantilever Tensile Canopy'], ['signature', 'Signature Entrance Canopy']],
      design: [['concept', 'Concept Design'], ['construction', 'Construction Design'], ['complete', 'Complete Design']]
    };
    const TYPE_LABEL = { residential: 'Residential', commercial: 'Commercial', peb: 'PEB & Industrial', tensile: 'Tensile Fabric', design: 'Architectural Design' };
    const CODE = { residential: 'res', commercial: 'com', peb: 'peb', tensile: 'ten', design: 'design' };
    const CAT = { residential: 'Residential', commercial: 'Commercial', peb: 'PEB', tensile: 'Tensile', design: '' };
    const FLOOR = ['Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor'];
    const tierSel = form.tier, floorsSel = form.floors, floorBox = $('.calc-floors', box);
    const floorVals = [];
    const num = el => Math.max(0, parseFloat(el && el.value) || 0);
    const type = () => (form.querySelector('[name="ctype"]:checked') || {}).value || 'residential';
    const ex = k => Number(((CFG.rates || {}).extras || {})[k]) || 0;

    const fillTiers = keep => {
      const t = type();
      tierSel.innerHTML = TIERS[t].map(([k, l]) => {
        const r = Number(rateOf(`${t}.${k}`));
        return `<option value="${k}">${l} — ${r > 0 ? '₹' + inr(r) + ' / sq ft' : 'on enquiry'}</option>`;
      }).join('');
      if (keep && TIERS[t].some(x => x[0] === keep)) tierSel.value = keep;
      $$('[data-show]', box).forEach(el => el.classList.toggle('off', !el.dataset.show.split(' ').includes(t)));
    };
    const fillFloors = () => {
      $$('input', floorBox).forEach((inp, k) => { floorVals[k] = inp.value; });
      const n = Number(floorsSel.value) || 1;
      floorBox.innerHTML = Array.from({ length: n }, (_, k) => `<label class="calc-f"><span class="calc-lbl">${FLOOR[k]} (sq ft)</span><input type="number" min="0" inputmode="decimal" data-floor="${k}" placeholder="e.g. 1200" value="${esc(floorVals[k] || '')}"></label>`).join('');
    };

    const compute = () => {
      const t = type(), tier = tierSel.value;
      const tierName = (TIERS[t].find(x => x[0] === tier) || ['', ''])[1];
      const rate = Number(rateOf(`${t}.${tier}`)) || 0;
      const rows = [];
      const add = (label, qty, unit, r) => rows.push({ label, qty, unit, r, amt: r > 0 ? qty * r : null });
      if (t === 'residential' || t === 'commercial') {
        $$('[data-floor]', floorBox).forEach(inp => { const a = num(inp); if (a) add(`${FLOOR[+inp.dataset.floor]} — ${tierName}`, a, 'sq ft', rate); });
        if (num(form.sump)) add('RCC water sump', num(form.sump), 'L', ex('sump'));
        if (num(form.septic)) add('Septic tank', num(form.septic), 'L', ex('septic'));
        const cw = num(form.cwl) * num(form.cwh);
        if (cw) add('Plain compound wall', cw, 'sq ft', ex('compoundWall'));
      } else if (t === 'peb' || t === 'tensile') {
        const a = num(form.len) * num(form.wid);
        if (a) add(t === 'peb' ? `PEB structure — ${tierName}` : tierName, a, 'sq ft', rate);
        if (t === 'peb' && a) {
          if (form.puf.checked) add('50 mm PUF sandwich roofing', a, 'sq ft', ex('pufRoofing'));
          const sky = Math.min(30, num(form.sky));
          if (sky) add(`Polycarbonate skylight (${sky}%)`, a * sky / 100, 'sq ft', ex('skylight'));
        }
        if (t === 'peb' && num(form.ms)) add('MS support structure', num(form.ms), 'sq ft', ex('msStructure'));
      } else {
        const a = num(form.darea);
        if (a) add(tierName, a, 'sq ft', rate);
      }
      const sub = rows.reduce((s, r) => s + (r.amt || 0), 0);
      const gstP = Number(CFG.gstPercent) || 0;
      const gst = sub * gstP / 100;
      const enquiry = rows.some(r => r.amt === null);

      $('[data-calc-title]', box).textContent = `${TYPE_LABEL[t]} · ${tierName}`;
      $('[data-calc-rows]', box).innerHTML = rows.length
        ? rows.map(r => `<tr><td>${esc(r.label)}</td><td>${inr(r.qty)} ${r.unit}</td><td>${r.r > 0 ? '₹' + inr(r.r) : '—'}</td><td>${r.amt === null ? 'On enquiry' : '₹ ' + inr(r.amt)}</td></tr>`).join('')
        : '<tr class="calc-empty"><td colspan="4">Enter your areas to see the estimate.</td></tr>';
      $('[data-calc-sub]', box).textContent = '₹ ' + inr(sub);
      $('[data-calc-gstlbl]', box).textContent = gstP ? `GST ${gstP}%` : 'GST';
      $('[data-calc-gst]', box).textContent = '₹ ' + inr(gst);
      $('[data-calc-total]', box).textContent = '₹ ' + inr(sub + gst) + (enquiry ? ' +' : '');

      const lines = rows.map(r => `• ${r.label}: ${inr(r.qty)} ${r.unit}${r.amt === null ? ' (rate on enquiry)' : ' × ₹' + inr(r.r) + ' = ₹' + inr(r.amt)}`);
      const msg = `Hello ${CFG.company || 'SUBHA INFRA'}, I used the cost estimator on your website.\n\nPackage: ${TYPE_LABEL[t]} — ${tierName}\n${lines.join('\n')}\n\nSubtotal: ₹${inr(sub)}\nGST ${gstP}%: ₹${inr(gst)}\nEstimated total: ₹${inr(sub + gst)}\n\nPlease share a detailed quotation.`;
      $('[data-calc-wa]', box).href = waLink(msg);
      const q = new URLSearchParams({ package: `${CODE[t]}-${tier}` });
      if (CAT[t]) q.set('category', CAT[t]);
      $('[data-calc-quote]', box).href = BASE + '/contact/?' + q.toString();
    };

    form.addEventListener('change', e => {
      if (e.target.name === 'ctype') fillTiers();
      if (e.target.name === 'floors') fillFloors();
      compute();
    });
    form.addEventListener('input', compute);
    $$('[data-preset]').forEach(a => a.addEventListener('click', () => {
      const [t, tier] = a.dataset.preset.split(':');
      const r = form.querySelector(`[name="ctype"][value="${t}"]`);
      if (r) { r.checked = true; fillTiers(tier); compute(); }
    }));
    fillTiers(); fillFloors(); compute();
  }

  /* ---------- Lightbox ---------- */
  // Delegated, so gallery links added later (e.g. by js/cms.js) open in the viewer too.
  if ($('[data-lb]')) {
    const dlg = document.createElement('dialog');
    dlg.className = 'lb';
    dlg.setAttribute('aria-label', 'Image viewer');
    dlg.innerHTML = '<div class="lb-top"><span data-c></span><button type="button" data-x aria-label="Close"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2l12 12M14 2L2 14"/></svg></button></div><div class="lb-stage"><img alt="" title="Click for next image"></div><div class="lb-cap"><div><small class="cap-label" data-k></small><br><b data-t></b></div></div>';
    body.appendChild(dlg);
    let list = [], idx = 0, auto;
    const img = $('img', dlg);
    const render = () => {
      const a = list[idx];
      img.src = a.getAttribute('href'); img.alt = a.dataset.title || '';
      $('[data-t]', dlg).textContent = a.dataset.title || '';
      $('[data-k]', dlg).textContent = a.dataset.cat || '';
      $('[data-c]', dlg).textContent = `${String(idx + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
    };
    const go = d => { idx = (idx + d + list.length) % list.length; render(); };
    document.addEventListener('click', e => {
      const a = e.target.closest('a[data-lb]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      list = $$('a[data-lb]').filter(x => x.dataset.lb === a.dataset.lb && !x.closest('.hidden'));
      idx = list.indexOf(a); render();
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      clearInterval(auto); if (!reduce && list.length > 1) auto = setInterval(() => go(1), 3500);
    });
    img.addEventListener('click', () => go(1));
    $('[data-x]', dlg).addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => clearInterval(auto));
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.classList.contains('lb-stage')) dlg.close(); });
    dlg.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); });
  }

  /* ---------- Timelines (process page + design journey) ---------- */
  const vt = $('.vt');
  const journeys = $$('.journey');
  if (vt || journeys.length) {
    const upd = () => {
      const mid = innerHeight * 0.6;
      if (vt) {
        const r = vt.getBoundingClientRect(), fill = $('.vt-line i', vt);
        if (fill) fill.style.transform = `scaleY(${Math.min(1, Math.max(0, (mid - r.top) / r.height))})`;
        $$('.vt-step', vt).forEach(s => s.classList.toggle('active', s.getBoundingClientRect().top < mid));
      }
      journeys.forEach(j => {
        const r = j.getBoundingClientRect();
        j.style.setProperty('--jp', Math.min(1, Math.max(0, (mid - r.top) / r.height)).toFixed(3));
        $$('.jr-step', j).forEach(s => s.classList.toggle('lit', s.getBoundingClientRect().top + 28 < mid));
      });
    };
    addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd); upd();
  }

  /* ---------- Gentle parallax ---------- */
  const par = $$('[data-parallax]');
  if (par.length && !reduce) {
    let ticking = false;
    const run = () => {
      par.forEach(el => {
        const r = el.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        el.style.transform = `translate3d(0, ${(r.top + r.height / 2 - innerHeight / 2) * -(parseFloat(el.dataset.parallax) || 0.12)}px, 0)`;
      });
      ticking = false;
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } }, { passive: true });
    run();
  }

  /* ---------- Page transitions (soft fade with logo) ---------- */
  const veil = $('.veil');
  if (veil && !reduce) {
    document.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const href = a.getAttribute('href') || '';
      if (a.target || a.hasAttribute('download') || a.dataset.lb !== undefined || (a.hasAttribute('data-enquire') && !document.getElementById('enquiry')) || href.charAt(0) === '#' || /^[a-z]+:/i.test(href)) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      if (/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !/\.html$/i.test(url.pathname)) return;
      e.preventDefault();
      veil.classList.add('on');
      setTimeout(() => { location.href = a.href; }, 520);
    });
  }
  addEventListener('pageshow', () => veil && veil.classList.remove('on'));

  /* ---------- Enquiries (contact form + pop-up) ----------
     Sends to CFG.formEndpoint if set, otherwise to the Apps Script backend
     (CFG.cmsApi?api=enquiry, saved in the CMS "Enquiries" sheet + emailed).
     Without either, the visitor gets ready-to-send email / WhatsApp links. */
  const ENQ_API = String(CFG.formEndpoint || '').trim() || (String(CFG.cmsApi || '').trim() ? String(CFG.cmsApi).trim() + (String(CFG.cmsApi).indexOf('?') > -1 ? '&' : '?') + 'api=enquiry' : '');
  const SERVICES = ['Architectural design', 'Interior design', 'Structural design & engineering', 'Design & build / construction', 'PEB structures', 'Steel, roofing & cladding', 'Facades & skylights', 'Tensile fabric structure', 'Other'];
  const validPhone = v => String(v || '').replace(/[^\d]/g, '').length >= 10;
  const validEmail = v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const enquiryText = p => `New enquiry — ${CFG.company || 'SUBHA INFRA'} website\n\nName: ${p.name}\nMobile: ${p.phone}\nEmail: ${p.email || '—'}\nService: ${p.service || '—'}\nLocation: ${p.location || '—'}\n\n${p.message || ''}`;
  async function sendEnquiry(p) {
    p.page = location.pathname; p.ref = document.referrer.slice(0, 200);
    if (!ENQ_API) return { offline: true };
    const isGas = /script\.google(usercontent)?\.com/.test(ENQ_API);
    const res = isGas
      ? await fetch(ENQ_API, { method: 'POST', body: JSON.stringify(p), credentials: 'omit' })   // text/plain: no CORS pre-flight
      : await fetch(ENQ_API, { method: 'POST', body: JSON.stringify(p), headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (isGas) { const d = await res.json(); if (!d || !d.ok) throw new Error((d && d.error) || 'Not saved'); }
    try { localStorage.setItem('subha-eq', JSON.stringify({ t: Date.now(), done: 1 })); } catch (e) { }
    return { ok: true };
  }
  const offlineHtml = p => `<h3>Your enquiry is ready to send</h3><p>Choose how you would like to send it — your details are already filled in.</p><div class="actions"><a class="btn btn-bronze" href="mailto:${esc(CFG.email || '')}?subject=${encodeURIComponent('Project enquiry — ' + p.name)}&body=${encodeURIComponent(enquiryText(p))}">Send by email</a><a class="btn btn-line" href="${waLink(enquiryText(p))}" target="_blank" rel="noopener">Send on WhatsApp</a></div>`;
  const thanksHtml = name => `<h3>Thank you${name ? ', ' + esc(String(name).split(' ')[0]) : ''}.</h3><p>Your enquiry has reached our team. We will call you back shortly — usually within one working day.</p><div class="actions"><a class="btn btn-line" href="${waLink()}" target="_blank" rel="noopener">Chat on WhatsApp</a></div>`;
  const failHtml = p => `<h3>We couldn't send it online just now</h3><p>Please send it by email or WhatsApp instead — your details are already filled in — or call us on <a href="tel:${esc(CFG.phone || '')}">${esc(CFG.phoneDisplay || CFG.phone || '')}</a>.</p><div class="actions"><a class="btn btn-bronze" href="mailto:${esc(CFG.email || '')}?subject=${encodeURIComponent('Project enquiry — ' + p.name)}&body=${encodeURIComponent(enquiryText(p))}">Send by email</a><a class="btn btn-line" href="${waLink(enquiryText(p))}" target="_blank" rel="noopener">Send on WhatsApp</a></div>`;

  /* Contact page form */
  const form = $('#enquiry');
  if (form) {
    const result = $('#form-result');
    const qs = new URLSearchParams(location.search);
    const svcSel = $('[name="service"]', form);
    const want = (qs.get('service') || '').toLowerCase(), cat = (qs.get('category') || '').toLowerCase();
    if (svcSel && (want || cat)) {
      const o = [...svcSel.options].find(x => (want && x.dataset.key === want) || (cat && x.value.toLowerCase().indexOf(cat.replace(/s$/, '')) > -1));
      if (o) svcSel.value = o.value;
    }
    const pkg = qs.get('package'), msg = $('[name="message"]', form);
    if (pkg && msg && !msg.value) msg.value = 'I am interested in the ' + pkg.replace(/-/g, ' ') + ' package. ';
    const t0 = Date.now();
    const setErr = (name, m) => { const f = $(`[name="${name}"]`, form).closest('.field'); f.classList.toggle('invalid', !!m); $('.err', f).textContent = m || ''; return !m; };
    $$('input, select, textarea', form).forEach(i => i.addEventListener('input', () => { const f = i.closest('.field'); if (f && f.classList.contains('invalid')) { f.classList.remove('invalid'); } }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form), p = {}; ['name', 'phone', 'email', 'location', 'service', 'message', 'website'].forEach(k => { p[k] = String(fd.get(k) || '').trim(); });
      const ok = [setErr('name', p.name ? '' : 'Please enter your name.'), setErr('phone', validPhone(p.phone) ? '' : 'Enter a valid 10-digit mobile number.'), setErr('email', validEmail(p.email) ? '' : 'Enter a valid email address.'), setErr('message', p.message ? '' : 'Tell us a little about your project.')];
      if (ok.includes(false)) { const bad = $('.field.invalid input, .field.invalid textarea', form); if (bad) bad.focus(); return; }
      if (p.website) return;   // bot
      p.source = form.dataset.source || 'Contact page'; p.t = Date.now() - t0;
      const btn = $('[data-submit]', form), lbl = $('span', btn);
      btn.disabled = true; lbl.textContent = 'Sending…';
      result.hidden = false; result.className = 'form-result'; result.setAttribute('tabindex', '-1');
      try {
        const r = await sendEnquiry(p);
        if (r.offline) result.innerHTML = offlineHtml(p);
        else { result.classList.add('ok'); result.innerHTML = thanksHtml(p.name); form.hidden = true; }
      } catch (err) { result.classList.add('bad'); result.innerHTML = failHtml(p); }
      finally { btn.disabled = false; lbl.textContent = 'Send enquiry'; result.focus(); }
    });
  }

  /* Enquiry pop-up: opens once a few seconds after a visitor arrives, and from any [data-enquire] button */
  const POP_KEY = 'subha-eq';
  const popState = () => { try { return JSON.parse(localStorage.getItem(POP_KEY)) || {}; } catch (e) { return {}; } };
  const cmsMode = /[?&]cms_/.test(location.search) || (() => { try { return !!(sessionStorage.getItem('cms_labels') || sessionStorage.getItem('cms_preview')); } catch (e) { return false; } })();
  let pop = null, lastFocus = null, popT0 = 0;
  const buildPop = () => {
    const el = document.createElement('div');
    el.className = 'eq'; el.hidden = true;
    el.innerHTML = `<div class="eq-bg" data-eq-close></div>
      <div class="eq-card" role="dialog" aria-modal="true" aria-labelledby="eq-title">
        <button class="eq-x" type="button" data-eq-close aria-label="Close"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 2l12 12M14 2L2 14"/></svg></button>
        <div class="eq-side"><img src="${esc(asset('assets/images/home/hero-02-evening-pool-pavilion-villa.jpg'))}" alt="" loading="lazy"><div class="eq-side-in"><span class="eyebrow">SUBHA INFRA</span><h3>Designed to inspire. Built to last.</h3><ul><li>Architecture, interiors &amp; structural design</li><li>Design &amp; build, PEB, steel &amp; facades</li><li>Free first consultation</li></ul></div></div>
        <div class="eq-main">
          <span class="eyebrow">Free consultation</span>
          <h2 id="eq-title" class="mt-s">Planning a project?</h2>
          <p>Share a few details and our team will call you back.</p>
          <form novalidate>
            <div class="hp" aria-hidden="true"><label>Leave empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
            <label>Your name <i>*</i><input name="name" autocomplete="name" maxlength="80" required></label>
            <div class="row2"><label>Mobile number <i>*</i><input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="+91" required></label>
              <label>Email<input name="email" type="email" autocomplete="email" maxlength="120"></label></div>
            <label>Project type<select name="service"><option value="">Choose (optional)</option>${SERVICES.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
            <label>Project requirements<textarea name="message" maxlength="1500" placeholder="e.g. G+2 house on a 30×40 plot in Bengaluru"></textarea></label>
            <div class="eq-err" role="alert"></div>
            <div class="eq-foot"><button class="btn btn-bronze" type="submit"><span>Request a call back</span></button><button class="eq-later" type="button" data-eq-close>Maybe later</button></div>
            <p class="small-note">We respect your privacy — no spam, ever.</p>
          </form>
        </div>
      </div>`;
    document.body.appendChild(el);
    const f = $('form', el), err = $('.eq-err', el);
    el.addEventListener('click', e => { if (e.target.closest('[data-eq-close]')) closePop(); });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); closePop(); }
      if (e.key === 'Tab') {   // keep focus inside the dialog
        const fs = $$('button, input, select, textarea, a[href]', $('.eq-card', el)).filter(x => !x.closest('.hp') && x.offsetParent !== null);
        if (!fs.length) return;
        if (e.shiftKey && document.activeElement === fs[0]) { e.preventDefault(); fs[fs.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === fs[fs.length - 1]) { e.preventDefault(); fs[0].focus(); }
      }
    });
    f.addEventListener('input', e => { const l = e.target.closest('label'); if (l) l.classList.remove('bad'); err.textContent = ''; });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const p = {}; ['name', 'phone', 'email', 'service', 'message', 'website'].forEach(k => { p[k] = String(f[k].value || '').trim(); });
      const bad = [];
      if (!p.name) bad.push(['name', 'Please enter your name.']);
      if (!validPhone(p.phone)) bad.push(['phone', 'Enter a valid 10-digit mobile number.']);
      if (!validEmail(p.email)) bad.push(['email', 'Enter a valid email address.']);
      $$('label', f).forEach(l => l.classList.remove('bad'));
      if (bad.length) { bad.forEach(([k]) => f[k].closest('label').classList.add('bad')); err.textContent = bad[0][1]; f[bad[0][0]].focus(); return; }
      if (p.website) { closePop(); return; }
      p.source = 'Pop-up' + (pop.dataset.from ? ' · ' + pop.dataset.from : ''); p.t = Date.now() - popT0;
      const b = $('button[type="submit"]', f), lbl = $('span', b);
      b.disabled = true; lbl.textContent = 'Sending…';
      try {
        const r = await sendEnquiry(p);
        const main = $('.eq-main', el);
        main.innerHTML = `<div class="eq-done">${r.offline ? offlineHtml(p) : thanksHtml(p.name)}<p style="margin-top:18px"><button class="eq-later" type="button" data-eq-close>Close</button></p></div>`;
      } catch (x) { $('.eq-main', el).innerHTML = `<div class="eq-done">${failHtml(p)}<p style="margin-top:18px"><button class="eq-later" type="button" data-eq-close>Close</button></p></div>`; }
      finally { b.disabled = false; lbl.textContent = 'Request a call back'; }
    });
    return el;
  };
  function openPop(from, service) {
    if (!pop) pop = buildPop();
    pop.dataset.from = from || '';
    const sel = $('select[name="service"]', pop);
    if (sel && service) { const o = [...sel.options].find(x => x.value.toLowerCase().indexOf(String(service).toLowerCase().split(' ')[0]) === 0); if (o) sel.value = o.value; }
    lastFocus = document.activeElement; popT0 = Date.now();
    pop.hidden = false; body.classList.add('eq-open');
    requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add('on')));
    setTimeout(() => { const i = $('input[name="name"]', pop); if (i) i.focus({ preventScroll: true }); }, 350);
  }
  function closePop() {
    if (!pop || pop.hidden) return;
    pop.classList.remove('on'); body.classList.remove('eq-open');
    const st = popState(); if (!st.done) { try { localStorage.setItem(POP_KEY, JSON.stringify({ t: Date.now() })); } catch (e) { } }
    setTimeout(() => { pop.hidden = true; }, reduce ? 0 : 450);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-enquire]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || form) return;
    e.preventDefault(); openPop(a.dataset.enquire || 'Button', a.dataset.enquire);
  });
  // Automatic opening: once per visitor (again after 3 days if closed; never after an enquiry was sent)
  const st0 = popState(), DAY = 864e5;
  const auto = !form && !cmsMode && !/\/404/.test(location.pathname) && CFG.enquiryPopup !== false && !st0.done && !(st0.t && Date.now() - st0.t < 3 * DAY);
  if (auto) setTimeout(() => { if (!document.hidden && !body.classList.contains('nav-open') && !$('dialog[open]')) openPop('Auto'); }, Math.max(1500, Number(CFG.enquiryPopupDelay) || 5000));})();
