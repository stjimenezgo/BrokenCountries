# Broken Countries: el modelo matemático

Este documento describe, ecuación por ecuación, lo que corre por debajo del laboratorio. Cada fórmula tiene su contraparte en `src/model.js`, `src/debt.js` o `src/config.js`, y todos los números que aparecen aquí son parámetros editables en `src/config.js`.

> **Qué es y qué no es.** Es un *laboratorio de mecanismos*: sirve para ver cómo interactúan impuestos, empresas, informalidad, deuda y prestamistas. No es un pronóstico de Colombia ni está estimado econométricamente. Los parámetros son plausibles y están puestos a la vista para discutirlos. El modelo tampoco sabe nada de ideologías: solo ve palancas. La ideología la declara el jugador.

## 1. La idea en una página

Un país estilizado parecido a Colombia, con seis regiones, cinco sectores y un vecino estable. Cada trimestre ocurre esto:

1. **Choques externos.** Se mueven el precio del petróleo y los minerales y la tasa de interés mundial.
2. **Costos.** Cada empresa calcula su costo marginal: capital, trabajo (salario mínimo, prestaciones, parafiscales), riesgo de evadir y trámites.
3. **Mercados.** Las empresas compiten à la Cournot: en mercados nacionales contra importaciones, o en mercados regionales de servicios. La minería toma el precio internacional.
4. **Cuentas.** Se calculan salarios, empleo, impuestos y PIB.
5. **Gobierno.** Ingresos menos gastos menos intereses da el déficit, que hay que financiar.
6. **Mercado de deuda.** Prestamistas heterogéneos deciden cuánto prestar y a qué spread. Si no alcanza, hay recortes de emergencia o default.
7. **Macro.** Se actualizan inflación, tipo de cambio y salario real.
8. **Regiones.** Empleo, informalidad de subsistencia, migración interna, demanda, infraestructura, capital humano, seguridad y salud, más la vida urbana: crimen, incendios, epidemias y huelgas.
9. **Dinámica industrial.** Empresas que se informalizan, salen, se mudan al vecino o entran, e incumbentes que cabildean por barreras.
10. **Política.** Aprobación, pobreza, elecciones y estallido social.

El juego no tiene una solución analítica cerrada. Las regularidades (la curva de Laffer, la "tasa de países quebrados") **emergen** de agentes que siguen reglas simples.

### Agentes

| Agente | Cuántos | Qué decide |
|---|---|---|
| Empresas | ~130 al inicio (entran y salen) | Cuánto producir, qué tan informal ser, entrar, salir, mudarse al vecino |
| Empresas extranjeras | 3–6 por sector transable | Venden importaciones (compiten en Cournot) |
| Empresas relocalizadas | Las que se fueron | Venden desde el vecino, pagando arancel |
| Prestamistas | ~17 al inicio (entran y salen) | Cuánta deuda soberana tener según su riesgo percibido |
| Regiones | 6 | Empleo, migración, demanda, infraestructura, capital humano, seguridad, salud, crimen, bomberos |
| Gobierno (jugador) | 1 | 14 palancas, 3 reglas de deuda y acciones de crisis |

## 2. Notación y unidades

Un periodo $t$ es un trimestre. Las cantidades del lado real están en unidades donde el costo unitario de referencia es 1. El PIB se muestra en billones de COP reescalando el del año base a 1.600 billones/año. Las participaciones del gasto y los impuestos están en fracción del PIB. Las tasas de interés y los spreads son anuales.

- $k$: sector (agro, manufactura, tecnología, servicios, minería). $r$: región. $i$: empresa. $j$: prestamista.
- $\tau_c,\ \tau_v,\ \tau_w,\ \tau_s,\ t_m$: renta empresarial, IVA, parafiscales, regalías y arancel.
- $\bar w$: salario mínimo relativo al salario de mercado nacional. $R$: índice de trámites (0–1).
- $G^{T}, G^{I}, G^{H}, G^{S}, G^{M}, G^{F}, G^{E}, G^{C}$: transferencias, infraestructura, educación, policía y justicia, salud, bomberos, fiscalización y autoridad de competencia, todas en % del PIB.

## 3. Regiones

Cada región tiene población $n_r$, infraestructura $I_r$, capital humano $H_r$, seguridad $S_r$, salud $M_r$ (Andina = 1) y recursos naturales. Su desventaja de costos es

$$\phi_r = I_r^{-0.08}\, H_r^{-0.08}\, S_r^{-0.04}\, M_r^{-0.04}$$

y el salario de mercado regional es $\omega_r = \sqrt{H_r}$. El salario mínimo es nacional, así que **muerde más en las regiones pobres**: el sobrecosto del mínimo en la región $r$ es

$$m_r = \max\!\left(1,\ \frac{\bar w}{\omega_r}\right).$$

Con $\bar w = 0.95$, el mínimo no muerde en Bogotá ($\omega=1$) y encarece 26% el trabajo formal en la Orinoquía ($\omega \approx 0.81$).

Los bienes públicos convergen lentamente hacia un nivel que depende del gasto:

