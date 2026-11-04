(function () {
  const { divideBeds, parseBedList } = window.Divider;
  const STORE = 'bed-divider:v1';
  // Distinct colors that keep white text readable.
  const COLORS = ['#1f6feb', '#d1453b', '#1a7f37', '#8250df', '#bc4c00', '#0a7d8c', '#bf3989', '#6e7781',
                  '#9a6700', '#0550ae', '#a40e26', '#116329', '#6639ba', '#953800', '#1b7c83', '#99286e'];
  const color = (i) => COLORS[i % COLORS.length];

  const defaults = () => ({ bedText: '1-20', beds: parseBedList('1-20'), occupied: {}, staffCount: 3, names: [] });

  let state = load();

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && Array.isArray(s.beds)) return Object.assign(defaults(), s);
    } catch (e) { /* storage unavailable */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  const $ = (id) => document.getElementById(id);
  const grid = $('bed-grid');
  const results = $('results');
  const countInput = $('staff-count');
  const namesBox = $('staff-names');

  const staffName = (i) => (state.names[i] || '').trim() || `Staff ${i + 1}`;

  function setStaffCount(n) {
    n = Math.max(1, Math.min(50, Math.floor(Number(n) || 1)));
    state.staffCount = n;
    countInput.value = n;
    renderNames();
    update();
  }

  function renderNames() {
    const existing = namesBox.querySelectorAll('input').length;
    if (existing === state.staffCount) return;
    namesBox.innerHTML = '';
    for (let i = 0; i < state.staffCount; i++) {
      const label = document.createElement('label');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = color(i);
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `Staff ${i + 1}`;
      input.value = state.names[i] || '';
      input.setAttribute('aria-label', `Name for staff ${i + 1}`);
      input.addEventListener('input', () => { state.names[i] = input.value; update(); });
      label.append(sw, input);
      namesBox.append(label);
    }
  }

  function update() {
    const beds = state.beds.map((id) => ({ id, occupied: !!state.occupied[id] }));
    const { groups } = divideBeds(beds, state.staffCount);
    const ownerOf = {};
    groups.forEach((g, i) => [...g.occupied, ...g.empty].forEach((id) => { ownerOf[id] = i; }));

    // Bed grid
    grid.innerHTML = '';
    for (const b of beds) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const owner = ownerOf[b.id];
      btn.className = 'bed ' + (b.occupied ? 'occupied' : 'empty') + (owner != null ? ' owned' : '');
      btn.setAttribute('aria-pressed', String(b.occupied));
      btn.setAttribute('aria-label', `Bed ${b.id}, ${b.occupied ? 'occupied' : 'empty'}` + (owner != null ? `, ${staffName(owner)}` : ''));
      if (b.occupied && owner != null) { btn.style.background = color(owner); btn.style.borderColor = color(owner); }
      else if (owner != null) { btn.style.color = color(owner); }
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = b.id;
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = b.occupied ? (owner != null ? staffName(owner) : '') : 'empty';
      btn.append(name, who);
      btn.addEventListener('click', () => {
        if (state.occupied[b.id]) delete state.occupied[b.id]; else state.occupied[b.id] = true;
        update();
      });
      grid.append(btn);
    }

    const occCount = beds.filter((b) => b.occupied).length;
    $('census').textContent = `${occCount} of ${beds.length} occupied.`;

    // Result cards
    results.innerHTML = '';
    if (occCount === 0) {
      const p = document.createElement('p');
      p.className = 'notice';
      p.textContent = 'No beds are marked occupied yet, so only empty beds are split below.';
      results.append(p);
    }
    groups.forEach((g, i) => {
      const card = document.createElement('article');
      card.className = 'card';
      card.style.borderLeftColor = color(i);
      const h = document.createElement('h3');
      const nm = document.createElement('span');
      nm.textContent = staffName(i);
      const ct = document.createElement('span');
      ct.className = 'count';
      ct.textContent = `${g.occupied.length} patient${g.occupied.length === 1 ? '' : 's'}`;
      h.append(nm, ct);
      const bedsP = document.createElement('p');
      bedsP.className = 'beds';
      bedsP.textContent = g.occupied.length ? g.occupied.join(', ') : 'No occupied beds';
      card.append(h, bedsP);
      if (g.empty.length) {
        const openP = document.createElement('p');
        openP.className = 'open';
        openP.textContent = `Empty beds in this area: ${g.empty.join(', ')}`;
        card.append(openP);
      }
      results.append(card);
    });

    save();
  }

  // Bed list editor
  const editor = $('bed-editor');
  const toggle = $('edit-beds-toggle');
  const bedList = $('bed-list');
  toggle.addEventListener('click', () => {
    const open = editor.hidden;
    editor.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close bed list' : 'Edit bed list';
    if (open) { bedList.value = state.bedText; bedList.focus(); }
  });
  $('apply-beds').addEventListener('click', () => {
    const beds = parseBedList(bedList.value);
    if (!beds.length) { bedList.focus(); return; }
    state.bedText = bedList.value;
    state.beds = beds;
    const keep = {};
    beds.forEach((id) => { if (state.occupied[id]) keep[id] = true; });
    state.occupied = keep;
    update();
  });

  $('all-occ').addEventListener('click', () => { state.occupied = {}; state.beds.forEach((id) => { state.occupied[id] = true; }); update(); });
  $('all-empty').addEventListener('click', () => { state.occupied = {}; update(); });

  countInput.addEventListener('change', () => setStaffCount(countInput.value));
  $('staff-minus').addEventListener('click', () => setStaffCount(state.staffCount - 1));
  $('staff-plus').addEventListener('click', () => setStaffCount(state.staffCount + 1));
  $('print').addEventListener('click', () => window.print());
  $('reset').addEventListener('click', () => {
    if (!confirm('Clear the bed list, occupied beds, and staff names?')) return;
    state = defaults();
    namesBox.innerHTML = '';
    setStaffCount(state.staffCount);
  });

  setStaffCount(state.staffCount);
})();
