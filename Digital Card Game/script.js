// Generate a palette of 65 RGB swatches (12 hues × 5 lightness levels = 60, plus 5 neutrals incl. black),
// securely shuffle them, and assign one random swatch to each .card-media.
document.addEventListener('DOMContentLoaded', () => {
    const cards = Array.from(document.querySelectorAll('.card'));
    if (!cards.length) return;

    // Start a fresh game on each page load: clear previously saved collected sets so
    // the player always begins with a new shuffled hand and empty collected list.
    try { localStorage.removeItem('collectedCollections_v1'); } catch (e) { /* noop */ }

    // Convert HSL to RGB (returns [r,g,b])
    function hslToRgb(h, s, l){
        s /= 100;
        l /= 100;
        const k = n => (n + h/30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
    }

    // Format rgb array to CSS rgb(...) string
    function rgbString([r,g,b]){
        return `rgb(${r}, ${g}, ${b})`;
    }

    // Secure random integer in [0, max)
    function secureRandInt(max){
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const range = max;
            if (range <= 0) return 0;
            const x = new Uint32Array(1);
            const maxUint = 0xffffffff;
            const limit = Math.floor((maxUint + 1) / range) * range;
            let r;
            do {
                crypto.getRandomValues(x);
                r = x[0];
            } while (r >= limit);
            return r % range;
        }
        return Math.floor(Math.random() * max);
    }

    // Fisher-Yates shuffle using secureRandInt
    function shuffleArray(arr){
        for (let i = arr.length - 1; i > 0; i--) {
            const j = secureRandInt(i + 1);
            const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
    }

    // Build swatches: 12 hues, 5 lightness levels each
    // 12 evenly spaced hues (every 30°): 0, 30, 60, ..., 330
    // This guarantees inclusion of Yellow (60°), Cyan (180°), and Magenta (300°)
    const hues = Array.from({length: 12}, (_, k) => k * 30);
    // Friendly names for the 12 hues (matching the hues order above)
    const hueNames = [
        'Red-Orange',         // 0°
        'Yellow-Orange',  // 30°
        'Yellow',      // 60°
        'Yellow-Green', // 90°
        'Green',      // 120° (approx)
        'Blue-Green',// 150°
        'Cyan',       // 180°
        'Blue',        // 210°
        'Blue-Violet',        // 240°
        'Violet', // 270°
        'Magenta',      // 300°
        'Red'      // 330°
    ];
    // five lightness percentages (low = dark, high = light);
    // labels will be 1-5 where 1 = lightest (highest percentage)
    // Generate these programmatically to guarantee even spacing across the chosen range.
    const minLightness = 20; // darkest hue level used (avoid pure black)
    const maxLightness = 92; // lightest hue level used (avoid pure white) — raised so the lightest tones are noticeably lighter
    const lightSteps = 5;
    const lightnessLevels = Array.from({ length: lightSteps }, (_, i) =>
        Math.round(minLightness + (i * (maxLightness - minLightness)) / (lightSteps - 1))
    );
    const saturation = 80; // percent

    const swatches = [];
    hues.forEach((h, idx) => {
        const name = hueNames[idx] || `${h}°`;
        lightnessLevels.forEach((l, li) => {
            // label levels 1..5 where 1 is the lightest (highest percentage)
            const levelLabel = lightnessLevels.length - li; // e.g., li=4 (80%) -> 1
            const rgb = hslToRgb(h, saturation, l);
            swatches.push({ color: rgbString(rgb), hue: h, lightness: l, label: `${name} · V${levelLabel}` });
        });
    });

    // Add 5 neutral swatches including White and Black with 3 evenly spaced greys between them
    // We'll express neutral lightness as percentages [100,75,50,25,0] (100% = white, 0% = black)
    const neutralValues = [100, 75, 50, 25, 0];
    const neutrals = neutralValues.map((v, ni) => {
        const levelLabel = ni + 1; // ni=0 -> V1 (lightest)
        const gray = Math.round((v / 100) * 255);
        const color = `rgb(${gray}, ${gray}, ${gray})`;
        const label = v === 100 ? `White · V${levelLabel}` : (v === 0 ? `Black · V${levelLabel}` : `Neutral · V${levelLabel}`);
        return { color, hue: null, lightness: v, label };
    });
    swatches.push(...neutrals);

    // Ensure we have 65 colors
    // (12*5 = 60; +5 neutrals = 65)

    // Shuffle the swatches securely and use as an initial pool of unassigned swatches
    shuffleArray(swatches);
    const pool = swatches.slice(); // unassigned swatches
    const discardedPool = []; // swatches discarded by player (separate from pool)
    const collectedPool = []; // swatches permanently collected when collections are declared

    // render the pool status area (available / discarded / retired counts)
    function renderStatus(){
        const container = document.getElementById('pool-status');
        if(!container) return;
        const available = pool.length;
        const discarded = discardedPool.length;
        const retired = collectedPool.length;
        container.innerHTML = `
            <div class="status-pill"><span class="count">${available}</span>Available</div>
            <div class="status-pill"><span class="count">${discarded}</span>Discarded</div>
            <div class="status-pill"><span class="count">${retired}</span>Collected</div>
        `;
    }

    // If the pool is empty but there are discarded swatches, refresh the pool by
    // moving discarded swatches back into the pool (shuffled).
    function refillPoolIfEmpty(){
        if(pool.length === 0 && discardedPool.length > 0){
            shuffleArray(discardedPool);
            pool.push(...discardedPool);
            discardedPool.length = 0;
            // update UI counts
            renderStatus();
        }
    }
    const assigned = new Map(); // cardElement -> swatch object

    // helper to apply a swatch object to a .card-media element
    function applySwatchToElement(swatchEl, sw) {
        swatchEl.style.background = sw.color;
        // store the label in a data attribute and clear direct text; CSS ::after will render it
        swatchEl.dataset.label = sw.label;
        swatchEl.textContent = '';
        const parts = sw.color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (parts) {
            const r = +parts[1], g = +parts[2], b = +parts[3];
            const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
            swatchEl.style.color = luminance > 0.6 ? '#000' : '#fff';
        }
    }

    // initial assignment: pick random swatch for each card and remove from pool
    cards.forEach(card => {
        const swatchEl = card.querySelector('.card-media');
        if (!swatchEl) return;
        if (pool.length === 0) return; // should not happen
        const idx = secureRandInt(pool.length);
        const sw = pool.splice(idx, 1)[0];
        assigned.set(card, sw);
        applySwatchToElement(swatchEl, sw);
    });
    // initial status
    renderStatus();

    // Attach discard handlers: when discard clicked, swap in a random swatch from pool (unused)
    document.querySelectorAll('.card-mini.discard').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const card = btn.closest('.card');
            if (!card) return;
            const swatchEl = card.querySelector('.card-media');
            if (!swatchEl) return;

            // try to refill from discarded pool if needed
            refillPoolIfEmpty();

            if (pool.length === 0) {
                // no unused swatches available
                // visual feedback: briefly pulse the button
                btn.animate([
                    { transform: 'scale(1)' },
                    { transform: 'scale(0.96)' },
                    { transform: 'scale(1)' }
                ], { duration: 220 });
                return;
            }

            // pick a random unused swatch from pool
            const idx = secureRandInt(pool.length);
            const newSw = pool.splice(idx, 1)[0];

            // move current swatch into the discarded pool (player discarded it)
            const current = assigned.get(card);
            if (current) discardedPool.push(current);

            // assign new swatch to card
            assigned.set(card, newSw);
            applySwatchToElement(swatchEl, newSw);
            // update status UI after discard
            renderStatus();
        });
    });

    // Render full palette grid as 13x5: columns = 12 hues + 1 neutral column (on the right), rows = V1..V5
    (function renderPalette(){
        const paletteContainer = document.querySelector('#palette .palette-grid');
        if (!paletteContainer) return;

        // We'll build the grid row-by-row: for each value level (V1..V5) append 12 hues left-to-right, then the neutral for that level
        // Helper to compute lightness for a given levelLabel (1..5 where 1 = lightest)
        function lightnessForLevel(levelLabel){
            return lightnessLevels[lightnessLevels.length - levelLabel];
        }

        // Helper to find a swatch by hue and lightness
        function findHueSwatch(hue, lightness){
            return swatches.find(s => s.hue === hue && s.lightness === lightness);
        }

        // Helper to find neutral by lightness
        function findNeutralByLightness(l){
            return swatches.find(s => s.hue === null && s.lightness === l);
        }

        paletteContainer.innerHTML = '';

        const levels = lightnessLevels.length;
        for (let levelLabel = 1; levelLabel <= levels; levelLabel++) {
            const lightness = lightnessForLevel(levelLabel);

            // append each hue for this level
            for (let hi = 0; hi < hues.length; hi++) {
                const h = hues[hi];
                const sw = findHueSwatch(h, lightness);
                if (!sw) continue;

                const item = document.createElement('div');
                item.className = 'palette-swatch';

                const box = document.createElement('div');
                box.className = 'palette-box';
                box.style.background = sw.color;
                const parts = sw.color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                if (parts) {
                    const r = +parts[1], g = +parts[2], b = +parts[3];
                    const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
                    box.style.color = luminance > 0.6 ? '#000' : '#fff';
                }
                box.textContent = sw.label;

                const label = document.createElement('div');
                label.className = 'palette-label';
                label.textContent = sw.label;

                item.appendChild(box);
                item.appendChild(label);
                paletteContainer.appendChild(item);
            }

            // append the neutral for this level as the final (13th) column
            const neutralLightness = neutralValues[levelLabel - 1];
            const neutralSw = findNeutralByLightness(neutralLightness);
            if (neutralSw) {
                const nitem = document.createElement('div');
                nitem.className = 'palette-swatch';

                const nbox = document.createElement('div');
                nbox.className = 'palette-box';
                nbox.style.background = neutralSw.color;
                const nparts = neutralSw.color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                if (nparts) {
                    const r = +nparts[1], g = +nparts[2], b = +nparts[3];
                    const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
                    nbox.style.color = luminance > 0.6 ? '#000' : '#fff';
                }
                nbox.textContent = neutralSw.label;

                const nlabel = document.createElement('div');
                nlabel.className = 'palette-label';
                nlabel.textContent = neutralSw.label;

                nitem.appendChild(nbox);
                nitem.appendChild(nlabel);
                paletteContainer.appendChild(nitem);
            }
        }
    })();

    // Declare Collection: evaluate the current hand and report any matching collections
    (function wireDeclareCollection(){
        const btn = document.getElementById('declare-collection');
        if (!btn) return;

        // helpers
        function getCardDataArray(){
            // returns array of {el, id, sw, isNeutral, hueIndex, level} for ONLY selected cards (checked 'collect')
            const selected = cards.filter(card => {
                const input = card.querySelector('input.card-mini.collect');
                return input && input.checked && !input.disabled;
            });
            return selected.map(card => {
                const sw = assigned.get(card);
                const isNeutral = !sw || sw.hue === null;
                let hueIndex = null;
                if (!isNeutral) {
                    hueIndex = hues.findIndex(h => h === sw.hue);
                }
                // compute level: 1..5 where 1 = lightest
                let level = null;
                if (isNeutral) {
                    const ni = neutralValues.indexOf(sw.lightness);
                    level = ni === -1 ? null : ni + 1;
                } else {
                    const li = lightnessLevels.indexOf(sw.lightness);
                    level = li === -1 ? null : (lightnessLevels.length - li);
                }
                return { el: card, id: card.id || null, sw, isNeutral, hueIndex, level };
            });
        }

        // generate k-combinations of indices [0..n-1]
        function combinations(n, k){
            const result = [];
            const combo = Array.from({length: k}, (_,i) => i);
            function pushCombo(){ result.push(combo.slice()); }
            if (k > n) return result;
            pushCombo();
            while(true){
                let i = k - 1;
                while(i >= 0 && combo[i] === n - k + i) i--;
                if (i < 0) break;
                combo[i]++;
                for(let j = i+1; j < k; j++) combo[j] = combo[j-1] + 1;
                pushCombo();
            }
            return result;
        }

        // helpers for circular arithmetic
        function mod(n, m){ return ((n % m) + m) % m; }

        // check if indices array are consecutive of length m on hue wheel
        function isConsecutive(indices, neededLength){
            // try every possible start index s and check s, s+1..s+neededLength-1 mod 12 are all present
            const set = new Set(indices.map(x=>mod(x,12)));
            for(let s=0;s<12;s++){
                let ok = true;
                for(let off=0;off<neededLength;off++){
                    if(!set.has(mod(s+off,12))){ ok = false; break; }
                }
                if(ok) return true;
            }
            return false;
        }

        // main collection detection
        function findCollections(){
            const data = getCardDataArray();
            const n = data.length;
            const found = [];

            // utility to record a match: name and involved card ids
            function record(name, indices){
                const ids = indices.map(i => data[i].id || `card-${i+1}`);
                found.push({ name, ids });
            }

            // iterate subset sizes 2..5
            for(let k=2;k<=5;k++){
                const combs = combinations(n,k);
                combs.forEach(ci => {
                    const subset = ci.map(i => data[i]);
                    const levels = subset.map(s=>s.level);
                    const allSameLevel = levels.every(l => l !== null && l === levels[0]);

                    // Monochrome checks (hues only)
                    if(k===3){
                        // Monochrome Triad: same hue, levels 1,3,5
                        const allHue = subset.every(s=> !s.isNeutral && s.hueIndex !== -1);
                        if(allHue){
                            const hueIdxs = new Set(subset.map(s=>s.hueIndex));
                            if(hueIdxs.size===1){
                                const levelSet = new Set(levels);
                                if(levelSet.has(1) && levelSet.has(3) && levelSet.has(5) && levelSet.size===3){
                                    record('Monochrome Triad', ci);
                                }
                            }
                        }
                    }

                    if(k===4){
                        // Monochrome Tetrad: same hue, 4 consecutive levels (1-4 or 2-5)
                        const allHue = subset.every(s=> !s.isNeutral && s.hueIndex !== -1);
                        if(allHue){
                            const hueIdxs = new Set(subset.map(s=>s.hueIndex));
                            if(hueIdxs.size===1){
                                const levelVals = subset.map(s=>s.level).sort((a,b)=>a-b);
                                const possible = (levelVals.join(',') === '1,2,3,4') || (levelVals.join(',') === '2,3,4,5');
                                if(possible) record('Monochrome Tetrad', ci);
                            }
                        }
                    }

                    if(k===5){
                        // Monochrome Value Scale: same hue, levels 1..5
                        const allHue = subset.every(s=> !s.isNeutral && s.hueIndex !== -1);
                        if(allHue){
                            const hueIdxs = new Set(subset.map(s=>s.hueIndex));
                            if(hueIdxs.size===1){
                                const levelVals = subset.map(s=>s.level).sort((a,b)=>a-b);
                                if(levelVals.join(',') === '1,2,3,4,5') record('Monochrome Value Scale', ci);
                            }
                        }
                    }

                    // Grey checks (neutrals only)
                    const allNeutral = subset.every(s => s.isNeutral);
                    if(allNeutral){
                        if(k===3){
                            const levelSet = new Set(levels);
                            if(levelSet.has(1) && levelSet.has(3) && levelSet.has(5) && levelSet.size===3){
                                record('Grey Scale Triad', ci);
                            }
                        }
                        if(k===4){
                            const levelVals = subset.map(s=>s.level).sort((a,b)=>a-b);
                            const possible = (levelVals.join(',') === '1,2,3,4') || (levelVals.join(',') === '2,3,4,5');
                            if(possible) record('Grey Scale Tetrad', ci);
                        }
                        if(k===5){
                            const levelVals = subset.map(s=>s.level).sort((a,b)=>a-b);
                            if(levelVals.join(',') === '1,2,3,4,5') record('Grey Value Scale', ci);
                        }
                    }

                    // Analogous checks: same level, adjacent hues
                    if(!subset.some(s=>s.isNeutral) && allSameLevel){
                        const indices = subset.map(s=>s.hueIndex);
                        if(k===3){ if(isConsecutive(indices,3)) record('Analogous Triad', ci); }
                        if(k===4){ if(isConsecutive(indices,4)) record('Analogous Tetrad', ci); }
                        if(k===5){ if(isConsecutive(indices,5)) record('Analogous Scale', ci); }
                    }

                    // Complementary Duo
                    if(k===2 && allSameLevel && !subset.some(s=>s.isNeutral)){
                        const a = subset[0].hueIndex, b = subset[1].hueIndex;
                        if(mod(a - b,12) === 6) record('Complementary Duo', ci);
                    }

                    // Split Complementary Triad: any hue with two hues next to its complement (same level)
                    if(k===3 && allSameLevel && !subset.some(s=>s.isNeutral)){
                        // try each element as the root hue
                        const idxs = subset.map(s=>s.hueIndex);
                        for(const sHue of idxs){
                            const comp = mod(sHue + 6, 12);
                            const neighbors = [mod(comp - 1,12), mod(comp + 1,12)];
                            if(idxs.includes(neighbors[0]) && idxs.includes(neighbors[1])){
                                record('Split Complementary Triad', ci);
                                break;
                            }
                        }
                    }

                    // Hue Triad: 3 hues equally spaced (every 4 steps) same level
                    if(k===3 && allSameLevel && !subset.some(s=>s.isNeutral)){
                        const idxs = subset.map(s=>s.hueIndex).map(x=>mod(x,12));
                        // check patterns i, i+4, i+8
                        for(let s=0;s<12;s++){
                            if(idxs.includes(s) && idxs.includes(mod(s+4,12)) && idxs.includes(mod(s+8,12))){
                                record('Hue Triad', ci);
                                break;
                            }
                        }
                    }

                    // Complementary Tetrad: any 4 hues that are two complements pairs (a,a+6,b,b+6)
                    if(k===4 && allSameLevel && !subset.some(s=>s.isNeutral)){
                        const idxs = subset.map(s=>s.hueIndex).map(x=>mod(x,12));
                        // try all pairs a,b
                        for(let a=0;a<12;a++){
                            const bCandidates = idxs.filter(i => i !== a && i !== mod(a+6,12));
                            if(bCandidates.length===0) continue;
                            for(const b of bCandidates){
                                const required = new Set([a, mod(a+6,12), b, mod(b+6,12)]);
                                const match = idxs.every(i => required.has(i)) && required.size===4;
                                if(match){ record('Complementary Tetrad', ci); break; }
                            }
                        }
                    }
                });
            }

            return found;
        }

        // storage helpers for collected collections
        const STORAGE_KEY = 'collectedCollections_v1';
        function loadCollected(){
            try{ return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }catch(e){ return []; }
        }
        function saveCollected(list){ localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }

        function renderCollectedList(){
            const container = document.getElementById('collected-collections');
            if(!container) return;
            const list = loadCollected();
            container.innerHTML = '';
            if(list.length === 0) return;
            const h = document.createElement('h3');
            h.textContent = 'Collected Sets';
            container.appendChild(h);
            list.forEach(item => {
                const row = document.createElement('div');
                row.className = 'collected-item';
                const meta = document.createElement('div');
                meta.className = 'meta';
                const t = new Date(item.ts).toLocaleString();
                meta.textContent = `${item.name} — ${t}`;
                // swatch preview area (50px squares)
                const swatchesWrap = document.createElement('div');
                swatchesWrap.className = 'swatches';
                if(Array.isArray(item.swatches) && item.swatches.length){
                    item.swatches.forEach(s => {
                        const b = document.createElement('div');
                        b.className = 'swatch-box';
                        if(s && s.color) b.style.background = s.color;
                        if(s && s.label) b.title = s.label;
                        swatchesWrap.appendChild(b);
                    });
                } else {
                    // fallback: show ids as text if no snapshot available
                    const ids = document.createElement('div'); ids.className = 'ids';
                    ids.textContent = item.ids.join(', ');
                    swatchesWrap.appendChild(ids);
                }

                row.appendChild(swatchesWrap);
                row.appendChild(meta);
                container.appendChild(row);
            });
        }

        // mark cards as collected by removing their current swatch from circulation,
        // assigning a fresh swatch from the pool to the card, and clearing the checkbox
        function markCardsCollected(ids){
            ids.forEach(id => {
                const el = document.getElementById(id);
                if(!el) return;

                const swatchEl = el.querySelector('.card-media');

                // Remove the current swatch from circulation: mark it as collected permanently.
                const current = assigned.get(el);
                if(current) {
                    collectedPool.push(current);
                    // remove mapping so it's not considered assigned anymore
                    assigned.delete(el);
                }

                // Try to draw a new swatch from the pool to refresh the card. If the pool
                // is empty, first attempt to refill it from the discarded pool.
                refillPoolIfEmpty();
                if(pool.length > 0){
                    const idx = secureRandInt(pool.length);
                    const newSw = pool.splice(idx, 1)[0];
                    assigned.set(el, newSw);
                    if(swatchEl) applySwatchToElement(swatchEl, newSw);
                } else {
                    // no swatches left in pool: clear the visual state
                    if(swatchEl){
                        swatchEl.style.background = '';
                        swatchEl.dataset.label = '';
                        swatchEl.textContent = '';
                        swatchEl.style.color = '';
                    }
                }

                // Reset the collect checkbox to empty (unchecked) and enabled so the player
                // can collect the new swatch later.
                const input = el.querySelector('input.card-mini.collect');
                if(input){ input.checked = false; input.disabled = false; input.removeAttribute('aria-disabled'); }

                // remove any previous collected marker class — the card now has a fresh swatch
                el.classList.remove('collected');
            });

            // update UI counts and re-run validation so the Declare button matches current selection state
            renderStatus();
            if(typeof validateSelection === 'function') validateSelection();
        }

        // validate current checkbox selection and enable/disable the Declare button
        function validateSelection(){
            // get selected data and ids
            const data = getCardDataArray();
            const selectedIds = data.map(d => d.id || null).filter(Boolean);
            // only sizes 2..5 can match any collection
            if(data.length < 2 || data.length > 5){
                btn.disabled = true;
                btn.setAttribute('aria-disabled', 'true');
                return;
            }

            // findCollections operates on the currently selected cards (getCardDataArray)
            const matches = findCollections();

            // check whether any match exactly equals the selected set (order-independent)
            const selSorted = selectedIds.slice().sort().join(',');
            const exact = matches.some(m => (m.ids.slice().sort().join(',') === selSorted) && (m.ids.length === selectedIds.length));

            btn.disabled = !exact;
            btn.setAttribute('aria-disabled', String(!exact));
        }

        // attach listeners to collect checkboxes so we revalidate on every change
        const collectInputs = Array.from(document.querySelectorAll('input.card-mini.collect'));
        collectInputs.forEach(inp => inp.addEventListener('change', validateSelection));

        // ensure initial state reflects current selections
        validateSelection();

        // when the button is pressed evaluate only selected cards and record matches
        btn.addEventListener('click', () => {
            const data = getCardDataArray();
            if(data.length === 0){ alert('No cards selected. Use the Collect checkboxes to select cards to declare.'); return; }
            const matches = (function(){
                // reuse existing findCollections logic but operate on the selected data
                const n = data.length;
                const found = [];
                function recordLocal(name, indices){ const ids = indices.map(i => data[i].id || `card-${i+1}`); found.push({name, ids}); }
                // combinations over selected data
                function combos(n,k){ return combinations(n,k); }
                for(let k=2;k<=5;k++){
                    const combs = combos(n,k);
                    combs.forEach(ci => {
                        const subset = ci.map(i => data[i]);
                        const levels = subset.map(s=>s.level);
                        const allSameLevel = levels.every(l => l !== null && l === levels[0]);
                        const allNeutral = subset.every(s => s.isNeutral);

                        if(k===3){
                            const allHue = subset.every(s=> !s.isNeutral && s.hueIndex !== -1);
                            if(allHue){
                                const hueIdxs = new Set(subset.map(s=>s.hueIndex));
                                if(hueIdxs.size===1){
                                    const levelSet = new Set(levels);
                                    if(levelSet.has(1) && levelSet.has(3) && levelSet.has(5) && levelSet.size===3) recordLocal('Monochrome Triad', ci);
                                }
                            }
                        }

                        if(k===4){
                            const allHue = subset.every(s=> !s.isNeutral && s.hueIndex !== -1);
                            if(allHue){
                                const hueIdxs = new Set(subset.map(s=>s.hueIndex));
                                if(hueIdxs.size===1){
                                    const levelVals = subset.map(s=>s.level).sort((a,b)=>a-b);
                                    const possible = (levelVals.join(',') === '1,2,3,4') || (levelVals.join(',') === '2,3,4,5');
                                    if(possible) recordLocal('Monochrome Tetrad', ci);
                                }
                            }
                        }

                        if(k===5){
                            const allHue = subset.every(s=> !s.isNeutral && s.hueIndex !== -1);
                            if(allHue){
                                const hueIdxs = new Set(subset.map(s=>s.hueIndex));
                                if(hueIdxs.size===1){
                                    const levelVals = subset.map(s=>s.level).sort((a,b)=>a-b);
                                    if(levelVals.join(',') === '1,2,3,4,5') recordLocal('Monochrome Value Scale', ci);
                                }
                            }
                        }

                        if(allNeutral){
                            if(k===3){ const levelSet = new Set(levels); if(levelSet.has(1)&&levelSet.has(3)&&levelSet.has(5)&&levelSet.size===3) recordLocal('Grey Scale Triad', ci); }
                            if(k===4){ const levelVals = subset.map(s=>s.level).sort((a,b)=>a-b); const possible = (levelVals.join(',')==='1,2,3,4') || (levelVals.join(',')==='2,3,4,5'); if(possible) recordLocal('Grey Scale Tetrad', ci); }
                            if(k===5){ const levelVals = subset.map(s=>s.level).sort((a,b)=>a-b); if(levelVals.join(',')==='1,2,3,4,5') recordLocal('Grey Value Scale', ci); }
                        }

                        if(!subset.some(s=>s.isNeutral) && allSameLevel){
                            const indices = subset.map(s=>s.hueIndex);
                            if(k===3){ if(isConsecutive(indices,3)) recordLocal('Analogous Triad', ci); }
                            if(k===4){ if(isConsecutive(indices,4)) recordLocal('Analogous Tetrad', ci); }
                            if(k===5){ if(isConsecutive(indices,5)) recordLocal('Analogous Scale', ci); }
                        }

                        if(k===2 && allSameLevel && !subset.some(s=>s.isNeutral)){
                            const a = subset[0].hueIndex, b = subset[1].hueIndex; if(mod(a - b,12) === 6) recordLocal('Complementary Duo', ci);
                        }

                        if(k===3 && allSameLevel && !subset.some(s=>s.isNeutral)){
                            const idxs = subset.map(s=>s.hueIndex);
                            for(const sHue of idxs){ const comp = mod(sHue + 6, 12); const neighbors = [mod(comp - 1,12), mod(comp + 1,12)]; if(idxs.includes(neighbors[0]) && idxs.includes(neighbors[1])){ recordLocal('Split Complementary Triad', ci); break; } }
                        }

                        if(k===3 && allSameLevel && !subset.some(s=>s.isNeutral)){
                            const idxs = subset.map(s=>s.hueIndex).map(x=>mod(x,12));
                            for(let s=0;s<12;s++){ if(idxs.includes(s) && idxs.includes(mod(s+4,12)) && idxs.includes(mod(s+8,12))){ recordLocal('Hue Triad', ci); break; } }
                        }

                        if(k===4 && allSameLevel && !subset.some(s=>s.isNeutral)){
                            const idxs = subset.map(s=>s.hueIndex).map(x=>mod(x,12));
                            for(let a=0;a<12;a++){
                                const bCandidates = idxs.filter(i => i !== a && i !== mod(a+6,12));
                                if(bCandidates.length===0) continue;
                                for(const b of bCandidates){ const required = new Set([a, mod(a+6,12), b, mod(b+6,12)]); const match = idxs.every(i => required.has(i)) && required.size===4; if(match){ recordLocal('Complementary Tetrad', ci); break; } }
                            }
                        }
                    });
                }
                return found;
            })();

            if(matches.length === 0){ alert('No valid collections found among the selected cards.'); return; }

            // Deduplicate overlapping matches: for the same exact set of card ids choose one collection rule
            // Priority: prefer larger/more specific collections (value scales > tetrads > triads > duos)
            const priority = {
                'Monochrome Value Scale': 1,
                'Monochrome Tetrad': 2,
                'Monochrome Triad': 3,
                'Grey Value Scale': 1,
                'Grey Scale Tetrad': 2,
                'Grey Scale Triad': 3,
                'Analogous Scale': 1,
                'Analogous Tetrad': 2,
                'Analogous Triad': 3,
                'Complementary Tetrad': 2,
                'Hue Triad': 3,
                'Split Complementary Triad': 3,
                'Complementary Duo': 4
            };

            const grouped = Object.create(null);
            matches.forEach(m => {
                const key = m.ids.slice().sort().join(',');
                if(!grouped[key]) grouped[key] = m;
                else {
                    const existing = grouped[key];
                    const pNew = priority[m.name] || 99;
                    const pExisting = priority[existing.name] || 99;
                    if(pNew < pExisting) grouped[key] = m;
                }
            });
            const uniqueMatches = Object.values(grouped);

            // load stored collections and add any new ones
            const stored = loadCollected();
            let added = 0;
            uniqueMatches.forEach(m => {
                // detect duplicate: same name and same ids (order-independent)
                const idsSorted = m.ids.slice().sort().join(',');
                const exists = stored.some(s => s.name === m.name && s.ids.slice().sort().join(',') === idsSorted);
                // capture swatch snapshots (color + label) for rendering later
                const swSnapshots = m.ids.map(id => {
                    const el = document.getElementById(id);
                    if(!el) return null;
                    const sw = assigned.get(el);
                    if(!sw) return null;
                    return { color: sw.color, label: sw.label };
                });
                if(!exists){
                    stored.push({ name: m.name, ids: m.ids, swatches: swSnapshots, ts: Date.now() });
                    added++;
                }
                // mark cards collected in the UI
                markCardsCollected(m.ids);
            });
            if(added > 0) saveCollected(stored);
            renderCollectedList();

            const lines = uniqueMatches.map(m => `${m.name}: ${m.ids.join(', ')}`);
            alert((added>0? 'New collections saved:\n' : 'Collections found (already saved or newly found):\n') + lines.join('\n'));
        });
        // render on load
        renderCollectedList();
    })();

    // Toggle palette visibility button
    (function wirePaletteToggle(){
        const toggleBtn = document.getElementById('toggle-palette');
        const paletteEl = document.getElementById('palette');
        if (!toggleBtn || !paletteEl) return;

        // ensure aria state reflects initial visibility
        toggleBtn.setAttribute('aria-expanded', String(!paletteEl.classList.contains('hidden')));

        toggleBtn.addEventListener('click', () => {
            const hidden = paletteEl.classList.toggle('hidden');
            // update ARIA and button label
            paletteEl.setAttribute('aria-hidden', String(hidden));
            toggleBtn.setAttribute('aria-expanded', String(!hidden));
            toggleBtn.textContent = hidden ? 'Show Palette' : 'Hide Palette';
        });
    })();
});