$$I_{r,t+1} = I_{r,t} + \alpha_I\left(I_{r,0}\sqrt{G^I/\bar G^I} - I_{r,t}\right),\qquad \alpha_I = 0.03$$

Lo mismo vale para $H_r$ con educación ($\alpha_H = 0.012$, es decir, décadas), para $S_r$ con policía y justicia ($\alpha_S = 0.08$), para $M_r$ con salud ($\alpha_M = 0.04$) y para la capacidad de bomberos $F_r$ ($\alpha_F = 0.1$, con $F_{r,0}=1$). **La educación paga después de que el gobierno que la financió ya se fue.**

**Prioridad regional.** El jugador puede darle a una región un peso $f_r$ (1 por defecto). El gasto en infraestructura, policía, salud y bomberos se reparte con

$$a_r = \frac{f_r}{\sum_s n_s f_s},\qquad G^{X}_r = a_r\, G^{X},$$

así que el total no cambia: lo que gana una región lo pierde el resto. En la ecuación de convergencia, $G^X$ se reemplaza por $G^X_r$.

### 3.1 Vida urbana: crimen, incendios, epidemias y huelgas

Son los sistemas que en SimCity se ven en el mapa. Aquí cada uno entra a las cuentas de las empresas o de los hogares.

**Crimen.** Cada región tiene un crimen de base $K_{r,0} = 1.3 - S_{r,0}$ (más alto donde la seguridad inicial es menor). El crimen se mueve hacia

$$K^*_r = K_{r,0}\left(\frac{u_r}{u_{r,0}}\right)^{0.5}\left(\frac{\text{pob}}{\text{pob}_0}\right)^{0.5}\left(\frac{S_{r,0}}{S_r}\right),\qquad K_{r,t+1} = K_{r,t} + 0.3\,(K^*_r - K_{r,t}).$$

Sube con el desempleo y la pobreza y baja con policía y justicia. Robos y extorsión le cuestan a cada empresa $c_K K_r$ por unidad ($c_K = 0.015$), y el crimen resta aprobación. **El crimen no se arregla solo con policía:** si sube el desempleo, sube aunque el gasto en seguridad no cambie.

**Incendios.** Cada trimestre, cada empresa se incendia y desaparece con probabilidad

$$p^{fuego}_r = \min\left(0.04,\ \frac{0.0008}{F_r^2}\right).$$

Con el gasto de referencia ($F_r=1$) son unos 3 incendios cada 8 años en todo el país; sin bomberos, la probabilidad se dispara.

**Epidemias.** En cada región aparece un brote con probabilidad $0.008\,(M_{r,0}/M_r)^3$ por trimestre. Un brote sube los costos de producir en la región un 6% ($\sigma_r$), se desvanece al 60% por trimestre y sube la pobreza.

**Huelgas.** El malestar acumula

$$g_t = 8\max(0, 1-\text{salario real}) + 5\max(0, \pi-0.05) + 4\,\text{recortes} + 3\max(0, 0.4-\text{aprob}) + 3\,\text{alzas}$$

(suavizado: $\bar g_t = 0.6\bar g_{t-1} + 0.4 g_t$). Un paro empieza con probabilidad $0.25\,\sigma\big((\bar g - 0.6)/0.12\big)$ y encarece toda la producción en $h_t = 0.04 + 0.04\min(1,\bar g)$, que se desvanece al 75% por trimestre. Si el gobierno **negocia**, el paro termina a cambio de un pago único de 1% del PIB trimestral y +2% al salario mínimo, que a su vez sube la informalidad en las regiones pobres. El tipo de paro depende de la causa: de maestros y médicos si hubo recortes, camionero si hubo impuestos nuevos, nacional si el malestar es muy alto.

## 4. Empresas: costos

### 4.1 Costo marginal

Para la empresa $i$ del sector $k$ en la región $r$, con productividad $A_i$:

$$c_i = \underbrace{\frac{\phi_r^{s_k}\,u_k\,(1+\sigma_r+h_t)}{A_i}}_{b_i}\Big[(1-\lambda_k)\big(1+\kappa_k(\rho_i - \bar r)\big) + \lambda_k\frac{\ell_i}{\bar\ell} + \underbrace{\varepsilon(E)\,e_i + \tfrac{\theta}{2}e_i^2}_{\text{costo esperado de evadir}} + c_R\,R + c_K K_r\Big]$$

- $\sigma_r$ es el sobrecosto de una epidemia en la región, $h_t$ el de una huelga y $K_r$ el crimen (sección 3.1).

- $\lambda_k$ es el peso del trabajo, $\kappa_k$ la intensidad de capital y $s_k$ qué tanto le importa la región al sector (al agro poco, a la manufactura mucho).
- $e_i \in [0, \bar e_k]$ es la fracción informal de la empresa.
- El índice de costo laboral es $\ell_i = (1-e_i)\,m_r\,(1+\nu+\tau_w) + e_i$, con prestaciones $\nu = 0.35$ y $\bar\ell = 1.44$. La parte informal paga salario de mercado sin prestaciones ni parafiscales.
- $\varepsilon(E) = s_0 + k_E\sqrt{\bar E\,E}$ es la probabilidad de detección por la multa: crece con la fiscalización $E$ con rendimientos decrecientes.

