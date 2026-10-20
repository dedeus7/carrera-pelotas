// =====================================================================
// juego.js — Menú, sala, bucle de juego y dibujo.
//
// ANFITRIÓN: simula todo con reglas.js y envía el estado 20 veces/s.
// INVITADO:  envía sus teclas 60 veces/s, PREDICE su propio jugador
//            y dibuja a los demás INTERPOLADOS ~100 ms en el pasado.
// =====================================================================
(function () {
  'use strict';
  const R = window.Reglas;
  const $ = (id) => document.getElementById(id);

  const ENVIOS_CADA_N_TICKS = 3;   // 60/3 = 20 envíos de estado por segundo
  const RETRASO_INTERP = 100;      // ms "en el pasado" para dibujar a los demás

  // ---------- Estado general ----------
  let pantalla = 'menu';
  let miSlot = -1;
  let nombres = {};                // slot -> nombre (para dibujar)

  // Solo anfitrión
  const sala = new Map();          // remitente -> { slot, nombre }  ('yo' = el anfitrión)
  let mundo = null;
  let colasEntradas = {};          // slot -> [entradas pendientes]
  let contadorTicks = 0;

  // Solo invitado
  let instantaneas = [];           // [{ t, d }] estados recibidos
  let ultima = null;               // la más reciente
  let coloresPelotas = [];
  let pred = null;                 // mi jugador predicho
  let pendientes = [];             // entradas aún no confirmadas por el anfitrión
  let secuencia = 0;
  const desvio = { x: 0, y: 0 };   // corrección suave tras reconciliar

  // ---------- Pantallas ----------
  function mostrar(nombre) {
    pantalla = nombre;
    for (const p of ['menu', 'sala', 'juego']) $('pantalla-' + p).classList.toggle('visible', p === nombre);
    if (nombre === 'juego') ajustarLienzo();
  }
  function mensajeMenu(txt, ok) {
    $('mensaje-menu').textContent = txt || '';
    $('mensaje-menu').classList.toggle('ok', !!ok);
  }
  function avisar(txt) {
    const div = document.createElement('div');
    div.className = 'aviso';
    div.textContent = txt;
    $('avisos').appendChild(div);
    setTimeout(() => div.remove(), 4000);
  }
  function bloquearMenu(si) { $('btn-crear').disabled = si; $('btn-unirse').disabled = si; }

  function leerNombre() {
    const n = $('input-nombre').value.trim().slice(0, 12) || 'Jugador';
    try { localStorage.setItem('carrera-nombre', n); } catch (e) {}
    return n;
  }
  try { $('input-nombre').value = localStorage.getItem('carrera-nombre') || ''; } catch (e) {}

  function reiniciarTodo() {
    mundo = null; sala.clear(); colasEntradas = {}; nombres = {}; miSlot = -1;
    instantaneas = []; ultima = null; pred = null; pendientes = []; secuencia = 0;
    desvio.x = desvio.y = 0;
    ultimoFin = '';
    $('panel-fin').style.display = 'none';
  }

  function volverAlMenu(motivo) {
    Red.salir();
    reiniciarTodo();
    mostrar('menu');
    mensajeMenu(motivo || '');
  }

  // ---------- Botones del menú ----------
  $('btn-crear').onclick = async () => {
    const nombre = leerNombre();
    bloquearMenu(true);
    mensajeMenu('Creando partida…', true);
    try {
      const codigo = await Red.crear_sala();
      reiniciarTodo();
      miSlot = 0;
      sala.set('yo', { slot: 0, nombre });
      $('codigo-sala').textContent = codigo;
      mensajeMenu('');
      mostrar('sala');
      enviarSala();
    } catch (err) {
      mensajeMenu(err);
    } finally {
      bloquearMenu(false);
    }
  };

  $('btn-unirse').onclick = async () => {
    const codigo = $('input-codigo').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(codigo)) { mensajeMenu('El código son 4 letras.'); return; }
    const nombre = leerNombre();
    bloquearMenu(true);
    mensajeMenu('Conectando…', true);
    try {
      await Red.unirse(codigo);
      reiniciarTodo();
      Red.enviar_al_anfitrion({ t: 'hola', nombre });
      $('codigo-sala').textContent = codigo;
      pintarSala([]);
      mensajeMenu('');
      mostrar('sala');
    } catch (err) {
      mensajeMenu(err);
    } finally {
      bloquearMenu(false);
    }
  };
  $('input-codigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-unirse').click(); });

  $('codigo-sala').onclick = () => {
    const txt = $('codigo-sala').textContent;
    try { navigator.clipboard.writeText(txt).then(() => { $('pista-codigo').textContent = '¡Copiado!'; }); } catch (e) {}
  };

  $('btn-salir-sala').onclick = () => volverAlMenu('');
  $('btn-salir-juego').onclick = () => volverAlMenu('');

  // ---------- Sala de espera ----------
  function listaSala() {
    return [...sala.values()].sort((a, b) => a.slot - b.slot);
  }

  function enviarSala() {
    const lista = listaSala();
    Red.enviar_a_todos({ t: 'sala', jugadores: lista });
    pintarSala(lista);
  }

  function pintarSala(lista) {
    const ul = $('lista-jugadores');
    ul.innerHTML = '';
    for (let s = 0; s < R.MAX_JUGADORES; s++) {
      const j = lista.find(x => x.slot === s);
      const li = document.createElement('li');
      const bola = document.createElement('span');
      bola.className = 'bola';
      bola.style.background = R.COLORES[s].base;
      li.appendChild(bola);
      if (j) {
        li.appendChild(document.createTextNode(j.nombre));
        const et = document.createElement('span');
        et.className = 'etiqueta';
        et.textContent = (s === 0 ? 'anfitrión' : '') + (s === miSlot ? (s === 0 ? ' · tú' : 'tú') : '');
        li.appendChild(et);
      } else {
        li.classList.add('vacio');
        li.appendChild(document.createTextNode('Esperando jugador…'));
      }
      ul.appendChild(li);
    }
    const soyAnf = Red.soy_anfitrion();
    $('btn-empezar').style.display = soyAnf ? '' : 'none';
    $('esperando').style.display = soyAnf ? 'none' : '';
    $('btn-empezar').textContent = lista.length < R.MAX_JUGADORES
      ? `¡Empezar! (${lista.length}/${R.MAX_JUGADORES})`
      : '¡Empezar!';
  }

  $('btn-empezar').onclick = () => {
    if (!Red.soy_anfitrion()) return;
    const lista = listaSala();
    mundo = R.crearMundo(lista.map(j => j.slot));
    colasEntradas = {};
    nombres = {};
    for (const j of lista) nombres[j.slot] = j.nombre;
    Red.enviar_a_todos({ t: 'empieza', jugadores: lista, colores: mundo.pelotas.map(p => p.color) });
    entrarEnJuego();
  };

  $('btn-otra').onclick = () => {
    if (!Red.soy_anfitrion()) return;
    mundo = null;
    Red.enviar_a_todos({ t: 'volver_sala' });
    $('panel-fin').style.display = 'none';
    ultimoFin = '';
    mostrar('sala');
    enviarSala();
  };

  function entrarEnJuego() {
    $('panel-fin').style.display = 'none';
    ultimoFin = '';
    mostrar('juego');
  }

  // ---------- Mensajes de red ----------
  Red.al_recibir((de, dato) => {
    if (!dato || typeof dato !== 'object') return;
    if (Red.soy_anfitrion()) recibirComoAnfitrion(de, dato);
    else recibirComoInvitado(dato);
  });

  Red.al_entrar_jugador(() => { /* esperamos su mensaje 'hola' con el nombre */ });

  Red.al_salir_jugador((de, motivo) => {
    if (!Red.soy_anfitrion()) { volverAlMenu(motivo); return; }
    const j = sala.get(de);
    if (!j) return;
    sala.delete(de);
    if (mundo) {
      R.quitarJugador(mundo, j.slot);
      delete colasEntradas[j.slot];
      const txt = `${j.nombre} se ha ido (${motivo}).`;
      avisar(txt);
      Red.enviar_a_todos({ t: 'aviso', msg: txt });
    }
    enviarSala();
  });

  function recibirComoAnfitrion(de, d) {
    if (d.t === 'hola') {
      if (sala.has(de)) return;
      if (mundo) { Red.enviar_a(de, { t: 'error', msg: 'La partida ya ha empezado. Espera a la siguiente.' }); return; }
      const ocupados = new Set(listaSala().map(j => j.slot));
      let libre = -1;
      for (let s = 0; s < R.MAX_JUGADORES; s++) if (!ocupados.has(s)) { libre = s; break; }
      if (libre < 0) { Red.enviar_a(de, { t: 'error', msg: 'La partida está llena (máximo 3).' }); return; }
      const nombre = String(d.nombre || 'Jugador').slice(0, 12);
      sala.set(de, { slot: libre, nombre });
      Red.enviar_a(de, { t: 'bienvenida', slot: libre });
      enviarSala();
    } else if (d.t === 'in') {
      const j = sala.get(de);
      if (!j || !mundo) return;
      (colasEntradas[j.slot] || (colasEntradas[j.slot] = [])).push(d);
    }
  }

  function recibirComoInvitado(d) {
    switch (d.t) {
      case 'bienvenida': miSlot = d.slot; break;
      case 'sala': pintarSala(d.jugadores || []); break;
      case 'error': volverAlMenu(d.msg); break;
      case 'aviso': avisar(d.msg); break;
      case 'empieza':
        nombres = {};
        for (const j of d.jugadores) nombres[j.slot] = j.nombre;
        coloresPelotas = d.colores;
        instantaneas = []; ultima = null; pred = null; pendientes = [];
        desvio.x = desvio.y = 0;
        entrarEnJuego();
        break;
      case 'volver_sala':
        $('panel-fin').style.display = 'none';
        mostrar('sala');
        break;
      case 'e': recibirInstantanea(d); break;
    }
  }

  // ---------- Invitado: recibir estado y reconciliar ----------
  function recibirInstantanea(d) {
    const ahora = performance.now();
    ultima = d;
    instantaneas.push({ t: ahora, d });
    while (instantaneas.length > 2 && ahora - instantaneas[0].t > 1000) instantaneas.shift();

    const mio = d.j.find(j => j[0] === miSlot);
    if (!mio) return;
    const antesX = pred ? pred.x : mio[1];
    const antesY = pred ? pred.y : mio[2];
    if (!pred) pred = { slot: miSlot, x: 0, y: 0, vx: 0, vy: 0, fx: mio[3] / 100, fy: mio[4] / 100 };

    // 1) Me pongo donde el anfitrión dice que estaba...
    pred.x = mio[1];
    pred.y = mio[2];
    // 2) ...y vuelvo a aplicar las teclas que él todavía no había procesado.
    pendientes = pendientes.filter(p => p.s > mio[5]);
    for (const p of pendientes) if (p.m) R.moverJugador(pred, p.x, p.y, R.DT);

    // La diferencia se reparte poco a poco al dibujar (no se nota el salto)
    desvio.x += antesX - pred.x;
    desvio.y += antesY - pred.y;
    if (Math.hypot(desvio.x, desvio.y) > 150) desvio.x = desvio.y = 0;
  }

  // ---------- Teclado ----------
  const teclas = new Set();
  let lanzarPulsado = false;
  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (pantalla === 'juego' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'Space' && !e.repeat) lanzarPulsado = true;
    teclas.add(e.code);
  });
  addEventListener('keyup', (e) => teclas.delete(e.code));
  addEventListener('blur', () => teclas.clear());

  function leerEntrada() {
    let x = 0, y = 0;
    if (teclas.has('KeyA') || teclas.has('ArrowLeft')) x -= 1;
    if (teclas.has('KeyD') || teclas.has('ArrowRight')) x += 1;
    if (teclas.has('KeyW') || teclas.has('ArrowUp')) y -= 1;
    if (teclas.has('KeyS') || teclas.has('ArrowDown')) y += 1;
    const l = lanzarPulsado;
    lanzarPulsado = false;
    return { x, y, l };
  }

  // ---------- Bucle de simulación (60 ticks/s fijos) ----------
  function tickAnfitrion() {
    if (!mundo) return;
    for (const j of mundo.jugadores) { j.vx = 0; j.vy = 0; }

    const e = leerEntrada();
    aplicarEntrada(0, { s: 0, x: e.x, y: e.y, l: e.l ? 1 : 0 });

    for (const slot in colasEntradas) {
      const cola = colasEntradas[slot];
      // Normalmente 1 entrada por tick; si se acumulan (retrasos), nos ponemos al día
      const n = cola.length > 4 ? cola.length - 2 : Math.min(1, cola.length);
      for (let i = 0; i < n; i++) aplicarEntrada(Number(slot), cola.shift());
    }

    R.pasoFisica(mundo, R.DT);

    if (++contadorTicks % ENVIOS_CADA_N_TICKS === 0) Red.enviar_a_todos(R.serializar(mundo));
  }

  function aplicarEntrada(slot, ent) {
    const j = R.buscarJugador(mundo, slot);
    if (!j) return;
    const x = Math.sign(Number(ent.x) || 0), y = Math.sign(Number(ent.y) || 0);
    if (mundo.fase === 'carrera') {
      R.moverJugador(j, x, y, R.DT);
      if (ent.l) R.lanzar(mundo, j);
    }
    j.ack = Number(ent.s) || 0;
  }

  function tickInvitado() {
    const e = leerEntrada();
    const mover = !!ultima && ultima.f === 1; // solo en fase "carrera"
    const msg = { t: 'in', s: ++secuencia, x: e.x, y: e.y, l: e.l ? 1 : 0 };
    Red.enviar_al_anfitrion(msg);
    if (pred) {
      if (mover) R.moverJugador(pred, e.x, e.y, R.DT);
      pendientes.push({ s: msg.s, x: e.x, y: e.y, m: mover });
      if (pendientes.length > 300) pendientes.shift();
    }
  }

  const MS_TICK = 1000 / 60;
  let ultimoTick = performance.now();
  let acumulado = 0;
  setInterval(() => {
    const ahora = performance.now();
    if (pantalla !== 'juego') { ultimoTick = ahora; acumulado = 0; return; }
    acumulado += Math.min(250, ahora - ultimoTick);
    ultimoTick = ahora;
    while (acumulado >= MS_TICK) {
      acumulado -= MS_TICK;
      if (Red.soy_anfitrion()) tickAnfitrion();
      else tickInvitado();
    }
  }, 4);

  // ---------- Qué dibujar ----------
  function vistaAnfitrion() {
    if (!mundo) return null;
    return {
      fase: mundo.fase, cuenta: mundo.cuenta, tc: mundo.tiempoCarrera, ganador: mundo.ganador,
      jugadores: mundo.jugadores.map(j => ({ slot: j.slot, x: j.x, y: j.y, fx: j.fx, fy: j.fy, puntos: j.puntos })),
      pelotas: mundo.pelotas,
    };
  }

  function vistaInvitado() {
    if (!ultima || !instantaneas.length) return null;
    const rt = performance.now() - RETRASO_INTERP;
    let a = instantaneas[0], b = instantaneas[0];
    for (let i = instantaneas.length - 1; i >= 0; i--) {
      if (instantaneas[i].t <= rt) { a = instantaneas[i]; b = instantaneas[i + 1] || a; break; }
    }
    const k = a === b ? 0 : Math.min(1, (rt - a.t) / (b.t - a.t));
    const mezcla = (u, v) => u + (v - u) * k;

    const jugadores = [];
    for (const jb of b.d.j) {
      const slot = jb[0];
      const puntos = (ultima.j.find(j => j[0] === slot) || jb)[6];
      if (slot === miSlot && pred) {
        jugadores.push({ slot, x: pred.x + desvio.x, y: pred.y + desvio.y, fx: pred.fx, fy: pred.fy, puntos });
        continue;
      }
      const ja = a.d.j.find(j => j[0] === slot) || jb;
      jugadores.push({ slot, x: mezcla(ja[1], jb[1]), y: mezcla(ja[2], jb[2]), fx: jb[3] / 100, fy: jb[4] / 100, puntos });
    }

    const yo = jugadores.find(j => j.slot === miSlot);
    const pelotas = b.d.p.map((pb, i) => {
      const pa = a.d.p[i] || pb;
      const color = coloresPelotas[i];
      if (pb[3] === R.LLEVADA && pb[4] === miSlot && yo) {
        // La pelota que llevo va pegada a mi jugador predicho
        const sep = R.R_JUGADOR + R.R_PELOTA - 4;
        return { color, x: yo.x + yo.fx * sep, y: yo.y + yo.fy * sep, z: 20, estado: pb[3] };
      }
      if (pa[3] !== pb[3]) return { color, x: pb[0], y: pb[1], z: pb[2], estado: pb[3] };
      return { color, x: mezcla(pa[0], pb[0]), y: mezcla(pa[1], pb[1]), z: mezcla(pa[2], pb[2]), estado: pb[3] };
    });

    return { fase: R.FASES[ultima.f], cuenta: ultima.c, tc: ultima.tc, ganador: ultima.g, jugadores, pelotas };
  }

  // ---------- Dibujo ----------
  const lienzo = $('lienzo');
  const ctx = lienzo.getContext('2d');
  function ajustarLienzo() {
    const dpr = window.devicePixelRatio || 1;
    lienzo.width = Math.round(innerWidth * dpr);
    lienzo.height = Math.round(innerHeight * dpr);
  }
  addEventListener('resize', ajustarLienzo);

  function circulo(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function elipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }

  function dibujarCampo() {
    const A = R.MUNDO.ancho, H = R.MUNDO.alto, L = R.LINEA_SALIDA_X;
    ctx.fillStyle = '#6fbf5e';
    ctx.fillRect(0, 0, A, H);
    ctx.fillStyle = '#66b355';
    for (let x = L; x < A; x += 120) ctx.fillRect(x, 0, 60, H);
    ctx.fillStyle = '#e8d6a0';
    ctx.fillRect(0, 0, L, H);
    const t = 14;
    for (let y = 0; y < H; y += t) {
      for (let c = 0; c < 2; c++) {
        ctx.fillStyle = ((y / t + c) % 2) ? '#ffffff' : '#222222';
        ctx.fillRect(L - t + c * t, y, t, t);
      }
    }
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#3d5a33';
    ctx.strokeRect(0, 0, A, H);
  }

  function dibujarPilar(o) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    elipse(o.x + 6, o.y + 8, o.r, o.r * 0.8);
    ctx.fillStyle = '#7d8696';
    circulo(o.x, o.y, o.r);
    ctx.fillStyle = '#a3abb8';
    circulo(o.x - o.r * 0.2, o.y - o.r * 0.2, o.r * 0.7);
  }

  function dibujarCubo(c, i, activo, puntos) {
    const col = R.COLORES[i];
    ctx.globalAlpha = activo ? 1 : 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    elipse(c.x + 6, c.y + 8, c.r, c.r * 0.85);
    ctx.fillStyle = col.base;
    circulo(c.x, c.y, c.r);
    ctx.fillStyle = col.oscuro;
    circulo(c.x, c.y, c.r - 7);
    if (activo) {
      ctx.fillStyle = '#1c2230';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${puntos}/${R.PELOTAS_POR_JUGADOR}`, c.x, c.y + c.r + 22);
    }
    ctx.globalAlpha = 1;
  }

  function dibujarPelota(p, encogida) {
    const col = R.COLORES[p.color];
    const r = R.R_PELOTA * (encogida ? 0.8 : 1 + p.z / 700);
    const y = p.y - p.z * 0.6;
    if (!encogida) {
      const s = Math.max(0.4, 1 - p.z / 400);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      elipse(p.x + 3, p.y + 4, R.R_PELOTA * s, R.R_PELOTA * 0.6 * s);
    }
    const g = ctx.createRadialGradient(p.x - r * 0.35, y - r * 0.35, r * 0.1, p.x, y, r);
    g.addColorStop(0, col.claro);
    g.addColorStop(0.7, col.base);
    g.addColorStop(1, col.oscuro);
    ctx.fillStyle = g;
    circulo(p.x, y, r);
  }

  function dibujarJugador(j) {
    const col = R.COLORES[j.slot];
    const r = R.R_JUGADOR;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    elipse(j.x + 4, j.y + 6, r, r * 0.7);
    ctx.fillStyle = col.base;
    circulo(j.x, j.y, r);
    ctx.lineWidth = 4;
    ctx.strokeStyle = col.oscuro;
    ctx.stroke();
    // Ojos mirando hacia donde se mueve
    const px = -j.fy, py = j.fx;
    for (const s of [-1, 1]) {
      const ex = j.x + j.fx * 9 + px * 7 * s, ey = j.y + j.fy * 9 + py * 7 * s;
      ctx.fillStyle = '#fff';
      circulo(ex, ey, 5);
      ctx.fillStyle = '#111';
      circulo(ex + j.fx * 2, ey + j.fy * 2, 2.5);
    }
    // Nombre
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    const nombre = nombres[j.slot] || R.COLORES[j.slot].nombre;
    ctx.strokeText(nombre, j.x, j.y - r - 10);
    ctx.fillStyle = '#fff';
    ctx.fillText(nombre, j.x, j.y - r - 10);
    if (j.slot === miSlot) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(j.x - 7, j.y - r - 34);
      ctx.lineTo(j.x + 7, j.y - r - 34);
      ctx.lineTo(j.x, j.y - r - 26);
      ctx.fill();
    }
  }

  function dibujarHUD(v, W, H) {
    // Marcador arriba a la izquierda
    let x = 12;
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px system-ui, sans-serif';
    for (const j of [...v.jugadores].sort((a, b) => a.slot - b.slot)) {
      const col = R.COLORES[j.slot];
      const nombre = nombres[j.slot] || col.nombre;
      const ancho = ctx.measureText(nombre).width + 30 + R.PELOTAS_POR_JUGADOR * 16 + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.roundRect(x, 10, ancho, 34, 17);
      ctx.fill();
      ctx.fillStyle = col.base;
      circulo(x + 17, 27, 8);
      ctx.fillStyle = '#fff';
      ctx.fillText(nombre, x + 32, 32);
      let bx = x + 32 + ctx.measureText(nombre).width + 12;
      for (let k = 0; k < R.PELOTAS_POR_JUGADOR; k++) {
        ctx.fillStyle = k < j.puntos ? col.base : 'rgba(255,255,255,0.25)';
        circulo(bx, 27, 5.5);
        bx += 16;
      }
      x += ancho + 8;
    }

    // Cronómetro
    if (v.fase !== 'cuenta') {
      ctx.textAlign = 'right';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(formatoTiempo(v.tc), W - 90, 33);
    }

    // Cuenta atrás
    let grande = '';
    if (v.fase === 'cuenta') grande = String(Math.max(1, Math.ceil(v.cuenta)));
    else if (v.fase === 'carrera' && v.tc < 0.8) grande = '¡YA!';
    if (grande) {
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.round(Math.min(W, H) * 0.22)}px system-ui, sans-serif`;
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeText(grande, W / 2, H / 2 + Math.min(W, H) * 0.08);
      ctx.fillStyle = '#fff';
      ctx.fillText(grande, W / 2, H / 2 + Math.min(W, H) * 0.08);
    }
  }

  function formatoTiempo(s) {
    const m = Math.floor(s / 60);
    const r = (s - m * 60).toFixed(1).padStart(4, '0');
    return `${m}:${r}`;
  }

  let ultimoFin = '';
  function actualizarPanelFin(v) {
    let clave = '';
    if (v && v.fase === 'fin') clave = 'fin' + v.ganador;
    if (clave === ultimoFin) return;
    ultimoFin = clave;
    if (!clave) { $('panel-fin').style.display = 'none'; return; }
    const nombre = v.ganador >= 0 ? (nombres[v.ganador] || R.COLORES[v.ganador].nombre) : null;
    $('texto-fin').textContent = nombre ? (v.ganador === miSlot ? '¡Has ganado!' : `¡Gana ${nombre}!`) : 'Fin de la carrera';
    $('subtexto-fin').textContent = nombre ? `Tiempo: ${formatoTiempo(v.tc)}` : '';
    const soyAnf = Red.soy_anfitrion();
    $('btn-otra').style.display = soyAnf ? '' : 'none';
    $('esperando-fin').style.display = soyAnf ? 'none' : '';
    $('panel-fin').style.display = 'flex';
  }

  let ultimoFrame = performance.now();
  function dibujar(ahora) {
    requestAnimationFrame(dibujar);
    const dt = Math.min(0.1, (ahora - ultimoFrame) / 1000);
    ultimoFrame = ahora;
    if (pantalla !== 'juego') return;

    // La corrección de la predicción se va apagando (~0,1 s)
    const decae = Math.pow(0.001, dt);
    desvio.x *= decae; desvio.y *= decae;

    const v = Red.soy_anfitrion() ? vistaAnfitrion() : vistaInvitado();
    const dpr = window.devicePixelRatio || 1;
    const W = lienzo.width, H = lienzo.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1c2230';
    ctx.fillRect(0, 0, W, H);

    if (!v) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText('Esperando al anfitrión…', W / dpr / 2, H / dpr / 2);
      return;
    }

    // Encajar el mundo en la ventana
    const arriba = 56 * dpr, margen = 30 * dpr;
    const esc = Math.min((W - 2 * margen) / R.MUNDO.ancho, (H - arriba - margen) / R.MUNDO.alto);
    const ox = (W - R.MUNDO.ancho * esc) / 2;
    const oy = arriba + (H - arriba - margen - R.MUNDO.alto * esc) / 2;
    ctx.setTransform(esc, 0, 0, esc, ox, oy);

    dibujarCampo();
    const activos = new Set(v.jugadores.map(j => j.slot));
    R.CUBOS.forEach((c, i) => {
      const j = v.jugadores.find(x => x.slot === i);
      dibujarCubo(c, i, activos.has(i), j ? j.puntos : 0);
    });
    for (const p of v.pelotas) if (p.estado === R.DENTRO) dibujarPelota(p, true);
    for (const o of R.PILARES) dibujarPilar(o);

    // Jugadores y pelotas, de arriba a abajo (lo de abajo tapa a lo de arriba)
    const cosas = [];
    for (const j of v.jugadores) cosas.push({ y: j.y, f: () => dibujarJugador(j) });
    for (const p of v.pelotas) {
      if (p.estado === R.SUELTA || p.estado === R.LLEVADA) cosas.push({ y: p.y + 0.1, f: () => dibujarPelota(p, false) });
    }
    cosas.sort((a, b) => a.y - b.y);
    for (const c of cosas) c.f();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dibujarHUD(v, W / dpr, H / dpr);
    actualizarPanelFin(v);
  }
  requestAnimationFrame(dibujar);
})();
