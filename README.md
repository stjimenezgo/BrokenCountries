# Broken Countries

Un laboratorio, y en el futuro un juego tipo SimCity, para **intentar salvar la economía de un país latino** (una Colombia estilizada) y descubrir por qué la intuición suele fallar.

Debajo corre un **modelo por agentes**:

- Empresas que compiten (Cournot), se informalizan, entran, salen, cabildean por barreras y se mudan al país vecino.
- Seis regiones con infraestructura, capital humano, seguridad, empleo, migración y demanda.
- Un gobierno (tú) con 14 palancas de impuestos, gasto, comercio, trabajo y deuda.
- Prestamistas heterogéneos (pensiones, fondos globales, hedge funds y fondos buitre) que deciden a qué spread financiar al país. Cuando los conservadores se llenan, aparecen otros que valoran el riesgo distinto.

La curva de Laffer, la "tasa de países quebrados" y los dilemas entre quebrar, perder elecciones o provocar un estallido social **emergen** de esas reglas: no están programados.

📐 El modelo matemático completo está en [docs/MODELO.md](docs/MODELO.md) y también se ve dentro de la app, en la pestaña *Modelo matemático*.

## Correrlo

No necesita instalación ni compilación. Son módulos ES que se sirven como archivos estáticos.

```bash
node tools/serve.js 8080
```

Abre `http://localhost:8080`. Cualquier servidor estático sirve; no funciona abriendo `index.html` como archivo.

Para correr el modelo sin interfaz (calibración y experimentos):

```bash
node tools/headless.js baseline 1   # una partida con el statu quo, semilla 1
node tools/headless.js mc 60        # Monte Carlo de todos los paquetes de política
node tools/headless.js laffer vat   # barrido de Laffer para el IVA
```

## Publicarlo en GitHub Pages

1. Sube el repositorio a GitHub.
2. Ve a *Settings → Pages → Deploy from a branch* y elige `main` con la carpeta `/ (root)`.
3. El archivo `.nojekyll` ya está incluido para que Pages sirva los `.md` y los módulos tal cual.

## Estructura

| Archivo | Qué tiene |
|---|---|
| `src/config.js` | **Todos los supuestos**: regiones, sectores, prestamistas, palancas y parámetros |
| `src/model.js` | Motor trimestral: costos, mercados, cuentas, gobierno, macro, regiones y dinámica de empresas |
| `src/debt.js` | Mercado de deuda, prestamistas, default, buitres, reestructuración y holdouts |
| `src/cournot.js` | Equilibrio de Cournot con costos heterogéneos |
| `src/experiments.js` | Paquetes de política, Monte Carlo y curva de Laffer emergente |
| `src/ui.js`, `index.html`, `css/` | Interfaz del laboratorio |
| `docs/MODELO.md` | Las ecuaciones, la calibración y los resultados preliminares |
| `tools/` | Servidor local y corredor sin interfaz |

## Advertencia

Es un laboratorio de mecanismos, no un pronóstico. Los parámetros son plausibles, no estimados, y están a la vista para discutirlos. El modelo no conoce ideologías: solo ve palancas.