### 4.2 Costo de uso del capital (Hall–Jorgenson)

El impuesto de renta no solo grava utilidades: encarece invertir. Con tasa efectiva $\tilde\tau_i = \tau_c(1-e_i)$ y deducciones por depreciación con valor presente $z = 0.5$:

$$\rho_i = \frac{r_r\,(1 - z\,\tilde\tau_i)}{1-\tilde\tau_i}$$

El costo de financiarse en la región incluye el riesgo país y la **inestabilidad de las reglas**:

$$r_r = r^* + 0.7\,s_t + 0.4\,\sigma^{pol}_t + 0.03\,(1-S_r) + \text{crunch}_t$$

$$\sigma^{pol}_t = \sqrt{\sum_{q=t-11}^{t}\Big(\sum_{x\in\{\tau_c,\tau_v,\tau_w,\tau_s,t_m\}}\Delta x_q^2 + 0.25\,\Delta\bar w_q^2\Big)}$$

Una reforma tributaria de 5 puntos sube el costo de capital 2 puntos durante tres años, **aunque la tasa vuelva a su nivel original**.

> Sin el costo de uso del capital, el modelo no generaba curva de Laffer para la renta: en Cournot, un impuesto a la utilidad pura no cambia cuánto produce nadie. Fue el primer hallazgo de calibración.

### 4.3 Informalidad óptima

La empresa elige $e_i$ comparando el ahorro marginal de no cumplir con el costo esperado de que la detecten:

$$\min_{e}\; -\sigma_i\,e + \varepsilon(E)\,e + \tfrac{\theta}{2}e^2 \quad\Rightarrow\quad e_i^* = \text{clip}\!\left(\frac{\sigma_i - \varepsilon(E)}{\theta},\ 0,\ \bar e_k\right)$$

$$\sigma_i = \underbrace{\frac{\lambda_k\,[m_r(1+\nu+\tau_w)-1]}{\bar\ell}}_{\text{trabajo}} + \underbrace{\tau_c\,\text{margen}_i}_{\text{renta}} + \underbrace{\tau_v\,\gamma_C/2}_{\text{IVA}}$$

con ajuste parcial $e_{i,t+1} = e_{i,t} + 0.5\,(e_i^* - e_{i,t})$. El tope $\bar e_k$ va de 15% en minería a 85% en agro y servicios. Subir el salario mínimo, los parafiscales o la renta empuja a la informalidad, y la fiscalización la frena.

### 4.4 Traslado de utilidades

Las empresas trasladan utilidades al vecino (precios de transferencia) en proporción a la brecha de tasas:

$$\psi_k = \text{clip}\big(1.2\cdot\text{alcance}_k\cdot(\tau_c - \tau^n),\ 0,\ 0.6\big)$$

donde el alcance vale 1 en transables, 0.4 en servicios y 0.3 en minería. El impuesto de renta efectivamente pagado es $T^c_i = \tau_c(1-e_i)(1-\psi_k)\max(0,\pi_i)$.

## 5. Mercados: Cournot y el paradigma Estructura–Conducta–Desempeño

### 5.1 Demanda

La demanda inversa de consumidores es lineal, y el IVA abre una cuña entre lo que paga el consumidor y lo que recibe el productor:

$$P = \frac{a - b\,Q}{1+\tau_v},\qquad b = \frac{a-1}{M_t},\qquad M_t = M_0\,(1+g)^t\,d_t$$

con $a = 3.5$, crecimiento potencial $g = 0.65\%$ trimestral y un índice de demanda $d_t$ (sección 7). En transables el mercado es nacional. En servicios hay un mercado por región, de tamaño proporcional a $n_r H_r$.

### 5.2 Equilibrio de Cournot con costos heterogéneos

Con demanda $P = A - BQ$ y costos $c_i$, cada empresa maximiza $(P - c_i)q_i$. Las condiciones de primer orden dan $P - c_i = Bq_i$. Sumando sobre el conjunto activo $\mathcal A$:

$$P^* = \frac{A + \sum_{j\in\mathcal A} c_j}{|\mathcal A|+1},\qquad q_i^* = \frac{P^* - c_i}{B}\ \ (i\in\mathcal A)$$

El conjunto activo se arma ordenando por costo y agregando empresas mientras $c_i < P^*$. La ganancia es $\pi_i = B\,q_i^{*2} - f_k$.

**Importaciones.** En cada sector transable compiten $n_F$ jugadores extranjeros con costo

$$c_F = K_k\,e^{real}_t\,(1+t_m)$$

donde $K_k$ se calibra para reproducir la penetración de importaciones del año base (12% agro, 38% manufactura, 45% tecnología). Un arancel más alto o una devaluación real los sacan del mercado y dejan más espacio y más margen a los locales.

**Minería.** Es tomadora de precio: produce su capacidad si $c_i < P^s_t\,e^{real}_t$, y la capacidad se agota al 1,2% por trimestre (hay que explorar para sostenerla).

