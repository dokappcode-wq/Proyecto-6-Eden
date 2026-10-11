# EDEN – The Lost World

Acción-aventura de mundo abierto en tercera persona (Three.js + TypeScript + Vite).

## Ejecutar

```bash
npm install
npm run dev        # abre http://localhost:8006
npm test           # tests de lógica pura (Vitest)
npm run build      # typecheck + build de producción
```

## Controles (remapeables en `src/data/definitions/input.json`)

| Acción | Tecla |
|---|---|
| Mover | WASD / flechas |
| Mirar | Ratón (clic en la pantalla para capturarlo) · rueda = zoom |
| Saltar · Impulso de Borde | Espacio (salta contra un borde) |
| Planeador | Espacio en el aire · W picado · S frenar · A/D girar |
| Sprint | Shift izq. |
| Trepar | Camina contra la roca (o E junto a la pared) · Espacio salta entre agarres · S+Espacio se suelta hacia atrás · Ctrl se deja caer |
| Bucear | Ctrl en el agua |
| Rodar al aterrizar | Ctrl o Alt justo antes de tocar el suelo (mitad de daño) |
| Andar / agacharse | Bloq Mayús / Ctrl o C |
| Interactuar | E |
| Debug | F3 · T (mantener) acelera el tiempo · F6 abre la salida del valle · F8 reaparecer |

Remapeo en caliente (modo dev, consola): `eden.ctx.input.rebind('jump', ['KeyJ'])`; se guarda en el navegador.

## Estructura

```
src/
  core/      bucle de paso fijo, ECS, bus de eventos, input, renderer, guardado
  data/      validador de esquemas, esquemas y definiciones JSON (todo el contenido)
  player/    controlador del personaje, cámara, modelo y animación
  systems/   sistemas ECS (jugador, cámara, entorno, interacción, tutorial, guardado...)
  world/     terreno por chunks, colisiones, agua, cielo, props y el Valle de la Cápsula
  ui/        HUD y overlay de debug
  combat/ items/ ai/   (fases siguientes)
tests/       tests de lógica pura
```
