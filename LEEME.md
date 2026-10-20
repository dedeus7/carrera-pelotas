# Carrera de Pelotas (prototipo online, 1–3 jugadores)

## Cómo probarlo en tu PC
1. Abre `index.html` en Chrome (doble clic). Hace falta internet: PeerJS usa su servidor gratuito para emparejar.
2. Abre una **segunda ventana** (no pestaña) con el mismo archivo y ponlas una al lado de la otra.
   Si el anfitrión queda en una pestaña oculta, el navegador lo frena y el juego va a trompicones.
3. Ventana 1: "Crear partida". Ventana 2: escribe el código de 4 letras y "Unirse".
4. El anfitrión pulsa "¡Empezar!" (puede empezar con 1, 2 o 3 jugadores).

## Controles
- WASD o flechas: moverse
- Espacio: lanzar la pelota que llevas (puedes encestarla en tu cubo desde lejos)

## Reglas
- Solo puedes coger pelotas de tu color, de una en una.
- Las de otros colores las empujas (¡sabotaje permitido!).
- Gana quien meta antes sus 5 pelotas en su cubo.

## Archivos
- `red.js`     → toda la red (PeerJS). Para Steam, solo se cambia este archivo.
- `reglas.js`  → reglas y física, sin red ni dibujo.
- `juego.js`   → menú, sala, predicción, interpolación y dibujo.
- `index.html` → la página.

## Jugar con amigos en otras casas
Sube la carpeta a un sitio web gratuito (GitHub Pages o itch.io) y pásales el enlace.
PeerJS trae un reenvío de prueba para redes difíciles, pero puede ir lento o fallar a veces.