### 5.3 Estructura, conducta y desempeño

Cournot conecta los tres pisos del paradigma de Bain. Con elasticidad de la demanda $\eta$, la condición de primer orden se puede escribir como

$$\frac{P - c_i}{P} = \frac{s_i}{\eta}\qquad\Rightarrow\qquad \underbrace{\sum_i s_i\frac{P-c_i}{P}}_{\text{Lerner de la industria (desempeño)}} = \frac{\overbrace{\sum_i s_i^2}^{\text{HHI (estructura)}}}{\eta}$$

La estructura (cuántas empresas hay y qué tan desiguales son) determina los márgenes. Pero la estructura es endógena, porque depende de la conducta: entrar, salir, mudarse, informalizarse y **cabildear**.

**Captura regulatoria.** Los sectores con márgenes altos presionan por más barreras, salvo que una autoridad de competencia lo frene:

$$\beta_{k,t+1} = (1-0.04)\,\beta_{k,t} + 0.8\,\max(0,\ L_k - 0.11)\,(1-\eta^C),\qquad \eta^C = \frac{G^C}{G^C + 0.0005}$$

Así un arancel alto produce un circuito: menos importaciones, más margen, más cabildeo, más barreras, menos entrada y más margen.

## 6. Dinámica industrial: entrada, salida, relocalización

**Entrada.** Por cada mercado llegan $N^{pot}\sim\text{Poisson}(\mu_k)$ entrantes potenciales con productividad $\ln A \sim \mathcal N(\ln \bar A_k + 0.001\,t - 0.02,\ 0.1^2)$. Cada uno resuelve el Cournot que habría con él adentro y entra si

$$V^e = \frac{\pi^e\,(1-\tilde\tau)}{r_r/4 + 0.02} \;>\; F_k = \varphi_k\,\bar S_k\,(1+g)^t\,\big(1 + 2R + \beta_k\big)$$

La barrera de entrada $F_k$, medida en trimestres de ventas típicas, tiene tres capas: el costo técnico $\varphi_k$, los trámites $R$ y lo que hayan logrado los incumbentes cabildeando ($\beta_k$).

**Salida.** La empresa sale si su ganancia suavizada $\hat\pi_{i,t} = 0.6\,\hat\pi_{i,t-1} + 0.4\,\pi_{i,t}$ es negativa tres trimestres seguidos, o por muerte exógena (0,8% trimestral).

**Relocalización al vecino.** Las empresas transables comparan el valor de quedarse con el de irse:

$$V^d_i = \frac{\hat\pi_i\,(1-\tilde\tau_i)}{r_r/4 + 0.02},\qquad V^n_i = \frac{\Big[\big(\tfrac{P(1-0.04)}{1+t_m} - c^n_i\big)q_i - f_k\Big](1-\tau^n)}{(r^*+0.02)/4 + 0.02}$$

donde $c^n_i$ es su costo en el vecino (costo laboral 1,30, renta 25%, sin reformas). Pierden una fracción $\mu_k$ del valor al mudarse (60% agro, 35% manufactura, 15% tecnología). La probabilidad trimestral de irse es logística:

$$h_i = 0.10\cdot\text{logit}^{-1}\!\left(\frac{(1-\mu_k)V^n_i/V^d_i - 1 - 0.15}{0.05}\right)$$

Desde el vecino siguen vendiéndole a Colombia **pagando arancel**: el arancel también retiene inversión (el *tariff-jumping*), aunque encarezca todo lo demás.

## 7. Hogares, empleo y demanda

**Empleo.** Cada empresa emplea $\lambda_k b_i q_i / \omega_r$ trabajadores (escalado por región en la calibración), más el empleo público $0.6\,\cdot$ (valor agregado público). De la fuerza laboral $N^L_r$ que no consigue empleo en una empresa ni en el Estado, la mitad se rebusca (informalidad de subsistencia) y la otra mitad queda desempleada:

$$\text{fuera}_r = 1 - \frac{\text{empleos}_r}{N^L_r},\qquad u_r = 0.5\cdot\text{fuera}_r$$

$$\text{informalidad}_r = \frac{\sum_i e_i\,\text{empleos}_i + 0.5\,\text{fuera}_r N^L_r}{\sum_i \text{empleos}_i + 0.5\,\text{fuera}_r N^L_r}$$

**Migración interna** (Harris–Todaro simplificado): $N^L_r$ se mueve hacia regiones con menos desempleo, a una velocidad de $0.03\,(u - u_r)$ por trimestre.

**Ingreso y demanda.** El ingreso regional es salarios (ajustados por salario real) más empleo público, transferencias y la mitad de las utilidades. La demanda responde al ingreso frente a su tendencia, no al nivel, así que el componente keynesiano es transitorio:

$$y^T_{r,t} = 0.92\,y^T_{r,t-1}(1+g) + 0.08\,y_{r,t},\qquad d_{r,t+1} = 0.8\,d_{r,t} + 0.2\Big[1 + 0.7\Big(\tfrac12\tfrac{y_r}{y^T_r} + \tfrac12\tfrac{y}{y^T} - 1\Big)\Big]$$

