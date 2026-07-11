# Fidelia — Guía simple: montar, vender e implantar

Fidelia es **tu** plataforma de fidelización: un solo servidor donde viven todos
tus restaurantes clientes. Cada uno tiene su dirección, sus claves, sus clientes
y su configuración (colores, puntos, **niveles y recompensas editables en vivo**),
totalmente aislado de los demás. Tú cobras una suscripción; si no pagan, se
suspenden solos (sin borrar nada) y se reactivan solos al pagar.

---

## PASO 1 — Monta tu plataforma (una sola vez, ~10 min)

**Recomendado: Render con Blueprint (1 clic, ya incluye el disco de datos):**
1. Sube el contenido de esta carpeta a un repositorio de GitHub (incluye el
   archivo `render.yaml`, que es el que hace la magia).
2. En **render.com** → **New → Blueprint** → conecta el repositorio → **Apply**.
   El `render.yaml` crea solo el servicio (Docker + HTTPS + health check en
   `/healthz`) **con el disco persistente en `/data` ya montado** — el punto
   donde más se equivoca la gente, aquí ya viene hecho. Plan Starter (~7 $/mes).
3. Al terminar tendrás `https://tu-app.onrender.com`. **Esa es tu plataforma.**
4. Cada vez que subas cambios a GitHub, Render redespliega solo y los datos
   del disco se conservan.

**Para probar en tu PC (gratis):** `python fidelia.py` (Python 3.9+, también
3.14, sin instalar nada más) y abre `http://localhost:8000/platform`. Para
enseñarlo desde fuera: `cloudflared tunnel --url http://localhost:8000`.

**Primer acceso:** `https://tu-plataforma/platform` → usuario `admin`,
contraseña `admin` → botón «Contraseña» y cámbiala. Este panel es solo tuyo.

## PASO 2 — Vende (el discurso de 1 minuto)

> «Te monto un club de fidelización con tu nombre y tus colores: tus clientes
> suman puntos al pagar, suben de nivel y canjean premios que tú decides.
> Funciona como app en tu tablet y en el móvil de tus clientes, sin instalar
> nada y sin cuotas de terceros. Te lo dejo funcionando hoy en 5 minutos.»

Enséñalo en tu móvil con un restaurante de demo. Se vende solo viéndolo.

## PASO 3 — Implanta un restaurante (5 minutos, en el local)

1. En tu `/platform` → **«＋ Nuevo restaurante»**: escribes el **nombre** y ya
   está — el usuario y la contraseña **se generan solos** (puedes cambiarlos).
   Eliges el **tipo de negocio** y ves en pantalla los niveles y recompensas que
   incluye de serie.
2. Al crear se abre la ventana **«Entregar»** con los dos QR y sus claves.
   Botón **«🖨 Imprimir hoja de entrega»**: una hoja lista con los QR, las
   claves y los 5 pasos de puesta en marcha para dejársela al dueño.
3. En el local: escanean el QR del panel con su tablet, entran, y un
   **asistente de 1 minuto** les pide nombre, color y moneda. Ya funcionan.
4. El QR de clientes se imprime y se pone en mesas o mostrador.

**Uso diario del restaurante (5 segundos por cuenta):** en el Panel está el
**«⚡ Cobro rápido»**: teléfono del cliente + importe → Enter. Si el cliente no
existe, el propio recuadro pide solo el nombre y lo crea y cobra en el mismo
paso. Puntos, niveles,
ranking y premios van solos. Todo lo demás (colores, textos, XP, **niveles y
recompensas con su nivel requerido**) lo cambian desde su panel → *Programa*
y **se guarda solo y se ve al instante** en la pantalla de sus clientes.

## PASO 4 — Cobra

**Manual (desde el día 1, sin configurar nada):** te pagan por transferencia o
efectivo → en su tarjeta pulsas **«Cobro» → «Marcar pagado +30 días»**. Si se
pasa la fecha + días de gracia, Fidelia lo **suspende sola** (sin borrar nada)
y lo **reactiva sola** cuando registres el siguiente pago.

**Automático (Stripe):** `/platform → Facturación` → pega tu clave `sk_live_…`,
fija el precio y configura el webhook con la URL que te muestra (eventos:
`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.deleted`). Después, por restaurante: **«Cobro» →
«Generar enlace de suscripción»** → se lo envías → paga con tarjeta → Stripe le
cobra cada mes y Fidelia mantiene su acceso al día sin que tú toques nada.

## ¿Cuánto cobrar? (orientación para España)

| Concepto | Rango recomendado | Nota |
|---|---|---|
| **Cuota mensual** | **29–49 €/mes** por restaurante | 29 € entra sin fricción; 39–49 € si incluyes soporte cercano. Los competidores tipo app de fidelización cobran 40–100 €/mes. |
| **Alta / implantación** | 0–150 € (única) | Gratis para cerrar rápido, o cóbrala si vas al local a dejarlo montado e imprimir cartelería. |
| **Anual** | 290–490 €/año (2 meses gratis) | Mejora tu caja y reduce bajas. |

Con solo **10 restaurantes a 29 €** son **290 €/mes** por un servidor que te
cuesta ~7–15 €/mes en Render. A 25 clientes ya superas los 700 €/mes.

## Seguridad y datos (lo que puedes prometer)

- Nada se borra nunca: suspender solo bloquea; todo vuelve al reactivar.
- Contraseñas siempre **cifradas** (PBKDF2), sesiones y datos aislados por
  restaurante; probado con batería de tests de aislamiento.
- **Copias automáticas** diarias + al crear restaurantes (30 retenidas), copia
  manual descargable y **restauración desde el propio panel** (sube el .db;
  antes de restaurar se guarda otra copia del estado actual).
- Webhook de Stripe verificado por firma HMAC; tu clave nunca se re-muestra.

## Ficha técnica

- 100% biblioteca estándar de Python (3.9–3.14). Sin dependencias.
- `python fidelia.py` · `.exe` con `build_exe.bat` · nube con `Dockerfile`
  (datos en `/data`, variable `FIDELIA_DB`).
- PWA instalable con nombre y color de **cada** restaurante (manifiesto dinámico).
- Backend `http.server` + SQLite (WAL); multi-tenant con verificación de
  pertenencia en cada operación; QR offline (lib MIT empaquetada).
