/*
	Playground — interactive mathematics for Bradley Vigil's site.
	Vanilla JS (no dependencies). Adds a grid of small canvas demos plus a
	full Cech-nerve playground. Author: added section.
*/
(function () {
	'use strict';

	var ACCENT = '#ff474c';       // site accent (from particles config)
	var ACCENT2 = '#ffd15a';      // warm secondary
	var INK = '#ffffff';
	var FAINT = 'rgba(255,255,255,0.16)';
	var FAINT2 = 'rgba(255,255,255,0.35)';

	// ---- small helpers ---------------------------------------------------

	function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
	function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

	// Fit a canvas to its CSS width at a given aspect (height = width*aspect).
	// Returns null while the canvas is not laid out (e.g. panel hidden).
	function fit(canvas, aspect) {
		var w = canvas.clientWidth || canvas.getBoundingClientRect().width;
		if (!w) return null;
		var h = Math.max(120, Math.round(w * aspect));
		var dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.style.height = h + 'px';
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		var ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		return { ctx: ctx, w: w, h: h };
	}

	// Pointer position in CSS pixels relative to canvas.
	function ptr(canvas, e) {
		var r = canvas.getBoundingClientRect();
		var t = (e.touches && e.touches[0]) || e;
		return { x: t.clientX - r.left, y: t.clientY - r.top };
	}

	function arrow(ctx, x0, y0, x1, y1, color, width) {
		var a = Math.atan2(y1 - y0, x1 - x0);
		var head = 8;
		ctx.strokeStyle = color; ctx.fillStyle = color;
		ctx.lineWidth = width || 2;
		ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.lineTo(x1 - head * Math.cos(a - 0.4), y1 - head * Math.sin(a - 0.4));
		ctx.lineTo(x1 - head * Math.cos(a + 0.4), y1 - head * Math.sin(a + 0.4));
		ctx.closePath(); ctx.fill();
	}

	// Union-find for component counting.
	function components(n, edges) {
		var p = []; for (var i = 0; i < n; i++) p[i] = i;
		function f(x) { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }
		for (var k = 0; k < edges.length; k++) { var a = f(edges[k][0]), b = f(edges[k][1]); if (a !== b) p[a] = b; }
		var s = {}; for (var j = 0; j < n; j++) s[f(j)] = 1;
		return Object.keys(s).length;
	}

	// Pick the disk under the pointer: nearest center among all disks that
	// contain p. Grabbing works anywhere inside a ball (radius r), with a
	// small minimum grab radius so tiny/zero-radius disks stay draggable.
	function pickDisk(p, pjs, r) {
		var idx = -1, bd = Infinity, grab = Math.max(r, 12);
		for (var i = 0; i < pjs.length; i++) {
			var d = dist(p.x, p.y, pjs[i][0], pjs[i][1]);
			if (d <= grab && d < bd) { bd = d; idx = i; }
		}
		return idx;
	}

	// Minimum enclosing circle radius of 3 points (exact Cech triangle test).
	function mecRadius3(P) {
		var best = Infinity;
		function enc(cx, cy, R) {
			for (var i = 0; i < 3; i++) if (dist(cx, cy, P[i][0], P[i][1]) > R + 1e-6) return false;
			return true;
		}
		// diameter circles of each pair
		var pairs = [[0, 1], [1, 2], [0, 2]];
		for (var k = 0; k < 3; k++) {
			var a = P[pairs[k][0]], b = P[pairs[k][1]];
			var cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, R = dist(a[0], a[1], b[0], b[1]) / 2;
			if (enc(cx, cy, R) && R < best) best = R;
		}
		// circumcircle
		var ax = P[0][0], ay = P[0][1], bx = P[1][0], by = P[1][1], cx2 = P[2][0], cy2 = P[2][1];
		var d = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by));
		if (Math.abs(d) > 1e-9) {
			var ux = ((ax * ax + ay * ay) * (by - cy2) + (bx * bx + by * by) * (cy2 - ay) + (cx2 * cx2 + cy2 * cy2) * (ay - by)) / d;
			var uy = ((ax * ax + ay * ay) * (cx2 - bx) + (bx * bx + by * by) * (ax - cx2) + (cx2 * cx2 + cy2 * cy2) * (bx - ax)) / d;
			var Rc = dist(ux, uy, ax, ay);
			if (enc(ux, uy, Rc) && Rc < best) best = Rc;
		}
		return best;
	}

	// Persistent homology (Z/2) up to dimension 1 for a planar point set.
	// Filtration parameter is the disk radius r; an edge is born at dist/2,
	// a triangle at max-edge/2 (Rips) or the min-enclosing-circle radius (Cech).
	// Returns { h0: [{b,d}], h1: [{b,d}] } with d = Infinity for essential bars.
	function persistence(pj, cechMode) {
		var n = pj.length, i, j, k;
		if (n === 0) return { h0: [], h1: [] };
		var simp = [];
		for (i = 0; i < n; i++) simp.push({ v: [i], dim: 0, val: 0 });
		var eval_ = {};
		for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
			var ev = dist(pj[i][0], pj[i][1], pj[j][0], pj[j][1]) / 2;
			eval_[i + ',' + j] = ev; simp.push({ v: [i, j], dim: 1, val: ev });
		}
		for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) for (k = j + 1; k < n; k++) {
			var em = Math.max(eval_[i + ',' + j], eval_[j + ',' + k], eval_[i + ',' + k]);
			var tv = cechMode ? Math.max(em, mecRadius3([pj[i], pj[j], pj[k]])) : em;
			simp.push({ v: [i, j, k], dim: 2, val: tv });
		}
		for (i = 0; i < simp.length; i++) simp[i].o = i;
		simp.sort(function (a, b) { return a.val - b.val || a.dim - b.dim || a.o - b.o; });
		var idx = {};
		for (i = 0; i < simp.length; i++) idx[simp[i].v.join(',')] = i;
		function bnd(sx) {
			if (sx.dim === 0) return [];
			var vs = sx.v, f = [];
			for (var a = 0; a < vs.length; a++) f.push(idx[vs.slice(0, a).concat(vs.slice(a + 1)).join(',')]);
			f.sort(function (x, y) { return x - y; });
			return f;
		}
		function xor(a, b) {
			var r = [], x = 0, y = 0;
			while (x < a.length && y < b.length) {
				if (a[x] === b[y]) { x++; y++; }
				else if (a[x] < b[y]) r.push(a[x++]);
				else r.push(b[y++]);
			}
			while (x < a.length) r.push(a[x++]);
			while (y < b.length) r.push(b[y++]);
			return r;
		}
		var cols = simp.map(bnd), pivot = {}, paired = {}, h0 = [], h1 = [];
		for (var c = 0; c < cols.length; c++) {
			var col = cols[c], l = col.length ? col[col.length - 1] : -1;
			while (l !== -1 && pivot[l] !== undefined) { col = xor(col, cols[pivot[l]]); l = col.length ? col[col.length - 1] : -1; }
			cols[c] = col;
			if (l !== -1) {
				pivot[l] = c; paired[l] = 1; paired[c] = 1;
				var bd = simp[l], dd = simp[c];
				if (bd.dim === 0) h0.push({ b: bd.val, d: dd.val });
				else if (bd.dim === 1) h1.push({ b: bd.val, d: dd.val });
			}
		}
		for (var q = 0; q < simp.length; q++) {
			if (paired[q]) continue;
			if (simp[q].dim === 0) h0.push({ b: simp[q].val, d: Infinity });
			else if (simp[q].dim === 1) h1.push({ b: simp[q].val, d: Infinity });
		}
		return { h0: h0, h1: h1 };
	}

	// registry of demos with .relayout()
	var demos = [];
	function register(d) { demos.push(d); }
	function relayoutAll() { for (var i = 0; i < demos.length; i++) { try { demos[i].relayout(); } catch (e) {} } }

	// single animation loop (for demos that opt in) — only runs when visible
	var animated = [];
	var panelVisible = false;
	function loop() {
		if (panelVisible) { for (var i = 0; i < animated.length; i++) { try { animated[i](); } catch (e) {} } }
		requestAnimationFrame(loop);
	}

	// =====================================================================
	//  GRID DEMO: Dot product & projection
	// =====================================================================
	function demoDot(card) {
		var canvas = card.querySelector('canvas');
		var out = card.querySelector('[data-role=readout]');
		var A = { x: 0.78, y: 0.30 }, B = { x: 0.60, y: 0.74 }; // normalized tip positions
		var geo = null, drag = null;

		function O() { return { x: geo.w * 0.24, y: geo.h * 0.74 }; }
		function tip(v) { return { x: v.x * geo.w, y: v.y * geo.h }; }

		function draw() {
			if (!geo) return;
			var ctx = geo.ctx, w = geo.w, h = geo.h, o = O();
			ctx.clearRect(0, 0, w, h);
			// axes
			ctx.strokeStyle = FAINT; ctx.lineWidth = 1;
			ctx.beginPath(); ctx.moveTo(8, o.y); ctx.lineTo(w - 8, o.y); ctx.moveTo(o.x, 8); ctx.lineTo(o.x, h - 8); ctx.stroke();
			var ta = tip(A), tb = tip(B);
			var ax = ta.x - o.x, ay = ta.y - o.y, bx = tb.x - o.x, by = tb.y - o.y;
			var aa = ax * ax + ay * ay;
			var dp = ax * bx + ay * by;
			var t = aa > 1e-6 ? dp / aa : 0;
			var px = o.x + t * ax, py = o.y + t * ay; // foot of projection
			// projection shadow along a
			ctx.strokeStyle = 'rgba(255,71,76,0.35)'; ctx.lineWidth = 9;
			ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(px, py); ctx.stroke();
			// dashed perpendicular from b tip to foot
			ctx.setLineDash([4, 4]); ctx.strokeStyle = FAINT2; ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.moveTo(tb.x, tb.y); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
			// vectors
			arrow(ctx, o.x, o.y, ta.x, ta.y, ACCENT, 2.5);
			arrow(ctx, o.x, o.y, tb.x, tb.y, ACCENT2, 2.5);
			// tips
			[[ta, ACCENT, 'a'], [tb, ACCENT2, 'b']].forEach(function (it) {
				ctx.fillStyle = it[1]; ctx.beginPath(); ctx.arc(it[0].x, it[0].y, 5, 0, 7); ctx.fill();
				ctx.fillStyle = INK; ctx.font = '600 13px sans-serif';
				ctx.fillText(it[2], it[0].x + 8, it[0].y - 6);
			});
			var mag = Math.sqrt(aa) || 1;
			var scal = dp / mag; // |b|cos(theta) = projection length
			var cos = dp / (mag * (Math.sqrt(bx * bx + by * by) || 1));
			out.innerHTML = 'a&middot;b = <b>' + (dp / 4000).toFixed(2) + '</b> &nbsp; scalar proj = <b>' + (scal / 63).toFixed(2) + '</b> &nbsp; cos&theta; = <b>' + cos.toFixed(2) + '</b>';
		}

		function pick(p) {
			var ta = tip(A), tb = tip(B);
			if (dist(p.x, p.y, ta.x, ta.y) < 18) return A;
			if (dist(p.x, p.y, tb.x, tb.y) < 18) return B;
			return null;
		}
		canvas.addEventListener('mousedown', function (e) { drag = pick(ptr(canvas, e)); });
		canvas.addEventListener('touchstart', function (e) { drag = pick(ptr(canvas, e)); if (drag) e.preventDefault(); }, { passive: false });
		window.addEventListener('mousemove', function (e) { if (!drag || !geo) return; var p = ptr(canvas, e); drag.x = clamp(p.x / geo.w, 0.02, 0.98); drag.y = clamp(p.y / geo.h, 0.02, 0.98); draw(); });
		window.addEventListener('touchmove', function (e) { if (!drag || !geo) return; var p = ptr(canvas, e); drag.x = clamp(p.x / geo.w, 0.02, 0.98); drag.y = clamp(p.y / geo.h, 0.02, 0.98); draw(); e.preventDefault(); }, { passive: false });
		window.addEventListener('mouseup', function () { drag = null; });
		window.addEventListener('touchend', function () { drag = null; });

		register({ relayout: function () { var g = fit(canvas, 0.82); if (g) { geo = g; draw(); } } });
	}

	// =====================================================================
	//  GRID DEMO: Gradient & steepest ascent (banded heat = contours)
	// =====================================================================
	function demoGradient(card) {
		var canvas = card.querySelector('canvas');
		var out = card.querySelector('[data-role=readout]');
		var geo = null, bg = null, mouse = null, dir = 1; // dir=+1 ascent, -1 descent
		var seg = card.querySelector('[data-role=dir]');
		// field: sum of gaussian bumps (normalized coords 0..1)
		var bumps = [
			{ x: 0.32, y: 0.40, A: 1.0, s: 0.18 },
			{ x: 0.70, y: 0.62, A: 0.85, s: 0.16 },
			{ x: 0.62, y: 0.24, A: -0.7, s: 0.13 }
		];
		function f(x, y) { var v = 0; for (var i = 0; i < bumps.length; i++) { var b = bumps[i]; var dx = x - b.x, dy = y - b.y; v += b.A * Math.exp(-(dx * dx + dy * dy) / (2 * b.s * b.s)); } return v; }
		function grad(x, y) { var gx = 0, gy = 0; for (var i = 0; i < bumps.length; i++) { var b = bumps[i]; var dx = x - b.x, dy = y - b.y; var e = b.A * Math.exp(-(dx * dx + dy * dy) / (2 * b.s * b.s)); gx += e * (-dx / (b.s * b.s)); gy += e * (-dy / (b.s * b.s)); } return { x: gx, y: gy }; }

		function buildBG() {
			var w = geo.w, h = geo.h;
			var off = document.createElement('canvas'); off.width = w; off.height = h;
			var octx = off.getContext('2d');
			var img = octx.createImageData(w, h);
			var lo = Infinity, hi = -Infinity, i, j;
			var grid = [];
			for (j = 0; j < h; j += 1) { grid[j] = []; for (i = 0; i < w; i += 1) { var val = f(i / w, j / h); grid[j][i] = val; if (val < lo) lo = val; if (val > hi) hi = val; } }
			var bands = 9;
			for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
				var t = (grid[j][i] - lo) / (hi - lo + 1e-9);
				var q = Math.floor(t * bands) / bands;      // quantize -> visible contour bands
				// ramp: dark slate -> accent -> warm
				var r, g2, bl;
				if (q < 0.5) { var u = q / 0.5; r = 26 + u * (255 - 26); g2 = 30 + u * (71 - 30); bl = 34 + u * (76 - 34); }
				else { var u2 = (q - 0.5) / 0.5; r = 255; g2 = 71 + u2 * (209 - 71); bl = 76 + u2 * (90 - 76); }
				var k = (j * w + i) * 4;
				img.data[k] = r; img.data[k + 1] = g2; img.data[k + 2] = bl; img.data[k + 3] = 235;
			}
			octx.putImageData(img, 0, 0);
			bg = off;
		}

		function draw() {
			if (!geo || !bg) return;
			var ctx = geo.ctx, w = geo.w, h = geo.h;
			ctx.clearRect(0, 0, w, h);
			ctx.drawImage(bg, 0, 0);
			if (mouse) {
				var nx = mouse.x / w, ny = mouse.y / h;
				var g = grad(nx, ny);
				var gm = Math.sqrt(g.x * g.x + g.y * g.y) || 1e-6;
				var ux = dir * g.x / gm, uy = dir * g.y / gm;   // flip for descent
				var L = 34;
				// level-set tangent (perp to gradient)
				ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
				ctx.beginPath(); ctx.moveTo(mouse.x - uy * 22, mouse.y + ux * 22); ctx.lineTo(mouse.x + uy * 22, mouse.y - ux * 22); ctx.stroke();
				// +/- gradient arrow (accent for descent, ink for ascent)
				arrow(ctx, mouse.x, mouse.y, mouse.x + ux * L, mouse.y + uy * L, dir > 0 ? INK : ACCENT, 2.5);
				ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 3.5, 0, 7); ctx.fill();
				out.innerHTML = '|&nabla;f| = <b>' + gm.toFixed(2) + '</b> &nbsp; steepest ' + (dir > 0 ? 'ascent (+&nabla;f)' : 'descent (&minus;&nabla;f)');
			} else {
				out.innerHTML = 'move over the surface &rarr; the arrow is ' + (dir > 0 ? '+&nabla;f' : '&minus;&nabla;f');
			}
		}
		canvas.addEventListener('mousemove', function (e) { mouse = ptr(canvas, e); draw(); });
		canvas.addEventListener('mouseleave', function () { mouse = null; draw(); });
		canvas.addEventListener('touchmove', function (e) { mouse = ptr(canvas, e); draw(); e.preventDefault(); }, { passive: false });
		if (seg) seg.addEventListener('click', function (e) {
			var btn = e.target.closest('button'); if (!btn) return;
			dir = btn.getAttribute('data-val') === 'descent' ? -1 : 1;
			seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
			btn.classList.add('active'); draw();
		});

		register({ relayout: function () { var g = fit(canvas, 0.82); if (g) { geo = g; buildBG(); draw(); } } });
	}

	// =====================================================================
	//  GRID DEMO: Frenet moving frame (animated)
	// =====================================================================
	function demoFrenet(card) {
		var canvas = card.querySelector('canvas');
		var out = card.querySelector('[data-role=readout]');
		var geo = null, t = 0, target = null;
		var sel = card.querySelector('[data-role=curve]');
		var CURVES = {
			peanut: function (tt, cx, cy, S) { var R = 1 + 0.34 * Math.cos(2 * tt) + 0.10 * Math.sin(3 * tt); return { x: cx + S * R * Math.cos(tt), y: cy + S * R * Math.sin(tt) }; },
			ellipse: function (tt, cx, cy, S) { return { x: cx + S * 1.30 * Math.cos(tt), y: cy + S * 0.72 * Math.sin(tt) }; },
			figure8: function (tt, cx, cy, S) { return { x: cx + S * 1.20 * Math.sin(tt), y: cy + S * 1.00 * Math.sin(tt) * Math.cos(tt) }; },
			rose: function (tt, cx, cy, S) { var R = Math.cos(3 * tt); return { x: cx + S * 1.20 * R * Math.cos(tt), y: cy + S * 1.20 * R * Math.sin(tt) }; },
			limacon: function (tt, cx, cy, S) { var R = 0.60 + 0.85 * Math.cos(tt); return { x: cx + S * 1.05 * R * Math.cos(tt) - S * 0.25, y: cy + S * 1.05 * R * Math.sin(tt) }; },
			cardioid: function (tt, cx, cy, S) { var R = 0.62 * (1 - Math.cos(tt)); return { x: cx + S * 1.55 * R * Math.cos(tt) + S * 0.55, y: cy - S * 1.55 * R * Math.sin(tt) }; },
			astroid: function (tt, cx, cy, S) { var c = Math.cos(tt), s = Math.sin(tt); return { x: cx + S * 1.15 * c * c * c, y: cy + S * 1.15 * s * s * s }; }
		};
		var curveKey = 'peanut';

		function pt(tt) {
			var w = geo.w, h = geo.h, cx = w / 2, cy = h / 2, S = Math.min(w, h) * 0.30;
			return CURVES[curveKey](tt, cx, cy, S);
		}
		if (sel) sel.addEventListener('change', function () { curveKey = sel.value; t = 0; target = null; });
		function draw() {
			if (!geo) return;
			var ctx = geo.ctx, w = geo.w, h = geo.h;
			ctx.clearRect(0, 0, w, h);
			// curve
			ctx.strokeStyle = FAINT2; ctx.lineWidth = 2; ctx.beginPath();
			for (var i = 0; i <= 240; i++) { var q = pt(i / 240 * Math.PI * 2); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
			ctx.closePath(); ctx.stroke();
			// advance / steer
			if (target != null) { var d = ((target - t + Math.PI * 3) % (Math.PI * 2)) - Math.PI; t += d * 0.12; }
			else { t += 0.012; }
			var dt = 0.008;
			var p0 = pt(t - dt), p1 = pt(t), p2 = pt(t + dt);
			var vx = (p2.x - p0.x) / (2 * dt), vy = (p2.y - p0.y) / (2 * dt);
			var axx = (p2.x - 2 * p1.x + p0.x) / (dt * dt), ayy = (p2.y - 2 * p1.y + p0.y) / (dt * dt);
			var sp = Math.sqrt(vx * vx + vy * vy) || 1e-6;
			var Tx = vx / sp, Ty = vy / sp;
			var cross = vx * ayy - vy * axx;
			var kappa = Math.abs(cross) / Math.pow(sp, 3);
			var sign = cross > 0 ? 1 : -1;
			var Nx = -Ty * sign, Ny = Tx * sign;
			var Rc = kappa > 1e-5 ? 1 / kappa : 1e5;
			Rc = Math.min(Rc, Math.max(geo.w, geo.h));
			// osculating circle
			ctx.strokeStyle = 'rgba(255,209,90,0.6)'; ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.arc(p1.x + Nx * Rc, p1.y + Ny * Rc, Rc, 0, 7); ctx.stroke();
			// T and N
			arrow(ctx, p1.x, p1.y, p1.x + Tx * 34, p1.y + Ty * 34, ACCENT, 2.5);
			arrow(ctx, p1.x, p1.y, p1.x + Nx * 28, p1.y + Ny * 28, ACCENT2, 2.5);
			ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(p1.x, p1.y, 4, 0, 7); ctx.fill();
			ctx.font = '600 12px sans-serif'; ctx.fillStyle = ACCENT; ctx.fillText('T', p1.x + Tx * 40, p1.y + Ty * 40);
			ctx.fillStyle = ACCENT2; ctx.fillText('N', p1.x + Nx * 34, p1.y + Ny * 34);
			out.innerHTML = '&kappa; = <b>' + (kappa * 100).toFixed(2) + '</b> &nbsp; osculating radius &asymp; <b>' + Rc.toFixed(0) + '</b>px';
		}
		canvas.addEventListener('mousemove', function (e) {
			if (!geo) return; var p = ptr(canvas, e); var best = 0, bd = Infinity;
			for (var i = 0; i < 120; i++) { var tt = i / 120 * Math.PI * 2; var q = pt(tt); var d = dist(p.x, p.y, q.x, q.y); if (d < bd) { bd = d; best = tt; } }
			target = best;
		});
		canvas.addEventListener('mouseleave', function () { target = null; });

		register({ relayout: function () { var g = fit(canvas, 0.82); if (g) geo = g; } });
		animated.push(draw);
	}

	// =====================================================================
	//  GRID DEMO: Riemann sums
	// =====================================================================
	function demoRiemann(card) {
		var canvas = card.querySelector('canvas');
		var out = card.querySelector('[data-role=readout]');
		var nInput = card.querySelector('[data-role=n]');
		var nLabel = card.querySelector('[data-role=nlabel]');
		var seg = card.querySelector('[data-role=rule]');
		var geo = null, n = 8, rule = 'left';
		var selFn = card.querySelector('[data-role=fn]');
		var FUNCS = {
			wave:  { A: 0, B: 6, f: function (x) { return 1.15 + 0.72 * Math.sin(x) + 0.32 * Math.sin(2.3 * x + 1.1); } },
			bump:  { A: 0, B: 6, f: function (x) { return 0.25 + 2.10 * Math.exp(-Math.pow(x - 3, 2) / 1.4); } },
			parab: { A: 0, B: 6, f: function (x) { return 0.20 + 0.19 * x * (6 - x); } },
			hump:  { A: 0, B: 6, f: function (x) { return 0.15 + 2.00 * Math.abs(Math.sin(x * 0.62)); } },
			decay: { A: 0, B: 6, f: function (x) { return 0.15 + 2.30 * Math.exp(-0.42 * x); } }
		};
		var fnKey = 'wave';
		function f(x) { return FUNCS[fnKey].f(x); }

		function draw() {
			if (!geo) return;
			var ctx = geo.ctx, w = geo.w, h = geo.h;
			var padL = 24, padB = 22, padT = 12, padR = 10;
			var x0 = padL, x1 = w - padR, y0 = h - padB, y1 = padT;
			var conf = FUNCS[fnKey], A = conf.A, B = conf.B;
			var fmax = 0.001;
			for (var q = 0; q <= 160; q++) { var fv0 = f(A + q / 160 * (B - A)); if (fv0 > fmax) fmax = fv0; }
			fmax *= 1.15;
			function X(x) { return x0 + (x - A) / (B - A) * (x1 - x0); }
			function Y(v) { return y0 + (v / fmax) * (y1 - y0); }
			ctx.clearRect(0, 0, w, h);
			// axes
			ctx.strokeStyle = FAINT; ctx.lineWidth = 1;
			ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
			// rectangles
			var dx = (B - A) / n, sum = 0;
			ctx.fillStyle = 'rgba(255,71,76,0.30)'; ctx.strokeStyle = 'rgba(255,71,76,0.85)'; ctx.lineWidth = 1;
			for (var i = 0; i < n; i++) {
				var xl = A + i * dx;
				var sx = rule === 'left' ? xl : (rule === 'right' ? xl + dx : xl + dx / 2);
				var fv = f(sx); sum += fv * dx;
				var rx = X(xl), rw = X(xl + dx) - X(xl), ry = Y(fv);
				ctx.fillRect(rx, ry, rw, y0 - ry);
				ctx.strokeRect(rx, ry, rw, y0 - ry);
			}
			// curve
			ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath();
			for (var s = 0; s <= 200; s++) { var xx = A + s / 200 * (B - A); var X2 = X(xx), Y2 = Y(f(xx)); if (s === 0) ctx.moveTo(X2, Y2); else ctx.lineTo(X2, Y2); }
			ctx.stroke();
			// exact integral
			var exact = 0, M = 2000, hh = (B - A) / M;
			for (var m = 0; m < M; m++) exact += f(A + (m + 0.5) * hh) * hh;
			out.innerHTML = 'approx = <b>' + sum.toFixed(3) + '</b> &nbsp; exact = <b>' + exact.toFixed(3) + '</b> &nbsp; error = <b>' + Math.abs(sum - exact).toFixed(3) + '</b>';
		}
		nInput.addEventListener('input', function () { n = +nInput.value; nLabel.textContent = n; draw(); });
		if (selFn) selFn.addEventListener('change', function () { fnKey = selFn.value; draw(); });
		seg.addEventListener('click', function (e) {
			var b = e.target.closest('button'); if (!b) return;
			rule = b.getAttribute('data-val');
			seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
			b.classList.add('active'); draw();
		});
		register({ relayout: function () { var g = fit(canvas, 0.72); if (g) { geo = g; draw(); } } });
	}

	// =====================================================================
	//  GRID DEMO: Vietoris–Rips complex & beta_0
	// =====================================================================
	function demoRips(card) {
		var canvas = card.querySelector('canvas');
		var out = card.querySelector('[data-role=readout]');
		var rInput = card.querySelector('[data-role=radius]');
		var rLabel = card.querySelector('[data-role=rlabel]');
		var geo = null, r = 34, drag = -1;
		var pts = [[0.24, 0.30], [0.44, 0.24], [0.40, 0.56], [0.66, 0.40], [0.74, 0.68], [0.30, 0.74], [0.58, 0.80]];

		function P(i) { return [pts[i][0] * geo.w, pts[i][1] * geo.h]; }
		function draw() {
			if (!geo) return;
			var ctx = geo.ctx, w = geo.w, h = geo.h, i, j, k;
			ctx.clearRect(0, 0, w, h);
			var pj = []; for (i = 0; i < pts.length; i++) pj.push(P(i));
			// edges
			var edges = [];
			for (i = 0; i < pj.length; i++) for (j = i + 1; j < pj.length; j++) if (dist(pj[i][0], pj[i][1], pj[j][0], pj[j][1]) <= 2 * r) edges.push([i, j]);
			var eset = {}; edges.forEach(function (e) { eset[e[0] + '-' + e[1]] = 1; });
			function hasE(a, b) { return eset[Math.min(a, b) + '-' + Math.max(a, b)]; }
			// triangles (flag): all 3 edges present
			var tris = 0;
			ctx.fillStyle = 'rgba(255,209,90,0.16)';
			for (i = 0; i < pj.length; i++) for (j = i + 1; j < pj.length; j++) for (k = j + 1; k < pj.length; k++)
				if (hasE(i, j) && hasE(j, k) && hasE(i, k)) {
					tris++;
					ctx.beginPath(); ctx.moveTo(pj[i][0], pj[i][1]); ctx.lineTo(pj[j][0], pj[j][1]); ctx.lineTo(pj[k][0], pj[k][1]); ctx.closePath(); ctx.fill();
				}
			// disks
			ctx.fillStyle = 'rgba(255,71,76,0.10)'; ctx.strokeStyle = 'rgba(255,71,76,0.32)'; ctx.lineWidth = 1;
			for (i = 0; i < pj.length; i++) { ctx.beginPath(); ctx.arc(pj[i][0], pj[i][1], r, 0, 7); ctx.fill(); ctx.stroke(); }
			// edges
			ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
			edges.forEach(function (e) { ctx.beginPath(); ctx.moveTo(pj[e[0]][0], pj[e[0]][1]); ctx.lineTo(pj[e[1]][0], pj[e[1]][1]); ctx.stroke(); });
			// vertices
			for (i = 0; i < pj.length; i++) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(pj[i][0], pj[i][1], 5, 0, 7); ctx.fill(); ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(pj[i][0], pj[i][1], 2.4, 0, 7); ctx.fill(); }
			var b0 = components(pts.length, edges);
			out.innerHTML = '&beta;<sub>0</sub> = <b>' + b0 + '</b> &nbsp; edges = <b>' + edges.length + '</b> &nbsp; triangles = <b>' + tris + '</b>';
		}
		function pjAll() { var a = []; for (var i = 0; i < pts.length; i++) a.push(P(i)); return a; }
		function grab(e) { return geo ? pickDisk(ptr(canvas, e), pjAll(), r) : -1; }
		rInput.addEventListener('input', function () { r = +rInput.value; rLabel.textContent = r; draw(); });
		canvas.addEventListener('mousedown', function (e) { drag = grab(e); });
		canvas.addEventListener('touchstart', function (e) { drag = grab(e); if (drag >= 0) e.preventDefault(); }, { passive: false });
		window.addEventListener('mousemove', function (e) { if (drag < 0 || !geo) return; var p = ptr(canvas, e); pts[drag] = [clamp(p.x / geo.w, 0.03, 0.97), clamp(p.y / geo.h, 0.03, 0.97)]; draw(); });
		window.addEventListener('touchmove', function (e) { if (drag < 0 || !geo) return; var p = ptr(canvas, e); pts[drag] = [clamp(p.x / geo.w, 0.03, 0.97), clamp(p.y / geo.h, 0.03, 0.97)]; draw(); e.preventDefault(); }, { passive: false });
		window.addEventListener('mouseup', function () { drag = -1; });
		window.addEventListener('touchend', function () { drag = -1; });
		canvas.addEventListener('dblclick', function (e) { if (!geo) return; var p = ptr(canvas, e); pts.push([clamp(p.x / geo.w, 0.03, 0.97), clamp(p.y / geo.h, 0.03, 0.97)]); draw(); });
		rLabel.textContent = r;
		register({ relayout: function () { var g = fit(canvas, 0.82); if (g) { geo = g; draw(); } } });
	}

	// =====================================================================
	//  GRID DEMO: H0 persistence barcode
	// =====================================================================
	function demoBarcode(card) {
		var canvas = card.querySelector('canvas');
		var out = card.querySelector('[data-role=readout]');
		var rInput = card.querySelector('[data-role=radius]');
		var rLabel = card.querySelector('[data-role=rlabel]');
		var seg = card.querySelector('[data-role=cx]');
		var geo = null, r = 0, drag = -1, cechMode = false;
		var pts = [[0.16, 0.26], [0.34, 0.16], [0.52, 0.26], [0.52, 0.52], [0.34, 0.62], [0.16, 0.52], [0.78, 0.30], [0.80, 0.60]];

		var CLOUD = 0.46; // fraction of height used by the point cloud
		function layout() {
			var w = geo.w, h = geo.h, cy = h * CLOUD, pj = [];
			for (var i = 0; i < pts.length; i++) pj.push([pts[i][0] * w, pts[i][1] * cy * 0.9 + cy * 0.06]);
			return { w: w, h: h, cy: cy, pj: pj };
		}
		function toNorm(L, p) {
			return [clamp(p.x / L.w, 0.02, 0.98), clamp((p.y - L.cy * 0.06) / (L.cy * 0.9), 0.02, 0.98)];
		}
		function tris(pj) {  // triangles present at current r under the chosen rule
			var i, j, k, T = [], n = pj.length;
			var eset = {};
			for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) if (dist(pj[i][0], pj[i][1], pj[j][0], pj[j][1]) <= 2 * r) eset[i + '-' + j] = 1;
			function E(a, b) { return eset[Math.min(a, b) + '-' + Math.max(a, b)]; }
			for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) for (k = j + 1; k < n; k++) {
				if (!(E(i, j) && E(j, k) && E(i, k))) continue;
				if (cechMode && mecRadius3([pj[i], pj[j], pj[k]]) > r) continue;
				T.push([i, j, k]);
			}
			return T;
		}
		function drawBar(ctx, x0, x1, y, live, thick, col) {
			ctx.strokeStyle = live ? col : 'rgba(255,255,255,0.26)';
			ctx.lineWidth = thick;
			ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
		}
		function draw() {
			if (!geo) return;
			var ctx = geo.ctx, w = geo.w, h = geo.h, i, j;
			ctx.clearRect(0, 0, w, h);
			var L = layout(), cy = L.cy, pj = L.pj;
			// --- cloud: disks, filled triangles, edges, vertices ---
			ctx.fillStyle = 'rgba(255,71,76,0.09)'; ctx.strokeStyle = 'rgba(255,71,76,0.28)'; ctx.lineWidth = 1;
			for (i = 0; i < pj.length; i++) { ctx.beginPath(); ctx.arc(pj[i][0], pj[i][1], r, 0, 7); ctx.fill(); ctx.stroke(); }
			var T = tris(pj);
			ctx.fillStyle = 'rgba(255,209,90,0.18)';
			T.forEach(function (t) { ctx.beginPath(); ctx.moveTo(pj[t[0]][0], pj[t[0]][1]); ctx.lineTo(pj[t[1]][0], pj[t[1]][1]); ctx.lineTo(pj[t[2]][0], pj[t[2]][1]); ctx.closePath(); ctx.fill(); });
			var edges = [];
			for (i = 0; i < pj.length; i++) for (j = i + 1; j < pj.length; j++) if (dist(pj[i][0], pj[i][1], pj[j][0], pj[j][1]) <= 2 * r) edges.push([i, j]);
			ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
			edges.forEach(function (e) { ctx.beginPath(); ctx.moveTo(pj[e[0]][0], pj[e[0]][1]); ctx.lineTo(pj[e[1]][0], pj[e[1]][1]); ctx.stroke(); });
			for (i = 0; i < pj.length; i++) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(pj[i][0], pj[i][1], 4, 0, 7); ctx.fill(); }
			// --- persistence ---
			var pers = persistence(pj, cechMode);
			var h0 = pers.h0.slice().sort(function (a, b) { return a.d - b.d; });
			var h1 = pers.h1.slice().sort(function (a, b) { return (a.b - b.b) || (a.d - b.d); });
			var rmax = +rInput.max, bx0 = 30, bx1 = w - 14;
			function BX(rv) { return bx0 + clamp(rv / rmax, 0, 1) * (bx1 - bx0); }
			// two stacked barcode panels
			var gap = 10;
			var p0top = cy + 14, p0bot = cy + (h - cy) * 0.5 - gap;
			var p1top = cy + (h - cy) * 0.5 + gap, p1bot = h - 6;
			ctx.strokeStyle = FAINT; ctx.lineWidth = 1;
			ctx.beginPath(); ctx.moveTo(8, cy + 4); ctx.lineTo(w - 8, cy + 4); ctx.stroke();
			ctx.font = '600 11px sans-serif';
			// H0 panel
			var aliveH0 = 0;
			var rowH0 = Math.min(13, (p0bot - p0top) / Math.max(h0.length, 1));
			for (i = 0; i < h0.length; i++) {
				var y0 = p0top + i * rowH0 + rowH0 * 0.5;
				var d0 = h0[i].d, live0 = !isFinite(d0) || d0 > r;
				if (live0) aliveH0++;
				drawBar(ctx, BX(0), isFinite(d0) ? BX(d0) : bx1, y0, live0, Math.max(3, rowH0 * 0.55), ACCENT);
				if (!isFinite(d0)) { ctx.fillStyle = ACCENT2; ctx.fillText('∞', bx1 + 1, y0 + 3); }
			}
			ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText('H₀', 6, p0top + 4);
			// H1 panel
			var aliveH1 = 0;
			var rowH1 = Math.min(13, (p1bot - p1top) / Math.max(h1.length, 1));
			if (h1.length === 0) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '11px sans-serif'; ctx.fillText('(no loops yet)', bx0, (p1top + p1bot) / 2); ctx.font = '600 11px sans-serif'; }
			for (i = 0; i < h1.length; i++) {
				var y1 = p1top + i * rowH1 + rowH1 * 0.5;
				var b1 = h1[i].b, d1 = h1[i].d, live1 = b1 <= r && (!isFinite(d1) || d1 > r);
				drawBar(ctx, BX(b1), isFinite(d1) ? BX(d1) : bx1, y1, live1, Math.max(3, rowH1 * 0.55), ACCENT2);
				if (b1 <= r) aliveH1 += live1 ? 1 : 0;
			}
			ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText('H₁', 6, p1top + 4);
			// scrub line spanning both panels
			var sx = BX(r);
			ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.moveTo(sx, p0top - 6); ctx.lineTo(sx, p1bot); ctx.stroke(); ctx.setLineDash([]);
			out.innerHTML = 'components (H<sub>0</sub>) = <b>' + aliveH0 + '</b> &nbsp; loops (H<sub>1</sub>) = <b>' + aliveH1 + '</b> &nbsp; triangles = <b>' + T.length + '</b>';
		}
		rInput.addEventListener('input', function () { r = +rInput.value; rLabel.textContent = r; draw(); });
		if (seg) seg.addEventListener('click', function (e) {
			var btn = e.target.closest('button'); if (!btn) return;
			cechMode = btn.getAttribute('data-val') === 'cech';
			seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
			btn.classList.add('active'); draw();
		});
		function grab(e) { if (!geo) return -1; return pickDisk(ptr(canvas, e), layout().pj, r); }
		canvas.addEventListener('mousedown', function (e) { drag = grab(e); });
		canvas.addEventListener('touchstart', function (e) { drag = grab(e); if (drag >= 0) e.preventDefault(); }, { passive: false });
		window.addEventListener('mousemove', function (e) { if (drag < 0 || !geo) return; pts[drag] = toNorm(layout(), ptr(canvas, e)); draw(); });
		window.addEventListener('touchmove', function (e) { if (drag < 0 || !geo) return; pts[drag] = toNorm(layout(), ptr(canvas, e)); draw(); e.preventDefault(); }, { passive: false });
		window.addEventListener('mouseup', function () { drag = -1; });
		window.addEventListener('touchend', function () { drag = -1; });
		canvas.addEventListener('dblclick', function (e) { if (!geo) return; var L = layout(), p = ptr(canvas, e); if (p.y > L.cy) return; pts.push(toNorm(L, p)); draw(); });
		rLabel.textContent = r;
		register({ relayout: function () { var g = fit(canvas, 1.28); if (g) { geo = g; draw(); } } });
	}

	// =====================================================================
	//  THE CECH NERVE PLAYGROUND
	// =====================================================================
	function nervePlayground() {
		var canvas = document.getElementById('nerveCanvas');
		if (!canvas) return;
		var rInput = document.getElementById('nerveRadius');
		var rLabel = document.getElementById('nerveRLabel');
		var readout = document.getElementById('nerveReadout');
		var cBalls = document.getElementById('nerveShowBalls');
		var cEdges = document.getElementById('nerveShowEdges');
		var cTris = document.getElementById('nerveShowTris');
		var cCech = document.getElementById('nerveCechMode');
		var bAdd = document.getElementById('nerveAdd');
		var bReset = document.getElementById('nerveReset');
		var bRandom = document.getElementById('nerveRandom');
		var geo = null, r = 40, drag = -1;

		var DEFAULT = [[0.30, 0.34], [0.46, 0.28], [0.42, 0.54], [0.62, 0.40], [0.70, 0.66], [0.34, 0.70], [0.56, 0.78], [0.78, 0.30]];
		var pts = DEFAULT.map(function (p) { return p.slice(); });

		function P(i) { return [pts[i][0] * geo.w, pts[i][1] * geo.h]; }

		function draw() {
			if (!geo) return;
			var ctx = geo.ctx, w = geo.w, h = geo.h, i, j, k;
			ctx.clearRect(0, 0, w, h);
			var pj = []; for (i = 0; i < pts.length; i++) pj.push(P(i));
			// edges: disks overlap  <=> dist <= 2r
			var edges = [], eset = {};
			for (i = 0; i < pj.length; i++) for (j = i + 1; j < pj.length; j++)
				if (dist(pj[i][0], pj[i][1], pj[j][0], pj[j][1]) <= 2 * r) { edges.push([i, j]); eset[i + '-' + j] = 1; }
			function hasE(a, b) { return eset[Math.min(a, b) + '-' + Math.max(a, b)]; }
			// triangles
			var tris = [];
			for (i = 0; i < pj.length; i++) for (j = i + 1; j < pj.length; j++) for (k = j + 1; k < pj.length; k++) {
				if (!(hasE(i, j) && hasE(j, k) && hasE(i, k))) continue;
				var ok;
				if (cCech.checked) ok = mecRadius3([pj[i], pj[j], pj[k]]) <= r; // true common intersection
				else ok = true;                                                 // Rips flag rule
				if (ok) tris.push([i, j, k]);
			}
			// disks
			if (cBalls.checked) {
				ctx.fillStyle = 'rgba(255,71,76,0.09)'; ctx.strokeStyle = 'rgba(255,71,76,0.30)'; ctx.lineWidth = 1;
				for (i = 0; i < pj.length; i++) { ctx.beginPath(); ctx.arc(pj[i][0], pj[i][1], r, 0, 7); ctx.fill(); ctx.stroke(); }
			}
			// triangles
			if (cTris.checked) {
				ctx.fillStyle = 'rgba(255,209,90,0.18)';
				tris.forEach(function (t) { ctx.beginPath(); ctx.moveTo(pj[t[0]][0], pj[t[0]][1]); ctx.lineTo(pj[t[1]][0], pj[t[1]][1]); ctx.lineTo(pj[t[2]][0], pj[t[2]][1]); ctx.closePath(); ctx.fill(); });
			}
			// edges
			if (cEdges.checked) {
				ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.4;
				edges.forEach(function (e) { ctx.beginPath(); ctx.moveTo(pj[e[0]][0], pj[e[0]][1]); ctx.lineTo(pj[e[1]][0], pj[e[1]][1]); ctx.stroke(); });
			}
			// vertices
			for (i = 0; i < pj.length; i++) {
				ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(pj[i][0], pj[i][1], 6, 0, 7); ctx.fill();
				ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(pj[i][0], pj[i][1], 3, 0, 7); ctx.fill();
			}
			var V = pts.length, E = edges.length, F = tris.length;
			var b0 = components(V, edges);
			var chi = V - E + F;
			var loops = E - V + b0; // cycle rank of 1-skeleton
			readout.innerHTML =
				'<span><b>' + V + '</b> vertices</span>' +
				'<span><b>' + E + '</b> edges</span>' +
				'<span><b>' + F + '</b> triangles</span>' +
				'<span>&chi; = <b>' + chi + '</b></span>' +
				'<span>&beta;<sub>0</sub> = <b>' + b0 + '</b></span>' +
				'<span>1-skeleton loops = <b>' + loops + '</b></span>';
		}

		function nearest(p) { var pj = []; for (var i = 0; i < pts.length; i++) pj.push(P(i)); return pickDisk(p, pj, r); }

		rInput.addEventListener('input', function () { r = +rInput.value; rLabel.textContent = r; draw(); });
		[cBalls, cEdges, cTris, cCech].forEach(function (c) { c.addEventListener('change', draw); });
		bAdd.addEventListener('click', function () { pts.push([0.2 + Math.random() * 0.6, 0.2 + Math.random() * 0.6]); draw(); });
		bReset.addEventListener('click', function () { pts = DEFAULT.map(function (p) { return p.slice(); }); draw(); });
		bRandom.addEventListener('click', function () { var n = pts.length; pts = []; for (var i = 0; i < n; i++) pts.push([0.1 + Math.random() * 0.8, 0.1 + Math.random() * 0.8]); draw(); });

		canvas.addEventListener('mousedown', function (e) { drag = nearest(ptr(canvas, e)); });
		canvas.addEventListener('touchstart', function (e) { drag = nearest(ptr(canvas, e)); if (drag >= 0) e.preventDefault(); }, { passive: false });
		window.addEventListener('mousemove', function (e) { if (drag < 0 || !geo) return; var p = ptr(canvas, e); pts[drag] = [clamp(p.x / geo.w, 0.02, 0.98), clamp(p.y / geo.h, 0.02, 0.98)]; draw(); });
		window.addEventListener('touchmove', function (e) { if (drag < 0 || !geo) return; var p = ptr(canvas, e); pts[drag] = [clamp(p.x / geo.w, 0.02, 0.98), clamp(p.y / geo.h, 0.02, 0.98)]; draw(); e.preventDefault(); }, { passive: false });
		function endDrag(e) {
			if (drag < 0) { return; }
			// drop onto another point -> remove (keep >=3)
			if (geo && pts.length > 3) {
				var q = P(drag);
				for (var i = 0; i < pts.length; i++) { if (i === drag) continue; var o = P(i); if (dist(q[0], q[1], o[0], o[1]) < 12) { pts.splice(drag, 1); break; } }
			}
			drag = -1; draw();
		}
		window.addEventListener('mouseup', endDrag);
		window.addEventListener('touchend', endDrag);
		canvas.addEventListener('dblclick', function (e) { var p = ptr(canvas, e); if (geo) { pts.push([clamp(p.x / geo.w, 0.02, 0.98), clamp(p.y / geo.h, 0.02, 0.98)]); draw(); } });

		rLabel.textContent = r; rInput.value = r;
		register({ relayout: function () { var g = fit(canvas, 0.62); if (g) { geo = g; draw(); } } });
	}

	// =====================================================================
	//  Scramble heading: decode/glitch cycle through site-related phrases
	//  (a vanilla port of the classic TextScramble effect)
	// =====================================================================
	function scrambleHeading() {
		var el = document.getElementById('pgScramble');
		if (!el) return;
		var DUD = '#841f37';
		var CHARS = '!<>-$_\\/[]{}—=+*^?#________';
		var phrases = [
			'Interactive Math',
			'Interactive Topology',
			'Interactive Geometry',
			'Persistent Homology',
			'Topological Data Analysis',
			'Applied Algebraic Topology',
			'Simplicial Complexes',
			'The Nerve of a Cover',
			'Homotopy Theory',
			'The Shape of Data'
		];
		var queue = [], frame = 0, frameReq = null, resolve = null;

		function randomChar() { return CHARS[Math.floor(Math.random() * CHARS.length)]; }
		function update() {
			var output = '', complete = 0;
			for (var i = 0; i < queue.length; i++) {
				var q = queue[i];
				if (frame >= q.end) { complete++; output += q.to; }
				else if (frame >= q.start) {
					if (!q.char || Math.random() < 0.28) { q.char = randomChar(); }
					output += '<span class="dud" style="color:' + DUD + '">' + q.char + '</span>';
				} else { output += q.from; }
			}
			el.innerHTML = output;
			if (complete === queue.length) { if (resolve) resolve(); }
			else { frameReq = requestAnimationFrame(update); frame++; }
		}
		function setText(newText) {
			var oldText = el.innerText || '';
			var length = Math.max(oldText.length, newText.length);
			var promise = new Promise(function (res) { resolve = res; });
			queue = [];
			for (var i = 0; i < length; i++) {
				var from = oldText[i] || '', to = newText[i] || '';
				var start = Math.floor(Math.random() * 40);
				var end = start + Math.floor(Math.random() * 40);
				queue.push({ from: from, to: to, start: start, end: end });
			}
			if (frameReq) cancelAnimationFrame(frameReq);
			frame = 0; update();
			return promise;
		}
		var counter = 0;
		function next() {
			setText(phrases[counter]).then(function () { setTimeout(next, 1800); });
			counter = (counter + 1) % phrases.length;
		}
		next();
	}

	// =====================================================================
	//  boot
	// =====================================================================
	function boot() {
		var article = document.getElementById('playground');
		if (!article) return;
		var map = { dot: demoDot, gradient: demoGradient, frenet: demoFrenet, riemann: demoRiemann, rips: demoRips, barcode: demoBarcode };
		article.querySelectorAll('.demo-card').forEach(function (card) {
			var fn = map[card.getAttribute('data-demo')];
			if (fn) fn(card);
		});
		nervePlayground();
		scrambleHeading();

		// Relayout whenever the panel becomes active (it is display:none until then).
		var obs = new MutationObserver(function () {
			var active = article.classList.contains('active');
			panelVisible = active;
			if (active) { relayoutAll(); setTimeout(relayoutAll, 380); }
		});
		obs.observe(article, { attributes: true, attributeFilter: ['class'] });

		var rt;
		window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (article.classList.contains('active')) relayoutAll(); }, 150); });

		// if page loads directly on #playground
		if (location.hash === '#playground') { panelVisible = true; setTimeout(relayoutAll, 200); setTimeout(relayoutAll, 700); }

		requestAnimationFrame(loop);
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
	else boot();
})();