## 8. Gobierno

**Ingresos** (reales, multiplicados por el nivel de precios):

$$T = \underbrace{\sum_i \tau_c(1-e_i)(1-\psi_k)\pi_i^+}_{\text{renta}} + \underbrace{\sum_i \tau_v\gamma_C(1-e_i)P q_i + \tau_v\gamma_C P Q^M}_{\text{IVA}} + \underbrace{\sum_i \tau_w(1-e_i)m_r\lambda_k b_i q_i}_{\text{parafiscales}} + \underbrace{\tau_s\sum_{i\in\text{min}} P^s q_i}_{\text{regalías}} + \underbrace{\tfrac{t_m}{1+t_m}\sum c_F Q^M}_{\text{aranceles}} + T^{otros}$$

$T^{otros}$ (renta de personas, predial, GMF y demás) se calibra para que el recaudo del año base sea 22,5% del PIB, y luego se mueve con la formalidad.

**Gastos.** Transferencias, infraestructura, educación, policía y justicia, salud (3%), bomberos (0,2%), fiscalización y competencia, más un gasto inflexible de 2,3% del PIB (pensiones y funcionamiento), todo como % del PIB tendencial, más los intereses y los pagos únicos para levantar huelgas. Salud, bomberos y gasto inflexible suman lo mismo que el antiguo 5,5% de gasto inflexible, así que el año base no cambia.

**Déficit y financiamiento.**

$$D_t = G_t + iB_t - T_t,\qquad \text{necesidad neta}_t = D_t - \text{emisión}_t$$

La deuda sigue la identidad de siempre. En % del PIB, con tasa $i$, crecimiento nominal $\gamma$ y balance primario $pb$:

$$b_{t+1} = b_t\,\frac{1+i_t}{1+\gamma_t} - pb_t$$

Si $i > \gamma$ (bola de nieve), se necesita superávit primario solo para estabilizar. Y como en este modelo $i$ depende del spread, y el spread de la deuda, la dinámica tiene un punto de quiebre.

**Si el mercado no alcanza:** primero se recorta hasta 40% del gasto discrecional (sube el desempleo y cae la aprobación). Si aun así no alcanza, **default**.

## 9. El mercado de deuda: "siempre aparece alguien que presta"

### 9.1 Riesgo percibido

Todos los prestamistas ven los mismos fundamentales, resumidos en un logit común:

$$z_t = -4.3 + 3.5(b_t - 0.6) + 12(\text{déf}_t - 0.04) + 6\,\sigma^{pol}_t + 3\max(0,\ 0.4 - \text{aprob}_t) - 0.8(P^s_t - 1) + 8\max(0,\ \pi_t - 0.06) + 10(r^*_t - 0.04) + \text{rep}_t - 0.6\cdot\mathbb 1[\text{pignorado}]$$

Pero cada prestamista $j$ tiene su propio sesgo $\beta_j$ (optimismo o pesimismo), así que su probabilidad anual de default es

$$p_j = \frac{1}{1+e^{-(z_t+\beta_j)}}$$

### 9.2 Cuánto quiere prestar cada uno

Con recuperación esperada $R_j$ (pérdida $L_j = 1 - R_j$), el exceso de retorno esperado a un spread $s$ es $(1-p_j)s - p_jL_j$ y su varianza es $\approx p_j(1-p_j)L_j^2$. Con aversión al riesgo $\gamma_j$, la fracción de su capital $W_j$ que quiere en bonos del país es

$$w_j(s) = \min\left(\bar w_j\,\mathcal M_j(\text{nota}),\ \frac{(1-p_j)s - p_jL_j}{\gamma_j\,L_j^2\,p_j(1-p_j)}\right)^+$$

donde $\mathcal M_j$ es el **mandato**: un fondo de pensiones puede tener mucho BB+, poco B y nada en default.

| Tipo | $\gamma$ | $R$ | $\bar w$ | Mandato | Cuándo aparece |
|---|---|---|---|---|---|
| Pensiones y bancos locales | 6 | 35% | 55% | estricto | siempre |
| Fondos globales | 4 | 40% | 30% | sensible al grado de inversión | spreads bajos |
| Hedge funds | 1,5 | 40% | 60% | ninguno | spreads de 4–8% |
| Fondos buitre | 0,6 | 70% (litigan) | 90% | ninguno | spreads > 8% o default |

### 9.3 El spread

El spread es el mínimo que hace que alguien quiera tener toda la deuda:

$$s_t^* = \min\Big\{s \in [0, 0.4] : \sum_j w_j(s)\,W_j\,Y_t \ \ge\ B_t + \text{necesidad}_t\Big\}$$

Si ni con 40% alcanza, el faltante es lo que no se pudo refinanciar. Cuando la nota cae, los mandatos recortan la demanda de los conservadores de golpe: el **precipicio del grado de inversión**.

### 9.4 El techo que se mueve

Los prestamistas entran según un proceso de Poisson cuya tasa crece con el spread:

