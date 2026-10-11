# EDEN – The Lost World

Acción-aventura de mundo abierto en tercera persona (Three.js + TypeScript + Vite).

## Ejecutar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests de lógica pura (Vitest)
npm run build      # typecheck + build de producción
```

## Controles (remapeables en `src/data/definitions/input.json`)

| Acción | Tecla |
|---|---|
| Mover | WASD / flechas |
| Saltar / planeador | Espacio |
| Sprint | Shift izq. |
| Agacharse | Ctrl izq. / C |
| Interactuar | E |
| Atacar / apuntar | Ratón izq. / der. |
| Esquivar | Alt izq. |
| Mapa | M |
| Pausa | Esc |
| Debug | F3 |

Remapeo en caliente (modo dev, consola): `eden.ctx.input.rebind('jump', ['KeyJ'])` — se guarda en el navegador.

## Estructura

```
src/
  core/      bucle de paso fijo, ECS, bus de eventos, input, renderer
  data/      validador de esquemas, esquemas y definiciones JSON
  systems/   sistemas ECS (snapshot de transforms, render, ...)
  world/     creación del mundo a partir de datos
  ui/        HUD y overlay de debug
  player/ combat/ items/ ai/   (fases siguientes)
tests/       tests de lógica pura
```
