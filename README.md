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
| Interactuar · recoger armas | E |
| Atacar | Clic izq. (combo de 3) · mantener = ataque cargado / especial del arma · en el aire = ataque en picado |
| Esquivar | Alt izq. o V (justo antes del golpe = esquiva perfecta + ráfaga) |
| Apuntar arco / escudo | Clic der. (con arco: clic izq. tensa y suelta; en el aire = tiempo bala) · con escudo: subirlo justo a tiempo = parry |
| Lanzar arma | R |
| Tipo de flecha | X mientras apuntas (normal, fuego, hielo, eléctrica) |
| Rueda de armas | Tab o Q (mantener; ratón o A/D para elegir) |
| Fijar objetivo | Z o clic central |
| Sigilo | Agachado (Ctrl/C): te ven desde menos lejos y casi no haces ruido; atacar a un enemigo desprevenido o dormido = crítico ×3 (dagas ×4) |
| Debug | F3 (incluye conos de visión de la IA) · T (mantener) acelera el tiempo · F6 abre la salida del valle · F7 viaja al siguiente encuentro · F8 reaparecer · F9 cambia el tiempo |

Remapeo en caliente (modo dev, consola): `eden.ctx.input.rebind('jump', ['KeyJ'])`; se guarda en el navegador.

## Enemigos (Fase 4)

Fuera del valle (sur): dos campamentos goblin (rutinas de día y noche, cuerno de alarma, refuerzos, cofre al despejarlos),
slimes tóxicos, eléctricos y gigante, un campo de golems dormidos, un golem grande, el Coloso de Musgo (jefe con 3 fases)
y halcones cazadores que atacan a quien planea cerca del acantilado este. Todo se define en `enemies.json` y `encounters.json`.

## Elementos y clima (Fase 5)

Fuego que se propaga por la hierba a favor del viento y crea corrientes térmicas para el planeador; hielo que congela
enemigos y crea plataformas sobre el agua; electricidad que se propaga por el agua; rayos de tormenta que buscan el metal.
Clima por bioma (lluvia, tormenta, nieve, tormenta de arena, niebla), temperatura (frío de montaña y noche del desierto,
calor del desierto de día; el fuego calienta). Antorcha, bastones elementales y flechas de fuego/hielo/eléctricas.
Datos en `biomes.json` y `elements.json`.

## Estructura

```
src/
  core/      bucle de paso fijo, ECS, bus de eventos, input, renderer, guardado
  data/      validador de esquemas, esquemas y definiciones JSON (todo el contenido)
  player/    controlador del personaje, cámara, modelo y animación
  systems/   sistemas ECS (jugador, cámara, entorno, interacción, tutorial, guardado...)
  world/     terreno por chunks, colisiones, agua, cielo, props y el Valle de la Cápsula
  combat/    inventario, daño, defensa, combos, arco, proyectiles, modelos de armas y efectos
  ai/        IA de enemigos: percepción, estados, campamentos, slimes, goblins, golems, halcones y sus visuales
  ui/        HUD, HUD de combate y overlay de debug
tests/       tests de lógica pura
```