$$\lambda^{entrada}_t = 0.12 + \min\Big(2.5,\ \frac{\max(0, s_t - 0.03)}{0.02}\cdot 0.5\Big)$$

y su tipo depende del spread: con spreads bajos entran locales y globales, con spreads medios hedge funds, y con spreads altos o en default, buitres. Esto modela lo que Edwin describía de Argentina: cada vez que el país parecía llegar a su techo de endeudamiento, **aparecía alguien que valoraba el riesgo distinto** (más optimista, menos regulado o con mejor recuperación esperada por litigar), y el techo subía artificialmente. El costo es que la deuda sigue creciendo, el default llega más tarde y más grande, y los acreedores finales son los que litigan.

## 10. Default, fondos buitre y reestructuración

- **En default:** no se pagan intereses de mercado, que se acumulan como mora. El tipo de cambio salta 20%, el crédito privado se encarece 6 puntos (que se disipan 15% por trimestre) y el déficit primario se cubre con recortes o emisión.
- **Ventas forzadas:** cada trimestre, locales y globales venden 30% de sus bonos a 30 centavos por dólar a hedge funds y buitres, según la capacidad de estos.
- **Oferta de reestructuración** con quita $h$: el prestamista $j$ acepta si $1 - h \ge R_j$. A los locales la paciencia se les agota y su $R_j$ baja 1,5 puntos por trimestre de default.
- **Cláusulas de acción colectiva (CAC):** si acepta al menos 75%, todos quedan obligados. Si no hay CAC, o si los buitres compraron más de 25%, quedan **holdouts**.
- **Holdouts:** su reclamo crece 9% anual y bloquean el acceso a crédito nuevo (como la orden *pari passu* contra Argentina en 2012–2016). Si las regalías están pignoradas, las embargan.
- **Acuerdo con holdouts:** se les paga 100% más intereses emitiendo deuda nueva, como Argentina en 2016. El laboratorio muestra el retorno que obtuvieron los buitres.
- **Pignorar regalías** baja el spread hoy (-0,6 en el logit y +12 puntos de recuperación), pero hace más difícil reestructurar y entrega las regalías en una crisis. Queda amarrado 5 años.

## 11. Macroeconomía mínima

$$\pi_t = \bar\pi + 0.4(\pi_{t-1}-\bar\pi) + 1.0\,\frac{\text{emisión}_t}{Y_t} + 0.25\,\Delta\ln e_{t-1} + 0.08(d_t-1) + \epsilon_t$$

$$\Delta\ln e_t = (\pi_t - \pi^*) + 0.6\,\Delta s_t - 0.25\,\Delta\ln P^s_t + 0.4\,\frac{\text{emisión}_t}{Y_t} - 0.05\ln e^{real}_t + \text{choque}_t$$

El salario real se erosiona con la inflación por encima de la meta y se recupera 15% por trimestre. La deuda en dólares (35%) se infla con cada devaluación: es el **pecado original**.

## 12. Política: aprobación, pobreza y estallido

$$\text{pobreza}_t = 0.33 + 0.9(u - 0.105) + 0.4(\text{inf} - \text{inf}_0) + 0.3\max(0, \pi - 0.04) - 2.5(G^T - 0.07) - 0.5(\text{salario real} - 1) - (G^M - 0.03) + 0.5\,\bar\sigma$$

$$x_t = -10(u-0.105) - 6(\text{pob}-0.33) - 5(\pi-0.04) + 4(\Delta\ln Y - 0.025) + 4(G^T-0.07) + 3(G^I+G^H+G^S-0.09) + 4(G^M - 0.03) - (\bar K - 1) - 4h_t - 5\,\text{alzas}_t - 4\,\text{recortes}_t - 0.6\,\mathbb 1[\text{default}]$$

donde $\bar\sigma$ es la epidemia promedio ponderada por población y $\bar K$ el crimen relativo al de base.

$$\text{aprob}_{t+1} = 0.75\,\text{aprob}_t + 0.25\,\big(0.45 + 0.33\tanh x_t\big)$$

Hay elecciones cada 16 trimestres y se gana con 40%. Hay **estallido social** si durante dos trimestres seguidos la aprobación está por debajo de 25% o la pobreza sube más de 10 puntos.

## 13. La curva de Laffer: de la parábola a lo emergente

**Forma reducida.** Si la base gravable cae linealmente con la tasa, $B(\tau) = B_0(1 - \tau/\tau_{max})$, el recaudo es una parábola:

$$R(\tau) = \tau B_0\Big(1-\frac{\tau}{\tau_{max}}\Big),\qquad \tau^* = \frac{\tau_{max}}{2}$$

Con una base de elasticidad constante, $B(\tau) = B_0(1-\tau)^{\varepsilon}$, el pico está en $\tau^* = 1/(1+\varepsilon)$.

**En el laboratorio nadie programa la parábola.** La base se achica porque las empresas responden por cinco canales:

1. Se informalizan (sección 4.3).
2. Invierten menos, porque sube el costo de uso del capital (4.2).
3. Trasladan utilidades (4.4).
4. Dejan de entrar o salen (6).
5. Se mudan al vecino (6).

