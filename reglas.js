// =====================================================================
// reglas.js — Reglas y física de "Carrera de Pelotas".
//
// No sabe nada de la red ni de la pantalla: solo números.
// Lo usan:
//   - el ANFITRIÓN, para simular la partida "de verdad";
//   - los INVITADOS, para predecir su propio movimiento con
//     exactamente el mismo código (moverJugador).
// =====================================================================
(function (global) {
  'use strict';

  // ---------- Constantes del mundo ----------
  const MUNDO = { ancho: 1400, alto: 700 };

  const COLORES = [
    { nombre: 'Rojo',     claro: '#ff8a7e', base: '#e5392c', oscuro: '#8f1f17' },
    { nombre: 'Azul',     claro: '#8cbaff', base: '#2f6fe0', oscuro: '#173e88' },
    { nombre: 'Amarillo', claro: '#fff0a8', base: '#f2bb1d', oscuro: '#94700a' },
  ];

  const MAX_JUGADORES = 3;
  const PELOTAS_POR_JUGADOR = 5;
  const DT = 1 / 60;            // un "tick" de simulación
  const DURACION_CUENTA = 3;    // segundos de cuenta atrás

  const R_JUGADOR = 22;
  const R_PELOTA = 13;
  const VEL_JUGADOR = 280;      // unidades por segundo
  const ALTURA_JUGADOR = 44;    // pelotas más altas que esto pasan por encima
  const LINEA_SALIDA_X = 250;

  // Un cubo por color, al principio de la carrera (a la izquierda)
  const CUBOS = [
    { x: 100, y: 175, r: 44 },
    { x: 100, y: 350, r: 44 },
    { x: 100, y: 525, r: 44 },
  ];
  // Posiciones de salida: en línea, justo detrás de la línea de salida
  const SALIDAS = CUBOS.map(c => ({ x: LINEA_SALIDA_X - 30, y: c.y }));

  // Pilares fijos para que las pelotas tengan contra qué rebotar
  const PILARES = [
    { x: 560,  y: 250, r: 28 },
    { x: 560,  y: 450, r: 28 },
    { x: 820,  y: 130, r: 32 },
    { x: 820,  y: 570, r: 32 },
    { x: 900,  y: 350, r: 42 },
    { x: 1160, y: 240, r: 30 },
    { x: 1160, y: 460, r: 30 },
  ];
  const OBSTACULOS = PILARES.concat(CUBOS);

  // Física de las pelotas
  const GRAVEDAD = 1500;
  const REBOTE_SUELO = 0.62;
  const REBOTE_PARED = 0.8;
  const REBOTE_PELOTAS = 0.9;
  const REBOTE_JUGADOR = 0.7;
  const FRENO_SUELO = 0.45;     // fracción de velocidad que queda tras 1 s rodando
  const FRENO_AIRE = 0.95;
  const ALTURA_CUBO = 34;
  const LANZ_VEL = 560;
  const LANZ_VZ = 420;
  const BLOQUEO_LANZ = 0.35;    // s sin poder recoger una pelota recién lanzada

  // Estados de una pelota
  const SUELTA = 0, LLEVADA = 1, DENTRO = 2, FUERA = 3;
  const FASES = ['cuenta', 'carrera', 'fin'];

  // ---------- Utilidades ----------
  function aleatorio(a, b) { return a + Math.random() * (b - a); }
  function limitar(v, min, max) { return v < min ? min : v > max ? max : v; }

  function tocaObstaculo(x, y, margen) {
    return OBSTACULOS.some(o => Math.hypot(x - o.x, y - o.y) < o.r + margen);
  }

  // Saca un círculo (j) fuera de otro círculo fijo
  function empujarFuera(c, cx, cy, distMin) {
    const dx = c.x - cx, dy = c.y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= distMin) return;
    if (d === 0) { c.x = cx + distMin; return; }
    c.x = cx + dx / d * distMin;
    c.y = cy + dy / d * distMin;
  }

  // Igual, pero además hace rebotar la velocidad
  function rebotarEnCirculo(p, cx, cy, distMin, rebote) {
    const dx = p.x - cx, dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= distMin) return false;
    const nx = d === 0 ? 1 : dx / d, ny = d === 0 ? 0 : dy / d;
    p.x = cx + nx * distMin;
    p.y = cy + ny * distMin;
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) { p.vx -= (1 + rebote) * vn * nx; p.vy -= (1 + rebote) * vn * ny; }
    return true;
  }

  // ---------- Crear una partida ----------
  // slots: lista de colores que juegan, p. ej. [0, 1, 2]
  function crearMundo(slots) {
    const m = {
      fase: 'cuenta',
      cuenta: DURACION_CUENTA,
      tiempoCarrera: 0,
      ganador: -1,
      jugadores: [],
      pelotas: [],
    };
    for (const slot of slots) {
      const s = SALIDAS[slot];
      m.jugadores.push({ slot, x: s.x, y: s.y, vx: 0, vy: 0, fx: 1, fy: 0, puntos: 0, lleva: -1, ack: 0 });
    }
    // Las posiciones aleatorias las decide SOLO el anfitrión (luego se envían)
    let id = 0;
    for (const slot of slots) {
      for (let k = 0; k < PELOTAS_POR_JUGADOR; k++) {
        let x, y, intentos = 0;
        do {
          x = aleatorio(480, MUNDO.ancho - 40);
          y = aleatorio(50, MUNDO.alto - 50);
          intentos++;
        } while (intentos < 60 && tocaObstaculo(x, y, R_PELOTA + 10));
        m.pelotas.push({
          id: id++, color: slot,
          x, y, z: aleatorio(120, 380),            // caen del cielo al empezar
          vx: aleatorio(-80, 80), vy: aleatorio(-80, 80), vz: 0,
          estado: SUELTA, portador: -1, bloqueo: 0,
        });
      }
    }
    return m;
  }

  function buscarJugador(m, slot) {
    for (const j of m.jugadores) if (j.slot === slot) return j;
    return null;
  }

  // Si alguien se va: quitamos su jugador y sus pelotas (sin cambiar los ids de las demás)
  function quitarJugador(m, slot) {
    m.jugadores = m.jugadores.filter(j => j.slot !== slot);
    for (const p of m.pelotas) if (p.color === slot) { p.estado = FUERA; p.portador = -1; }
    if (m.fase === 'carrera' && m.jugadores.length === 0) m.fase = 'fin';
  }

  // ---------- Movimiento del jugador ----------
  // ex, ey: dirección pulsada (-1, 0 o 1). Determinista: mismo resultado en todos los PCs.
  function moverJugador(j, ex, ey, dt) {
    const largo = Math.hypot(ex, ey);
    if (largo > 0) { ex /= largo; ey /= largo; j.fx = ex; j.fy = ey; }
    j.vx = ex * VEL_JUGADOR;
    j.vy = ey * VEL_JUGADOR;
    j.x += j.vx * dt;
    j.y += j.vy * dt;
    for (const o of OBSTACULOS) empujarFuera(j, o.x, o.y, o.r + R_JUGADOR);
    j.x = limitar(j.x, R_JUGADOR, MUNDO.ancho - R_JUGADOR);
    j.y = limitar(j.y, R_JUGADOR, MUNDO.alto - R_JUGADOR);
  }

  // ---------- Acciones ----------
  function lanzar(m, j) {
    if (j.lleva < 0) return;
    const p = m.pelotas[j.lleva];
    j.lleva = -1;
    p.estado = SUELTA;
    p.portador = -1;
    p.x = j.x + j.fx * (R_JUGADOR + R_PELOTA + 2);
    p.y = j.y + j.fy * (R_JUGADOR + R_PELOTA + 2);
    p.z = 22;
    p.vx = j.fx * LANZ_VEL + j.vx * 0.4;
    p.vy = j.fy * LANZ_VEL + j.vy * 0.4;
    p.vz = LANZ_VZ;
    p.bloqueo = BLOQUEO_LANZ;
  }

  function meterEnCubo(m, p) {
    const dueno = buscarJugador(m, p.color);
    if (!dueno) return;
    if (dueno.lleva === p.id) dueno.lleva = -1;
    const cubo = CUBOS[p.color];
    const ang = dueno.puntos * (Math.PI * 2 / PELOTAS_POR_JUGADOR) - Math.PI / 2;
    p.estado = DENTRO;
    p.portador = -1;
    p.x = cubo.x + Math.cos(ang) * 17;
    p.y = cubo.y + Math.sin(ang) * 17;
    p.z = 0; p.vx = p.vy = p.vz = 0;
    dueno.puntos++;
    if (dueno.puntos >= PELOTAS_POR_JUGADOR && m.fase === 'carrera') {
      m.fase = 'fin';
      m.ganador = dueno.slot;
    }
  }

  // ---------- Un paso de física (solo lo ejecuta el anfitrión) ----------
  function pasoFisica(m, dt) {
    if (m.fase === 'cuenta') {
      m.cuenta -= dt;
      if (m.cuenta <= 0) { m.cuenta = 0; m.fase = 'carrera'; }
    } else if (m.fase === 'carrera') {
      m.tiempoCarrera += dt;
    }
    const enCarrera = m.fase === 'carrera';

    // 1) Movimiento de cada pelota
    for (const p of m.pelotas) {
      if (p.estado === LLEVADA) {
        const j = buscarJugador(m, p.portador);
        if (j) {
          p.x = j.x + j.fx * (R_JUGADOR + R_PELOTA - 4);
          p.y = j.y + j.fy * (R_JUGADOR + R_PELOTA - 4);
          p.z = 20; p.vx = j.vx; p.vy = j.vy; p.vz = 0;
          continue;
        }
        p.estado = SUELTA; p.portador = -1;
      }
      if (p.estado !== SUELTA) continue;
      if (p.bloqueo > 0) p.bloqueo -= dt;

      // Altura: gravedad y bote en el suelo
      p.vz -= GRAVEDAD * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0;
        p.vz = p.vz < -90 ? -p.vz * REBOTE_SUELO : 0;
      }

      // Plano: avance y rozamiento
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const freno = Math.pow(p.z === 0 ? FRENO_SUELO : FRENO_AIRE, dt);
      p.vx *= freno; p.vy *= freno;

      // Paredes del campo
      if (p.x < R_PELOTA) { p.x = R_PELOTA; p.vx = Math.abs(p.vx) * REBOTE_PARED; }
      if (p.x > MUNDO.ancho - R_PELOTA) { p.x = MUNDO.ancho - R_PELOTA; p.vx = -Math.abs(p.vx) * REBOTE_PARED; }
      if (p.y < R_PELOTA) { p.y = R_PELOTA; p.vy = Math.abs(p.vy) * REBOTE_PARED; }
      if (p.y > MUNDO.alto - R_PELOTA) { p.y = MUNDO.alto - R_PELOTA; p.vy = -Math.abs(p.vy) * REBOTE_PARED; }

      // Pilares (son altos: rebotan a cualquier altura)
      for (const o of PILARES) rebotarEnCirculo(p, o.x, o.y, o.r + R_PELOTA, REBOTE_PARED);

      // Cubos: tu pelota entra en tu cubo; las demás rebotan en el borde
      if (p.z <= ALTURA_CUBO) {
        for (let c = 0; c < CUBOS.length; c++) {
          const cubo = CUBOS[c];
          if (c === p.color) {
            if (enCarrera && Math.hypot(p.x - cubo.x, p.y - cubo.y) < cubo.r - 6) { meterEnCubo(m, p); break; }
          } else {
            rebotarEnCirculo(p, cubo.x, cubo.y, cubo.r + R_PELOTA, REBOTE_PARED);
          }
        }
      }
    }

    // 2) Choques entre pelotas
    const ps = m.pelotas;
    for (let a = 0; a < ps.length; a++) {
      const p = ps[a];
      if (p.estado !== SUELTA) continue;
      for (let b = a + 1; b < ps.length; b++) {
        const q = ps[b];
        if (q.estado !== SUELTA || Math.abs(p.z - q.z) > R_PELOTA * 2) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy), min = R_PELOTA * 2;
        if (d >= min || d === 0) continue;
        const nx = dx / d, ny = dy / d, solape = (min - d) / 2;
        p.x -= nx * solape; p.y -= ny * solape;
        q.x += nx * solape; q.y += ny * solape;
        const vrel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
        if (vrel > 0) {
          const imp = (1 + REBOTE_PELOTAS) * vrel / 2;
          p.vx -= imp * nx; p.vy -= imp * ny;
          q.vx += imp * nx; q.vy += imp * ny;
        }
      }
    }

    // 3) Jugadores contra pelotas: recoger la tuya o empujar las demás
    for (const j of m.jugadores) {
      for (const p of m.pelotas) {
        if (p.estado !== SUELTA || p.z > ALTURA_JUGADOR) continue;
        const dx = p.x - j.x, dy = p.y - j.y;
        const d = Math.hypot(dx, dy), min = R_JUGADOR + R_PELOTA;
        if (d >= min) continue;
        if (enCarrera && p.color === j.slot && j.lleva < 0 && p.bloqueo <= 0) {
          p.estado = LLEVADA; p.portador = j.slot; j.lleva = p.id;
          continue;
        }
        const nx = d === 0 ? 1 : dx / d, ny = d === 0 ? 0 : dy / d;
        p.x = j.x + nx * min; p.y = j.y + ny * min;
        const vrel = (p.vx - j.vx) * nx + (p.vy - j.vy) * ny;
        if (vrel < 0) {
          p.vx -= (1 + REBOTE_JUGADOR) * vrel * nx;
          p.vy -= (1 + REBOTE_JUGADOR) * vrel * ny;
          if (p.z === 0 && -vrel > 150) p.vz = Math.max(p.vz, 160); // patada: salta un poco
        }
      }
      // Llegar al cubo con tu pelota en la mano también cuenta
      if (enCarrera && j.lleva >= 0) {
        const cubo = CUBOS[j.slot];
        if (Math.hypot(j.x - cubo.x, j.y - cubo.y) < cubo.r + R_JUGADOR + 8) meterEnCubo(m, m.pelotas[j.lleva]);
      }
    }
  }

  // ---------- Empaquetar el estado para enviarlo por la red ----------
  function r2(v) { return Math.round(v * 100) / 100; }
  function serializar(m) {
    return {
      t: 'e',
      f: FASES.indexOf(m.fase),
      c: r2(m.cuenta),
      tc: r2(m.tiempoCarrera),
      g: m.ganador,
      j: m.jugadores.map(j => [j.slot, r2(j.x), r2(j.y), Math.round(j.fx * 100), Math.round(j.fy * 100), j.ack, j.puntos, j.lleva]),
      p: m.pelotas.map(p => [Math.round(p.x), Math.round(p.y), Math.round(p.z), p.estado, p.portador]),
    };
  }

  const Reglas = {
    MUNDO, COLORES, MAX_JUGADORES, PELOTAS_POR_JUGADOR, DT,
    R_JUGADOR, R_PELOTA, LINEA_SALIDA_X, CUBOS, PILARES, FASES,
    SUELTA, LLEVADA, DENTRO, FUERA,
    crearMundo, buscarJugador, quitarJugador, moverJugador, lanzar, pasoFisica, serializar,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Reglas;
  else global.Reglas = Reglas;
})(typeof window !== 'undefined' ? window : globalThis);
