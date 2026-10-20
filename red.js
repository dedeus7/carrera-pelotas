// =====================================================================
// red.js — TODA la red del juego vive aquí.
//
// El resto del juego solo usa estas funciones:
//   crear_sala()  unirse(codigo)  enviar_a_todos(dato)  enviar_a(id, dato)
//   enviar_al_anfitrion(dato)  al_recibir(fn)  al_entrar_jugador(fn)
//   al_salir_jugador(fn)  soy_anfitrion()  salir()
//
// Hoy funciona con PeerJS (WebRTC). Para pasar a Steam más adelante,
// se reescribe SOLO este archivo con las mismas funciones.
// =====================================================================
(function () {
  'use strict';

  const PREFIJO = 'friendslop-carrera-pelotas-v1-';
  const LATIDO_MS = 2000;          // cada cuánto decimos "sigo aquí"
  const TIEMPO_MUERTO_MS = 8000;   // sin noticias en este tiempo = desconectado

  let peer = null;
  let anfitrion = false;
  const conexiones = new Map();    // (anfitrión) id -> { conn, ultimo }
  let conexionAnfitrion = null;    // (invitado)
  let ultimoDelAnfitrion = 0;
  let temporizadorLatido = null;

  let fnRecibir = () => {};
  let fnEntrar = () => {};
  let fnSalir = () => {};

  function codigoAleatorio() {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O para no confundirlas
    let c = '';
    for (let i = 0; i < 4; i++) c += letras[Math.floor(Math.random() * letras.length)];
    return c;
  }

  function traducirError(err) {
    switch (err && err.type) {
      case 'browser-incompatible': return 'Tu navegador no permite conexiones WebRTC. Prueba con Chrome, Edge o Firefox.';
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed': return 'No se puede conectar con el servidor de emparejamiento. ¿Tienes internet?';
      default: return 'Error de red (' + (err && err.type || 'desconocido') + ').';
    }
  }

  function vigilarServidor(p) {
    // Si se cae la conexión con el servidor de emparejamiento, reintentamos
    p.on('disconnected', () => { if (p === peer && !p.destroyed) p.reconnect(); });
  }

  // ---------- Anfitrión ----------
  function crear_sala() {
    return new Promise((resolver, rechazar) => {
      salir();
      anfitrion = true;
      const codigo = codigoAleatorio();
      const p = new Peer(PREFIJO + codigo);
      peer = p;
      let abierto = false;
      vigilarServidor(p);
      p.on('open', () => { abierto = true; iniciarLatido(); resolver(codigo); });
      p.on('connection', (conn) => prepararInvitado(conn));
      p.on('error', (err) => {
        if (abierto) return; // errores de un invitado concreto se tratan en su conexión
        if (err.type === 'unavailable-id') { // código ya en uso: probamos otro
          p.destroy();
          crear_sala().then(resolver, rechazar);
        } else {
          salir();
          rechazar(traducirError(err));
        }
      });
    });
  }

  function prepararInvitado(conn) {
    conn.on('open', () => {
      conexiones.set(conn.peer, { conn, ultimo: Date.now() });
      fnEntrar(conn.peer);
    });
    conn.on('data', (dato) => {
      const c = conexiones.get(conn.peer);
      if (!c) return;
      c.ultimo = Date.now();
      if (dato && dato.t === '__latido') return;
      fnRecibir(conn.peer, dato);
    });
    conn.on('close', () => quitarInvitado(conn.peer, 'se ha desconectado'));
    conn.on('error', () => quitarInvitado(conn.peer, 'error de conexión'));
  }

  function quitarInvitado(id, motivo) {
    const c = conexiones.get(id);
    if (!c) return;
    conexiones.delete(id);
    try { c.conn.close(); } catch (e) {}
    fnSalir(id, motivo);
  }

  // ---------- Invitado ----------
  function unirse(codigo) {
    return new Promise((resolver, rechazar) => {
      salir();
      anfitrion = false;
      const p = new Peer();
      peer = p;
      let resuelto = false;
      let espera = null;
      const fallo = (msg) => {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(espera);
        salir();
        rechazar(msg);
      };
      vigilarServidor(p);
      p.on('open', () => {
        const conn = p.connect(PREFIJO + codigo, { reliable: true, serialization: 'json' });
        espera = setTimeout(() => fallo('No se ha podido conectar. Comprueba el código o inténtalo otra vez.'), 12000);
        conn.on('open', () => {
          if (resuelto) return;
          resuelto = true;
          clearTimeout(espera);
          conexionAnfitrion = conn;
          ultimoDelAnfitrion = Date.now();
          iniciarLatido();
          resolver();
        });
        conn.on('data', (dato) => {
          if (conn !== conexionAnfitrion) return;
          ultimoDelAnfitrion = Date.now();
          if (dato && dato.t === '__latido') return;
          fnRecibir('anfitrion', dato);
        });
        conn.on('close', () => perderAnfitrion(conn, 'El anfitrión ha cerrado la partida.'));
        conn.on('error', () => perderAnfitrion(conn, 'Se ha perdido la conexión con el anfitrión.'));
      });
      p.on('error', (err) => {
        if (err.type === 'peer-unavailable') fallo('No existe ninguna partida con ese código.');
        else if (!resuelto) fallo(traducirError(err));
        else if (conexionAnfitrion && err.type !== 'network' && err.type !== 'server-error') {
          perderAnfitrion(conexionAnfitrion, 'Se ha perdido la conexión con el anfitrión.');
        }
      });
    });
  }

  function perderAnfitrion(conn, motivo) {
    if (!conexionAnfitrion || conn !== conexionAnfitrion) return;
    salir();
    fnSalir('anfitrion', motivo);
  }

  // ---------- Latido: detecta desconexiones que el navegador no avisa ----------
  function iniciarLatido() {
    clearInterval(temporizadorLatido);
    temporizadorLatido = setInterval(() => {
      const ahora = Date.now();
      if (anfitrion) {
        for (const [id, c] of conexiones) {
          if (ahora - c.ultimo > TIEMPO_MUERTO_MS) quitarInvitado(id, 'no responde');
          else if (c.conn.open) c.conn.send({ t: '__latido' });
        }
      } else if (conexionAnfitrion) {
        if (ahora - ultimoDelAnfitrion > TIEMPO_MUERTO_MS) perderAnfitrion(conexionAnfitrion, 'El anfitrión no responde.');
        else if (conexionAnfitrion.open) conexionAnfitrion.send({ t: '__latido' });
      }
    }, LATIDO_MS);
  }

  // ---------- Enviar ----------
  // (Con PeerJS todas las conexiones son "fiables". El parámetro existe
  //  para que la misma llamada sirva el día que usemos Steam.)
  function enviar_a_todos(dato, fiable) {
    for (const { conn } of conexiones.values()) if (conn.open) conn.send(dato);
  }
  function enviar_a(id, dato, fiable) {
    const c = conexiones.get(id);
    if (c && c.conn.open) c.conn.send(dato);
  }
  function enviar_al_anfitrion(dato, fiable) {
    if (conexionAnfitrion && conexionAnfitrion.open) conexionAnfitrion.send(dato);
  }

  // ---------- Salir ----------
  function salir() {
    clearInterval(temporizadorLatido);
    temporizadorLatido = null;
    const conns = [...conexiones.values()].map(c => c.conn);
    conexiones.clear();
    const ca = conexionAnfitrion;
    conexionAnfitrion = null;           // primero lo olvidamos: así cerrar no avisa dos veces
    for (const c of conns) { try { c.close(); } catch (e) {} }
    if (ca) { try { ca.close(); } catch (e) {} }
    if (peer) { const p = peer; peer = null; try { p.destroy(); } catch (e) {} }
  }

  window.Red = {
    crear_sala,
    unirse,
    enviar_a_todos,
    enviar_a,
    enviar_al_anfitrion,
    al_recibir: (fn) => { fnRecibir = fn; },
    al_entrar_jugador: (fn) => { fnEntrar = fn; },
    al_salir_jugador: (fn) => { fnSalir = fn; },
    soy_anfitrion: () => anfitrion,
    salir,
  };

  // Al cerrar la pestaña avisamos a los demás cuanto antes
  window.addEventListener('beforeunload', salir);
})();