La pestaña *Curva de Laffer* corre la economía 8 años para cada tasa y ajusta $R(\tau) = a\tau + b\tau^2$, cuyo pico es $\tau^* = -a/(2b)$. Con los parámetros actuales (6 semillas):

| Impuesto | Pico del recaudo propio | Pico del recaudo **total** |
|---|---|---|
| Renta empresarial | ≈ 45–50% | ≈ 15–40% (ruidoso) |
| IVA | ≈ 55–60% | ≈ 25% |
| Arancel | ≈ 10% | ≈ 5% |

El recaudo total se maximiza con tasas más bajas que el recaudo propio, porque subir un impuesto también achica la base de los demás. Esa es la versión "sistémica" de Laffer que la intuición suele pasar por alto.

## 14. Calibración

Lo que se **calibra** en el año base (el país arranca en un equilibrio coherente):

- Se descartan las empresas que no serían viables y se deja que la informalidad se acomode.
- El costo de los importados reproduce la penetración de importaciones observada.
- La escala de empleo por región reproduce el desempleo regional (9%–13%; nacional 10,5%).
- $T^{otros}$ lleva el recaudo a 22,5% del PIB. El déficit inicial queda en ≈ 3% del PIB, con una deuda de 55%.

Momentos que **resultan** (no se imponen): informalidad ≈ 53%, márgenes de Lerner de 10–14% (33% en minería) y spread ≈ 220 pb con nota BB+.

Lo que es **supuesto**: casi todo lo demás. Las elasticidades más influyentes son la respuesta de la informalidad al costo laboral ($\theta$), la sensibilidad del riesgo percibido a la deuda y al déficit, y la capacidad de los prestamistas.

## 15. Resultados preliminares: tasa de países quebrados

Son 200 partidas de 8 años por paquete, con los mismos choques para todos los paquetes. Las tasas cuentan si el evento ocurrió al menos una vez.

| Paquete | Default | Estallido | Pierde elecciones | Deuda final | Informalidad | Pobreza |
|---|---|---|---|---|---|---|
| Statu quo | 24% | 35% | 80% | 62% | 55% | 35% |
| Más impuestos y más gasto | 100% | 100% | 86% | 65% | 63% | 35% |
| Estado grande con base formal | 26% | 21% | 40% | 64% | 50% | 29% |
| Estado mínimo | 0% | 22% | 78% | 29% | 42% | 37% |
| Populismo fiscal | 100% | 100% | 100% | 74% | 66% | 44% |
| Consolidación ortodoxa | 0% | 51% | 97% | 36% | 52% | 37% |
| Pro-inversión estable | 0% | 8% | 42% | 46% | 44% | 33% |
| Reforma tributaria cada año | 84% | 98% | 99% | 50% | 57% | 39% |

Con crimen, incendios, epidemias y huelgas, el statu quo quiebra en 24% de las partidas. Sin esos sistemas (versión anterior, con 100 partidas) quebraba en 18%. Los choques de la vida urbana no quiebran un país sano, pero empujan a uno que ya tiene un déficit de 3% del PIB.

Cómo leerla:

- **No hay un ganador limpio.** Lo que evita el default (consolidación, Estado mínimo) suele perder elecciones o subir la pobreza. La consolidación ortodoxa, además, provoca estallidos en la mitad de las partidas: los recortes desatan paros y el desempleo sube el crimen. Lo que más baja la pobreza (Estado grande con base formal) quiebra a uno de cada cuatro países.
- **Cómo se financia importa más que cuánto.** "Más impuestos y más gasto" y "Estado grande con base formal" gastan parecido. El primero sube nómina y salario mínimo, y la base se le va a la informalidad.
- **La inestabilidad cuesta por sí sola.** Cambiar impuestos cada año, sin subirlos en promedio, quiebra al país 3 de cada 4 veces: sube el costo de capital y el riesgo percibido.
- La pestaña *¿Qué palanca pesa más?* descompone cada paquete. Por ejemplo, subir transferencias 2,5 puntos del PIB sin financiarlas lleva por sí solo la tasa de default de 24% a 90%.

Estos números dependen de los parámetros. El punto no es el número exacto, sino **por qué** sale.

## 16. Mecanismos contraintuitivos que el modelo produce

1. **Subir la renta puede bajar el recaudo total:** por informalidad, traslado de utilidades, costo de capital y relocalización.
2. **El salario mínimo nacional golpea a las regiones pobres:** el sobrecosto es mayor donde la productividad es menor, y ahí sube la informalidad.
3. **Los aranceles protegen a los incumbentes, no a los trabajadores:** suben márgenes, financian cabildeo y levantan barreras. Paradójicamente, también retienen empresas que de otro modo exportarían desde el vecino.
4. **La estabilidad vale tanto como el nivel:** reformar seguido sube el costo de capital y el riesgo país.
5. **Los prestamistas nuevos postergan la crisis y la agrandan:** el techo de deuda se corre mientras alguien valore distinto el riesgo.
6. **Pignorar recursos abarata hoy y encarece mañana.**
7. **Las CAC no blindan contra buitres que compran más de 25%.**
8. **La educación es la mejor inversión que ningún gobierno alcanza a cobrar.**
9. **Emitir para financiarse sale caro dos veces:** por la inflación y por la deuda en dólares que se infla con la devaluación.
10. **Recortar salud y policía para cuadrar la caja sale caro:** suben las epidemias y el crimen, que encarecen producir, y los recortes desatan paros. Lo que se ahorra en gasto se pierde en base gravable.
11. **Negociar una huelga cuesta más que el pago:** el alza del mínimo empuja informalidad en las regiones pobres por años.

## 17. Limitaciones y siguientes pasos

- **Calibración seria:** estimar $\theta$, la respuesta de la informalidad al mínimo y a la nómina, con microdatos (GEIH, PILA) y la sensibilidad del spread con datos de EMBI.
- **Agentes que faltan:** el FMI (prestamista condicionado), bancos locales que caen junto con el soberano (*doom loop*), gremios como agentes políticos y el Congreso como veto. Los sindicatos hoy son una regla de malestar, no agentes que negocian.
- **Expectativas:** hoy los agentes son adaptativos y ninguno anticipa la política futura.
- **Juego:** la capa isométrica (`index.html`) dibuja cada empresa de `w.firms` como un edificio. Faltan zonificación, transporte y contaminación, que son lo propio de SimCity (sección 18).
- **Experimento de creencias:** la exportación JSON ya guarda la ideología declarada y la trayectoria de palancas. Con un backend, se podría medir la tasa de países quebrados por ideología declarada y cómo cambian las decisiones de un jugador después de varias partidas.

## 18. SimCity y este modelo: en qué se parecen y en qué no

La interfaz se parece a SimCity a propósito: presupuesto con partidas, leyes, bonos, capas del mapa, periódico e indicador de demanda. El motor es otra cosa.

| | SimCity (1989–2013) | Broken Countries |
|---|---|---|
| Qué simula | Una ciudad: suelo, tráfico, contaminación, servicios | Un país: mercados, empresas, fisco, deuda, política |
| Quién decide | El jugador construye y zonifica; la ciudad responde con reglas | El jugador solo fija políticas; miles de decisiones de agentes producen el resultado |
| Los agentes | Autómatas celulares y "sims" sin objetivos: siguen reglas de vecindad | Empresas que maximizan utilidades (Cournot), eligen informalidad, entran, salen o se van; prestamistas que eligen cartera |
| Impuestos | Subirlos baja la demanda RCI con una curva programada a mano | La caída del recaudo **emerge** de informalidad, inversión, traslado de utilidades y relocalización |
| Precios | No hay: la demanda es un índice | Precios, márgenes y concentración salen del equilibrio de mercado |
| Deuda | Bonos a tasa fija según la deuda; nunca hay default | Spread que sale de prestamistas heterogéneos, rating, default, buitres y holdouts |
| Economía abierta | Ciudades vecinas como comercio simple | Importaciones, tipo de cambio, deuda en dólares y un vecino que compite por las empresas |
| Política | El alcalde no pierde elecciones | Aprobación, elecciones cada 4 años y estallido social |
| Espacio | Su fuerte: cada baldosa importa (tráfico, valor del suelo, contaminación) | Débil: el mapa es una vista de 6 regiones; la ubicación exacta de cada edificio no afecta nada |

**La diferencia de fondo.** SimCity es un modelo **de reglas**: el diseñador decide de antemano cómo responde la demanda a un impuesto o a un parque. Este es un modelo **de decisiones**: el diseñador decide qué quiere cada agente y qué restricciones tiene, y la respuesta agregada (la curva de Laffer, el techo de deuda, la ola de informalidad) aparece sola. Por eso aquí se puede hacer la pregunta de Edwin y contestarla con una frecuencia: en SimCity un país no puede quebrar.

**Lo que SimCity tiene y aquí falta:** la geografía fina. Zonificar, construir vías y ubicar hospitales en una baldosa precisa no existe todavía; la "prioridad de inversión" por región es la versión gruesa. Llevar el modelo a baldosas sería el siguiente paso si se quiere que el mapa sea parte de la economía y no solo su vista.

## Referencias de los mecanismos

- Cournot (1838). Competencia en cantidades. Cowling y Waterson (1976). La relación entre el Lerner de la industria y el HHI.
- Bain (1956). *Barriers to New Competition*. El paradigma Estructura–Conducta–Desempeño.
- Hall y Jorgenson (1967). *Tax Policy and Investment Behavior*. El costo de uso del capital.
- Harris y Todaro (1970). Migración y desempleo.
- Eaton y Gersovitz (1981). La deuda soberana con riesgo de repudio.
- Reinhart, Rogoff y Savastano (2003). *Debt Intolerance*. Los umbrales de deuda bajos en emergentes.
- Eichengreen y Hausmann (1999). El pecado original.
- *NML Capital v. Argentina* (2012–2016). Holdouts y la cláusula *pari passu*.
- Kugler y Kugler (2009) y la literatura sobre la reforma de 2012 en Colombia. Costos laborales no salariales e informalidad.
