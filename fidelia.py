"""
Fidelia — Plataforma de fidelización multi-restaurante.

Un solo servidor aloja TODOS los restaurantes. Cada restaurante tiene:
  - Su propia URL:       /r/<nombre>/         (clientes)   /r/<nombre>/admin  (personal)
  - Sus propios usuarios administradores (independientes de los demás)
  - Sus propios clientes, puntos, historial y recompensas (aislados)
  - Su propia configuración (marca, colores, XP, niveles, recompensas, textos),
    editable en tiempo real desde su panel.

Tú (propietario de la plataforma) gestionas los restaurantes desde /platform:
crear, renombrar, suspender/reactivar y restablecer contraseñas. Los datos
NUNCA se borran: suspender un restaurante solo bloquea el acceso.

100% biblioteca estándar de Python (3.9+, incluido 3.14). Sin dependencias.

Ejecutar:   python fidelia.py
Propietario inicial de la plataforma:  admin / admin  (cámbialo al entrar)
"""

import os
import re
import sys
import json
import time
import gzip
import hmac
import sqlite3
import hashlib
import urllib.parse
import urllib.request
import secrets
import threading
import unicodedata
from datetime import datetime, timezone, timedelta
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qsl


# --------------------------------------------------------------------------- #
#  Rutas (compatibles con PyInstaller)                                        #
# --------------------------------------------------------------------------- #
def resource_dir():
    if getattr(sys, "_MEIPASS", None):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def data_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


BASE_DIR = resource_dir()
STATIC_DIR = os.path.join(BASE_DIR, "static")

DB_PATH = os.path.abspath(os.environ.get("FIDELIA_DB") or os.path.join(data_dir(), "fidelia.db"))
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

BACKUP_DIR = os.path.join(os.path.dirname(DB_PATH), "backups")
os.makedirs(BACKUP_DIR, exist_ok=True)
BACKUP_KEEP = 30
BACKUP_EVERY_HOURS = 24

TENANT_COOKIE = "fidelia_session"      # sesión del personal de un restaurante
PLATFORM_COOKIE = "fidelia_platform"   # sesión del propietario de la plataforma
SESSION_TTL_DAYS = 14
PBKDF2_ITERATIONS = 200_000


# --------------------------------------------------------------------------- #
#  Configuración por defecto de CADA restaurante                              #
# --------------------------------------------------------------------------- #
DEFAULT_CONFIG = {
    "setup_done": False,
    "business": {
        "name": "Mi Restaurante",
        "tagline": "Cada visita suma. Cada cliente cuenta.",
        "logo_data": "",
        "currency_symbol": "€",
        "locale": "es-ES",
    },
    "theme": {"primary": "#6d3b5e", "accent": "#e0a021", "mode": "light", "font": "Inter"},
    "earning": {
        "xp_per_currency": 1.0, "xp_per_visit": 5, "signup_bonus": 50,
        "round_mode": "floor", "birthday_bonus": 100,
    },
    "levels": [
        {"id": 1, "name": "Bronce",  "min_xp": 0,    "color": "#b08d57", "perk": "Bienvenido al club."},
        {"id": 2, "name": "Plata",   "min_xp": 300,  "color": "#9aa4ad", "perk": "Aperitivo de cortesía en cada visita."},
        {"id": 3, "name": "Oro",     "min_xp": 800,  "color": "#e0a021", "perk": "Postre gratis en tu cumpleaños."},
        {"id": 4, "name": "Platino", "min_xp": 2000, "color": "#6d3b5e", "perk": "10% en carta y mesa prioritaria."},
    ],
    "rewards": [
        {"id": 1, "name": "Café o chupito",     "type": "xp", "cost_xp": 80,   "min_level": 1, "stock": -1, "active": True, "desc": "Al terminar tu comida."},
        {"id": 2, "name": "Postre casero",      "type": "xp", "cost_xp": 250,  "min_level": 1, "stock": -1, "active": True, "desc": "Elige entre los postres del día."},
        {"id": 3, "name": "Entrante a elegir",  "type": "xp", "cost_xp": 350,  "min_level": 2, "stock": -1, "active": True, "desc": "Cualquier entrante de la carta."},
        {"id": 4, "name": "Botella de vino",    "type": "xp", "cost_xp": 600,  "min_level": 2, "stock": 20, "active": True, "desc": "Vino de la casa para tu mesa."},
        {"id": 5, "name": "10% en tu cuenta",   "type": "xp", "cost_xp": 800,  "min_level": 3, "stock": -1, "active": True, "desc": "Descuento aplicado a la cuenta de hoy."},
        {"id": 6, "name": "Menú para dos",      "type": "xp", "cost_xp": 1800, "min_level": 4, "stock": -1, "active": True, "desc": "Menú degustación para dos personas."},
    ],
    "features": {
        "public_ranking": True, "leaderboard_names": "first_initial",
        "ranking_period": "month",   # month (recomendado: se renueva cada mes) | alltime
        "self_lookup": True, "require_phone": True,
    },
    "texts": {
        "welcome": "Bienvenido a nuestro club de fidelidad. Consulta tus puntos y canjea recompensas.",
        "ranking_title": "Ranking de clientes",
        "lookup_help": "Introduce tu teléfono para ver tus puntos.",
    },
}

# --------------------------------------------------------------------------- #
#  Plantillas sugeridas (niveles + recompensas listos para usar)              #
#  Base: 1 XP ≈ 1 € gastado + 5 XP por visita.                                #
# --------------------------------------------------------------------------- #
SUGGESTED_TEMPLATES = {
    "restaurante": {
        "label": "Restaurante",
        "desc": "Ticket medio 20–40 €. Recompensas de sala clásicas.",
        "levels": [
            {"id": 1, "name": "Bronce",  "min_xp": 0,    "color": "#b08d57", "perk": "Bienvenido al club."},
            {"id": 2, "name": "Plata",   "min_xp": 300,  "color": "#9aa4ad", "perk": "Aperitivo de cortesía en cada visita."},
            {"id": 3, "name": "Oro",     "min_xp": 800,  "color": "#e0a021", "perk": "Postre gratis en tu cumpleaños."},
            {"id": 4, "name": "Platino", "min_xp": 2000, "color": "#6d3b5e", "perk": "10% en carta y mesa prioritaria."},
        ],
        "rewards": [
            {"id": 1, "name": "Café o chupito",    "type": "xp", "cost_xp": 80,   "min_level": 1, "stock": -1, "active": True, "desc": "Al terminar tu comida."},
            {"id": 2, "name": "Postre casero",     "type": "xp", "cost_xp": 250,  "min_level": 1, "stock": -1, "active": True, "desc": "Elige entre los postres del día."},
            {"id": 3, "name": "Entrante a elegir", "type": "xp", "cost_xp": 350,  "min_level": 2, "stock": -1, "active": True, "desc": "Cualquier entrante de la carta."},
            {"id": 4, "name": "Botella de vino",   "type": "xp", "cost_xp": 600,  "min_level": 2, "stock": 20, "active": True, "desc": "Vino de la casa para tu mesa."},
            {"id": 5, "name": "10% en tu cuenta",  "type": "xp", "cost_xp": 800,  "min_level": 3, "stock": -1, "active": True, "desc": "Descuento aplicado a la cuenta de hoy."},
            {"id": 6, "name": "Menú para dos",     "type": "xp", "cost_xp": 1800, "min_level": 4, "stock": -1, "active": True, "desc": "Menú degustación para dos personas."},
        ],
    },
    "cafeteria": {
        "label": "Cafetería / Brunch",
        "desc": "Ticket medio 5–15 €. Visitas frecuentes, premios pequeños.",
        "levels": [
            {"id": 1, "name": "Bronce",  "min_xp": 0,    "color": "#b08d57", "perk": "Bienvenido al club."},
            {"id": 2, "name": "Plata",   "min_xp": 250,  "color": "#9aa4ad", "perk": "Ración extra de bollería a mitad de precio."},
            {"id": 3, "name": "Oro",     "min_xp": 600,  "color": "#e0a021", "perk": "Desayuno gratis en tu cumpleaños."},
            {"id": 4, "name": "Platino", "min_xp": 1500, "color": "#6d3b5e", "perk": "10% siempre y sin colas: pide por adelantado."},
        ],
        "rewards": [
            {"id": 1, "name": "Café gratis",         "type": "xp", "cost_xp": 100,  "min_level": 1, "stock": -1, "active": True, "desc": "Solo, con leche o americano."},
            {"id": 2, "name": "Pieza de bollería",   "type": "xp", "cost_xp": 150,  "min_level": 1, "stock": -1, "active": True, "desc": "Croissant, napolitana o similar."},
            {"id": 3, "name": "Desayuno completo",   "type": "xp", "cost_xp": 350,  "min_level": 2, "stock": -1, "active": True, "desc": "Café + tostada o bollería + zumo."},
            {"id": 4, "name": "Merienda para dos",   "type": "xp", "cost_xp": 600,  "min_level": 3, "stock": -1, "active": True, "desc": "Dos bebidas y dos dulces."},
            {"id": 5, "name": "Bolsa de café 250 g", "type": "xp", "cost_xp": 1000, "min_level": 3, "stock": 15, "active": True, "desc": "Nuestro café para llevar a casa."},
        ],
    },
    "bar": {
        "label": "Bar de tapas",
        "desc": "Ticket medio 10–25 €. Rotación alta, premios ágiles.",
        "levels": [
            {"id": 1, "name": "Bronce",  "min_xp": 0,    "color": "#b08d57", "perk": "Bienvenido al club."},
            {"id": 2, "name": "Plata",   "min_xp": 200,  "color": "#9aa4ad", "perk": "Tapa de la casa con la primera ronda."},
            {"id": 3, "name": "Oro",     "min_xp": 500,  "color": "#e0a021", "perk": "Ración sorpresa en tu cumpleaños."},
            {"id": 4, "name": "Platino", "min_xp": 1200, "color": "#6d3b5e", "perk": "Reserva prioritaria y 10% en raciones."},
        ],
        "rewards": [
            {"id": 1, "name": "Caña o refresco",   "type": "xp", "cost_xp": 60,   "min_level": 1, "stock": -1, "active": True, "desc": "Una bebida por la cara."},
            {"id": 2, "name": "Tapa especial",     "type": "xp", "cost_xp": 150,  "min_level": 1, "stock": -1, "active": True, "desc": "La tapa estrella del día."},
            {"id": 3, "name": "Ración a elegir",   "type": "xp", "cost_xp": 300,  "min_level": 2, "stock": -1, "active": True, "desc": "Cualquier ración de la pizarra."},
            {"id": 4, "name": "Ronda de 4 cañas",  "type": "xp", "cost_xp": 400,  "min_level": 2, "stock": -1, "active": True, "desc": "Para ti y tu cuadrilla."},
            {"id": 5, "name": "Botella de vino",   "type": "xp", "cost_xp": 550,  "min_level": 3, "stock": 20, "active": True, "desc": "Tinto o blanco de la casa."},
            {"id": 6, "name": "Picoteo para 4",    "type": "xp", "cost_xp": 900,  "min_level": 3, "stock": -1, "active": True, "desc": "Surtido de raciones para la mesa."},
        ],
    },
}


# --------------------------------------------------------------------------- #
#  Base de datos                                                              #
# --------------------------------------------------------------------------- #
@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS platform_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS platform_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS tenants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                config TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (tenant_id, username),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                kind TEXT NOT NULL,            -- 'platform' | 'tenant'
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                phone TEXT,
                email TEXT,
                birthday TEXT,
                xp INTEGER NOT NULL DEFAULT 0,
                visits INTEGER NOT NULL DEFAULT 0,
                total_spent REAL NOT NULL DEFAULT 0,
                notes TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                UNIQUE (tenant_id, code),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
            CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone);
            CREATE INDEX IF NOT EXISTS idx_customers_xp ON customers(tenant_id, xp);
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                amount REAL DEFAULT 0,
                xp_delta INTEGER NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_tx_customer ON transactions(customer_id);
            CREATE TABLE IF NOT EXISTS redemptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                reward_id INTEGER,
                reward_name TEXT NOT NULL,
                cost_xp INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            );
            """
        )
        cols = [r["name"] for r in db.execute("PRAGMA table_info(tenants)").fetchall()]
        if "billing" not in cols:
            db.execute("ALTER TABLE tenants ADD COLUMN billing TEXT")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                method TEXT NOT NULL,          -- 'manual' | 'stripe'
                note TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
        """)
        ccols = [r["name"] for r in db.execute("PRAGMA table_info(customers)").fetchall()]
        if "nickname" not in ccols:
            db.execute("ALTER TABLE customers ADD COLUMN nickname TEXT")
        if db.execute("SELECT COUNT(*) c FROM platform_users").fetchone()["c"] == 0:
            db.execute("INSERT INTO platform_users (username, password_hash, created_at) VALUES (?,?,?)",
                       ("admin", hash_password("admin"), now_iso()))


# --------------------------------------------------------------------------- #
#  Copias de seguridad (los datos nunca se pierden)                           #
# --------------------------------------------------------------------------- #
def make_backup(reason="auto"):
    if not os.path.isfile(DB_PATH):
        return None
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(BACKUP_DIR, f"fidelia-{ts}-{reason}.db")
    src = sqlite3.connect(DB_PATH, timeout=30)
    dst = sqlite3.connect(dest)
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close()
        src.close()
    _prune_backups()
    return dest


def _prune_backups(keep=BACKUP_KEEP):
    try:
        files = sorted((f for f in os.listdir(BACKUP_DIR)
                        if f.startswith("fidelia-") and f.endswith(".db")), reverse=True)
        for old in files[keep:]:
            try:
                os.remove(os.path.join(BACKUP_DIR, old))
            except OSError:
                pass
    except FileNotFoundError:
        pass


def last_backup_info():
    try:
        files = [f for f in os.listdir(BACKUP_DIR) if f.startswith("fidelia-") and f.endswith(".db")]
    except FileNotFoundError:
        files = []
    if not files:
        return None, 0
    files.sort(reverse=True)
    path = os.path.join(BACKUP_DIR, files[0])
    return path, os.path.getmtime(path)


def backup_if_stale(min_hours=12):
    _, mtime = last_backup_info()
    if time.time() - mtime > min_hours * 3600:
        try:
            make_backup("startup")
        except Exception as e:
            print(f"  [aviso] no se pudo crear copia inicial: {e}")



# --------------------------------------------------------------------------- #
#  Facturación: suscripciones Stripe + modo manual + suspensión por impago    #
#  (100%% biblioteca estándar: urllib para la API, hmac para el webhook)      #
# --------------------------------------------------------------------------- #
STRIPE_API = os.environ.get("FIDELIA_STRIPE_API", "https://api.stripe.com")

BILLING_DEFAULT = {
    "enabled": False,          # cobro activo para este restaurante
    "status": "none",          # none | active | past_due | canceled | suspended
    "paid_until": None,        # ISO: pagado hasta esta fecha
    "customer": None,          # id de cliente en Stripe
    "subscription": None,      # id de suscripción en Stripe
    "by_billing": False,       # True si la suspensión la hizo el cobro automático
}


def get_setting(key, default=None):
    with get_db() as db:
        row = db.execute("SELECT value FROM platform_settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row and row["value"] is not None else default


def set_setting(key, value):
    with get_db() as db:
        db.execute("INSERT INTO platform_settings (key, value) VALUES (?,?) "
                   "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))


def load_billing(row_billing):
    b = dict(BILLING_DEFAULT)
    if row_billing:
        try:
            b.update(json.loads(row_billing))
        except Exception:
            pass
    return b


def save_billing(tenant_id, b):
    with get_db() as db:
        db.execute("UPDATE tenants SET billing = ? WHERE id = ?",
                   (json.dumps(b, ensure_ascii=False), tenant_id))


def get_billing(tenant_id):
    with get_db() as db:
        row = db.execute("SELECT billing FROM tenants WHERE id = ?", (tenant_id,)).fetchone()
    if not row:
        raise HttpError(404, "Restaurante no encontrado")
    return load_billing(row["billing"])


def set_tenant_active(tenant_id, active):
    with get_db() as db:
        db.execute("UPDATE tenants SET active = ? WHERE id = ?", (1 if active else 0, tenant_id))


def tenant_price(b):
    """Cuota mensual del restaurante: la suya propia o, si no tiene, la global."""
    own = b.get("price_eur")
    if own not in (None, "", 0):
        return as_float(own, 0.0)
    return as_float(get_setting("price_eur", "29"), 29.0)


def record_payment(tenant_id, amount, method, note=None):
    if amount is None or amount <= 0:
        return
    with get_db() as db:
        db.execute("INSERT INTO payments (tenant_id, amount, method, note, created_at) VALUES (?,?,?,?,?)",
                   (tenant_id, round(float(amount), 2), method, note, now_iso()))


def apply_payment(tenant_id, days=None, paid_until_ts=None):
    """Registra un pago: extiende paid_until y reactiva si estaba suspendido por impago."""
    b = get_billing(tenant_id)
    now = datetime.now(timezone.utc)
    if paid_until_ts:
        new_until = datetime.fromtimestamp(int(paid_until_ts), tz=timezone.utc)
    else:
        base = now
        if b.get("paid_until"):
            try:
                cur = datetime.fromisoformat(b["paid_until"])
                if cur > now:
                    base = cur
            except Exception:
                pass
        new_until = base + timedelta(days=days or 30)
    b["enabled"] = True
    b["status"] = "active"
    b["paid_until"] = new_until.isoformat()
    if b.get("by_billing"):
        set_tenant_active(tenant_id, True)
        b["by_billing"] = False
    save_billing(tenant_id, b)
    return b


def check_billing():
    """Suspende automáticamente los restaurantes con el pago vencido (+ días de gracia).
    Nunca borra nada: solo bloquea el acceso hasta que llegue el pago."""
    grace = as_int(get_setting("grace_days", "3"), 3)
    now = datetime.now(timezone.utc)
    with get_db() as db:
        rows = db.execute("SELECT id, active, billing FROM tenants").fetchall()
    for r in rows:
        b = load_billing(r["billing"])
        if not b.get("enabled") or not b.get("paid_until"):
            continue
        try:
            until = datetime.fromisoformat(b["paid_until"])
        except Exception:
            continue
        expired = now > until + timedelta(days=grace)
        if expired and r["active"]:
            b["status"] = "suspended"
            b["by_billing"] = True
            save_billing(r["id"], b)
            set_tenant_active(r["id"], False)
        elif (not expired) and (not r["active"]) and b.get("by_billing"):
            b["status"] = "active"
            b["by_billing"] = False
            save_billing(r["id"], b)
            set_tenant_active(r["id"], True)


def start_billing_thread():
    def loop():
        while True:
            try:
                check_billing()
                purge_expired_sessions()
            except Exception:
                pass
            time.sleep(3600)
    threading.Thread(target=loop, daemon=True).start()


def stripe_request(method, path, params=None):
    key = get_setting("stripe_secret")
    if not key:
        raise HttpError(400, "Configura primero la clave secreta de Stripe (Facturación)")
    data = urllib.parse.urlencode(params or {}).encode() if params else None
    req = urllib.request.Request(STRIPE_API + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode()).get("error", {}).get("message", str(e))
        except Exception:
            detail = str(e)
        raise HttpError(502, f"Stripe: {detail}")
    except Exception as e:
        raise HttpError(502, f"No se pudo contactar con Stripe: {e}")


def verify_stripe_signature(payload, sig_header, secret, tolerance=300):
    try:
        parts = {}
        for p in sig_header.split(","):
            k, _, v = p.strip().partition("=")
            parts.setdefault(k, v)
        t = int(parts["t"])
        expected = hmac.new(secret.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
        if abs(time.time() - t) > tolerance:
            return False
        return hmac.compare_digest(expected, parts.get("v1", ""))
    except Exception:
        return False


def _tenant_by_subscription(sub_id):
    if not sub_id:
        return None
    with get_db() as db:
        rows = db.execute("SELECT id, billing FROM tenants").fetchall()
    for r in rows:
        if load_billing(r["billing"]).get("subscription") == sub_id:
            return r["id"]
    return None


def process_stripe_event(evt):
    etype = evt.get("type", "")
    obj = (evt.get("data") or {}).get("object") or {}
    if etype == "checkout.session.completed":
        tid = as_int(((obj.get("metadata") or {}).get("tenant_id")))
        if tid:
            b = get_billing(tid)
            b["customer"] = obj.get("customer")
            b["subscription"] = obj.get("subscription")
            save_billing(tid, b)
            apply_payment(tid, days=32)
    elif etype in ("invoice.paid", "invoice.payment_succeeded"):
        sub = obj.get("subscription") or ((obj.get("parent") or {}).get("subscription_details") or {}).get("subscription")
        tid = _tenant_by_subscription(sub)
        if not tid:
            tid = as_int(((obj.get("subscription_details") or {}).get("metadata") or {}).get("tenant_id"))
        if tid:
            period_end = None
            try:
                period_end = obj["lines"]["data"][0]["period"]["end"]
            except Exception:
                pass
            apply_payment(tid, days=32, paid_until_ts=period_end)
            amount = None
            for key in ("amount_paid", "amount_due", "total"):
                if obj.get(key) is not None:
                    amount = as_float(obj.get(key), 0) / 100.0
                    break
            if not amount:
                amount = tenant_price(get_billing(tid))
            record_payment(tid, amount, "stripe", "Suscripción Stripe")
    elif etype == "invoice.payment_failed":
        tid = _tenant_by_subscription(obj.get("subscription"))
        if tid:
            b = get_billing(tid)
            b["status"] = "past_due"
            save_billing(tid, b)
    elif etype == "customer.subscription.deleted":
        tid = _tenant_by_subscription(obj.get("id"))
        if tid:
            b = get_billing(tid)
            b["status"] = "canceled"
            save_billing(tid, b)
    return {"received": True}


def start_backup_thread():
    def loop():
        while True:
            time.sleep(BACKUP_EVERY_HOURS * 3600)
            try:
                make_backup("auto")
            except Exception:
                pass
    threading.Thread(target=loop, daemon=True).start()


# --------------------------------------------------------------------------- #
#  Utilidades                                                                 #
# --------------------------------------------------------------------------- #
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def lan_ip():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


def hash_password(password):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password, stored):
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return secrets.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "restaurante"


def _merge_defaults(defaults, cfg):
    out = dict(cfg)
    for k, v in defaults.items():
        if k not in out:
            out[k] = v
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge_defaults(v, out[k])
    return out


def load_tenant(slug=None, tenant_id=None):
    with get_db() as db:
        if slug is not None:
            row = db.execute("SELECT * FROM tenants WHERE slug = ?", (slug,)).fetchone()
        else:
            row = db.execute("SELECT * FROM tenants WHERE id = ?", (tenant_id,)).fetchone()
    if not row:
        return None
    cfg = _merge_defaults(DEFAULT_CONFIG, json.loads(row["config"]))
    return {"id": row["id"], "slug": row["slug"], "name": row["name"],
            "active": bool(row["active"]), "config": cfg, "created_at": row["created_at"]}


def save_tenant_config(tenant_id, cfg):
    with get_db() as db:
        db.execute("UPDATE tenants SET config = ?, name = ? WHERE id = ?",
                   (json.dumps(cfg, ensure_ascii=False), cfg["business"]["name"], tenant_id))


def level_for_xp(xp, levels):
    if not levels:
        return None, None
    ordered = sorted(levels, key=lambda l: l.get("min_xp", 0))
    current = ordered[0]
    for lv in ordered:
        if xp >= lv.get("min_xp", 0):
            current = lv
        else:
            break
    higher = [l for l in ordered if l.get("min_xp", 0) > current.get("min_xp", 0)]
    return current, (higher[0] if higher else None)


NICK_RE = re.compile(r"^[\w\sáéíóúüñÁÉÍÓÚÜÑ.\-]{2,20}$", re.UNICODE)


def validate_nickname(db, tenant_id, nickname, exclude_customer_id=None):
    """Devuelve el apodo limpio o lanza error. Único por restaurante (sin mayúsculas)."""
    nickname = (nickname or "").strip()
    if not nickname:
        return None
    if not NICK_RE.match(nickname):
        raise HttpError(400, "Apodo no válido: 2–20 caracteres (letras, números, espacios, . o -)")
    q = "SELECT id FROM customers WHERE tenant_id = ? AND LOWER(nickname) = LOWER(?)"
    args = [tenant_id, nickname]
    if exclude_customer_id:
        q += " AND id != ?"
        args.append(exclude_customer_id)
    if db.execute(q, args).fetchone():
        raise HttpError(409, "Ese apodo ya está cogido en este restaurante. Prueba otro.")
    return nickname


def gen_customer_code(db, tenant_id):
    for _ in range(30):
        code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
        if not db.execute("SELECT 1 FROM customers WHERE tenant_id = ? AND code = ?",
                          (tenant_id, code)).fetchone():
            return code
    return secrets.token_hex(4).upper()


def customer_public(row, cfg):
    levels = cfg["levels"]
    current, nxt = level_for_xp(row["xp"], levels)
    progress = None
    if current and nxt:
        span = nxt["min_xp"] - current["min_xp"]
        done = row["xp"] - current["min_xp"]
        progress = round(100 * done / span) if span > 0 else 100
    return {
        "id": row["id"], "code": row["code"], "name": row["name"], "phone": row["phone"],
        "nickname": row["nickname"] if "nickname" in row.keys() else None,
        "email": row["email"], "birthday": row["birthday"], "xp": row["xp"],
        "visits": row["visits"], "total_spent": row["total_spent"], "notes": row["notes"],
        "active": bool(row["active"]), "created_at": row["created_at"],
        "level": current, "next_level": nxt,
        "xp_to_next": (nxt["min_xp"] - row["xp"]) if nxt else 0, "progress_pct": progress,
    }


# --------------------------------------------------------------------------- #
#  Rate limiting                                                              #
# --------------------------------------------------------------------------- #
_rl_lock = threading.Lock()
_rl_store = {}


def rate_limit(key, limit, window_s):
    now = time.time()
    with _rl_lock:
        hits = [t for t in _rl_store.get(key, []) if now - t < window_s]
        if len(hits) >= limit:
            _rl_store[key] = hits
            return False
        hits.append(now)
        _rl_store[key] = hits
        return True


# --------------------------------------------------------------------------- #
#  Sesiones                                                                   #
# --------------------------------------------------------------------------- #
MAX_SESSIONS_PER_USER = 10


def create_session(kind, user_id):
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    with get_db() as db:
        db.execute("INSERT INTO sessions (token, kind, user_id, created_at, expires_at) VALUES (?,?,?,?,?)",
                   (token, kind, user_id, now_iso(), expires.isoformat()))
        # tope de sesiones vivas por usuario: las más antiguas caducan solas
        db.execute("""DELETE FROM sessions WHERE kind = ? AND user_id = ? AND token NOT IN (
                        SELECT token FROM sessions WHERE kind = ? AND user_id = ?
                        ORDER BY created_at DESC LIMIT ?)""",
                   (kind, user_id, kind, user_id, MAX_SESSIONS_PER_USER))
    return token


def purge_expired_sessions():
    with get_db() as db:
        db.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso(),))


def session_user(token, kind):
    if not token:
        return None
    with get_db() as db:
        row = db.execute("SELECT * FROM sessions WHERE token = ? AND kind = ?", (token, kind)).fetchone()
        if not row:
            return None
        if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
            db.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return None
        if kind == "platform":
            u = db.execute("SELECT id, username FROM platform_users WHERE id = ?", (row["user_id"],)).fetchone()
            return {"id": u["id"], "username": u["username"]} if u else None
        u = db.execute("SELECT id, username, tenant_id FROM admin_users WHERE id = ?", (row["user_id"],)).fetchone()
        return {"id": u["id"], "username": u["username"], "tenant_id": u["tenant_id"]} if u else None


def delete_session(token):
    if token:
        with get_db() as db:
            db.execute("DELETE FROM sessions WHERE token = ?", (token,))


# --------------------------------------------------------------------------- #
#  Errores y contexto                                                         #
# --------------------------------------------------------------------------- #
class HttpError(Exception):
    def __init__(self, status, detail):
        self.status = status
        self.detail = detail


class Ctx:
    def __init__(self, params, body, query, user, ip, tenant=None, token=None):
        self.params = params
        self.body = body or {}
        self.query = query or {}
        self.user = user
        self.ip = ip
        self.tenant = tenant
        self.token = token
        self.new_cookie = None       # (nombre, token)
        self.clear_cookie = None     # nombre


def need(body, key, msg=None):
    v = body.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        raise HttpError(400, msg or f"Falta el campo «{key}»")
    return v


def as_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def as_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


# =========================================================================== #
#  HANDLERS — PLATAFORMA (propietario)                                        #
# =========================================================================== #
def p_login(ctx):
    username_key = str(ctx.body.get("username") or "")[:40].lower()
    if not rate_limit(f"plogin:{ctx.ip}:{username_key}", 8, 300):
        raise HttpError(429, "Demasiados intentos. Espera unos minutos.")
    username = str(need(ctx.body, "username")).strip()
    password = need(ctx.body, "password")
    with get_db() as db:
        row = db.execute("SELECT id, password_hash FROM platform_users WHERE username = ?", (username,)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        raise HttpError(401, "Usuario o contraseña incorrectos")
    ctx.new_cookie = (PLATFORM_COOKIE, create_session("platform", row["id"]))
    return {"ok": True, "username": username}


def p_logout(ctx):
    delete_session(ctx.token)
    ctx.clear_cookie = PLATFORM_COOKIE
    return {"ok": True}


def p_me(ctx):
    return ctx.user


def p_password(ctx):
    cur = need(ctx.body, "current_password")
    new = need(ctx.body, "new_password")
    if len(new) < 8:
        raise HttpError(400, "La nueva contraseña debe tener al menos 8 caracteres")
    with get_db() as db:
        row = db.execute("SELECT password_hash FROM platform_users WHERE id = ?", (ctx.user["id"],)).fetchone()
        if not verify_password(cur, row["password_hash"]):
            raise HttpError(400, "La contraseña actual no es correcta")
        db.execute("UPDATE platform_users SET password_hash = ? WHERE id = ?",
                   (hash_password(new), ctx.user["id"]))
    return {"ok": True}


def p_templates(ctx):
    return {"templates": [{"key": k, "label": v["label"], "desc": v["desc"],
                           "levels": v["levels"], "rewards": v["rewards"]}
                          for k, v in SUGGESTED_TEMPLATES.items()]}


def _pay_state(b):
    """paid = al día · unpaid = vencido/suspendido/pendiente · none = sin cobro configurado."""
    if not b.get("enabled"):
        return "none"
    today = datetime.now(timezone.utc).date().isoformat()
    if b.get("paid_until"):
        return "paid" if b["paid_until"] >= today else "unpaid"
    return "paid" if b.get("status") == "active" else "unpaid"


def p_list_tenants(ctx):
    with get_db() as db:
        rows = db.execute("SELECT * FROM tenants ORDER BY created_at DESC").fetchall()
        counts = {r["tenant_id"]: r["c"] for r in
                  db.execute("SELECT tenant_id, COUNT(*) c FROM customers GROUP BY tenant_id").fetchall()}
        admins = {}
        for r in db.execute("SELECT tenant_id, username FROM admin_users ORDER BY id").fetchall():
            admins.setdefault(r["tenant_id"], []).append(r["username"])
        revenue = {r["tenant_id"]: r["s"] for r in
                   db.execute("SELECT tenant_id, COALESCE(SUM(amount),0) s FROM payments GROUP BY tenant_id").fetchall()}
    out = []
    for r in rows:
        cfg = _merge_defaults(DEFAULT_CONFIG, json.loads(r["config"]))
        b = load_billing(r["billing"])
        out.append({
            "id": r["id"], "slug": r["slug"], "name": r["name"], "active": bool(r["active"]),
            "created_at": r["created_at"], "customers": counts.get(r["id"], 0),
            "admins": admins.get(r["id"], []),
            "primary": cfg["theme"]["primary"], "setup_done": cfg.get("setup_done", False),
            "billing": {"enabled": b["enabled"], "status": b["status"], "paid_until": b["paid_until"]},
            "pay_state": _pay_state(b),
            "price": tenant_price(b),
            "revenue_total": round(revenue.get(r["id"], 0), 2),
        })
    out.sort(key=lambda t: (-t["customers"], t["created_at"]))
    return {"tenants": out}


def p_create_tenant(ctx):
    b = ctx.body
    name = str(need(b, "name", "Pon el nombre del restaurante")).strip()
    admin_user = str(need(b, "admin_user", "Pon el usuario del restaurante")).strip()
    admin_password = str(need(b, "admin_password", "Pon la contraseña del restaurante"))
    if len(admin_password) < 4:
        raise HttpError(400, "La contraseña debe tener al menos 4 caracteres")
    template = b.get("template") or "restaurante"

    base_slug = slugify(b.get("slug") or name)
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    cfg["business"]["name"] = name
    tpl = SUGGESTED_TEMPLATES.get(template)
    if tpl:
        cfg["levels"] = json.loads(json.dumps(tpl["levels"]))
        cfg["rewards"] = json.loads(json.dumps(tpl["rewards"]))

    with get_db() as db:
        slug = base_slug
        n = 2
        while db.execute("SELECT 1 FROM tenants WHERE slug = ?", (slug,)).fetchone():
            slug = f"{base_slug}-{n}"
            n += 1
        cur = db.execute("INSERT INTO tenants (slug, name, active, config, created_at) VALUES (?,?,?,?,?)",
                         (slug, name, 1, json.dumps(cfg, ensure_ascii=False), now_iso()))
        tid = cur.lastrowid
        db.execute("INSERT INTO admin_users (tenant_id, username, password_hash, created_at) VALUES (?,?,?,?)",
                   (tid, admin_user, hash_password(admin_password), now_iso()))
    make_backup("tenant-created")
    return {"ok": True, "id": tid, "slug": slug, "name": name,
            "urls": {"admin": f"/r/{slug}/admin", "public": f"/r/{slug}/"}}


def p_update_tenant(ctx):
    tid = as_int(ctx.params["tid"])
    b = ctx.body
    t = load_tenant(tenant_id=tid)
    if not t:
        raise HttpError(404, "Restaurante no encontrado")
    with get_db() as db:
        if "name" in b and str(b["name"]).strip():
            cfg = t["config"]
            cfg["business"]["name"] = str(b["name"]).strip()
            db.execute("UPDATE tenants SET name = ?, config = ? WHERE id = ?",
                       (cfg["business"]["name"], json.dumps(cfg, ensure_ascii=False), tid))
        if "active" in b:
            db.execute("UPDATE tenants SET active = ? WHERE id = ?", (1 if b["active"] else 0, tid))
            bl_row = db.execute("SELECT billing FROM tenants WHERE id = ?", (tid,)).fetchone()
            bl = load_billing(bl_row["billing"])
            bl["by_billing"] = False   # decisión manual del propietario
            if b["active"] and bl["status"] == "suspended":
                bl["status"] = "active" if bl.get("enabled") else "none"
            db.execute("UPDATE tenants SET billing = ? WHERE id = ?",
                       (json.dumps(bl, ensure_ascii=False), tid))
        if b.get("reset_admin_password"):
            new_pw = str(b["reset_admin_password"])
            if len(new_pw) < 4:
                raise HttpError(400, "La contraseña debe tener al menos 4 caracteres")
            username = b.get("admin_user")
            if username:
                row = db.execute("SELECT id FROM admin_users WHERE tenant_id=? AND username=?",
                                 (tid, username)).fetchone()
            else:
                row = db.execute("SELECT id FROM admin_users WHERE tenant_id=? ORDER BY id LIMIT 1",
                                 (tid,)).fetchone()
            if not row:
                raise HttpError(404, "Ese restaurante no tiene ese usuario")
            db.execute("UPDATE admin_users SET password_hash=? WHERE id=?",
                       (hash_password(new_pw), row["id"]))
            # cerrar sesiones activas de ese usuario
            db.execute("DELETE FROM sessions WHERE kind='tenant' AND user_id=?", (row["id"],))
    return {"ok": True}


def _p_tenant(ctx):
    t = load_tenant(tenant_id=as_int(ctx.params["tid"]))
    if not t:
        raise HttpError(404, "Restaurante no encontrado")
    return t


def p_tenant_customers(ctx):
    t = _p_tenant(ctx)
    data = list_customers_data(t, ctx.query)
    data["tenant"] = {"id": t["id"], "name": t["name"], "slug": t["slug"],
                      "levels": t["config"]["levels"]}
    return data


def p_tenant_adjust(ctx):
    t = _p_tenant(ctx)
    cid = as_int(ctx.params["cid"])
    delta = as_int(ctx.body.get("delta"))
    reason = ctx.body.get("reason") or "Ajuste desde plataforma"
    with get_db() as db:
        row = _tenant_customer(db, t["id"], cid)
        new_xp = max(0, row["xp"] + delta)
        db.execute("UPDATE customers SET xp = ? WHERE id = ?", (new_xp, cid))
        db.execute("INSERT INTO transactions (customer_id, kind, amount, xp_delta, note, created_at) VALUES (?,?,?,?,?,?)",
                   (cid, "adjust", 0, new_xp - row["xp"], reason, now_iso()))
        row = db.execute("SELECT * FROM customers WHERE id = ?", (cid,)).fetchone()
    return customer_public(row, t["config"])


def p_tenant_ban(ctx):
    t = _p_tenant(ctx)
    return set_customer_ban(t, as_int(ctx.params["cid"]), bool(ctx.body.get("banned")))


def p_delete_tenant(ctx):
    """Borrado DEFINITIVO de un restaurante y todos sus datos.
    Exige escribir el nombre exacto y hace copia de seguridad antes."""
    t = _p_tenant(ctx)
    confirm = str(ctx.body.get("confirm_name") or "").strip()
    if confirm.lower() != t["name"].strip().lower():
        raise HttpError(400, "El nombre escrito no coincide. Escríbelo exactamente para confirmar.")
    make_backup("pre-delete")
    with get_db() as db:
        cids = [r["id"] for r in db.execute(
            "SELECT id FROM customers WHERE tenant_id = ?", (t["id"],)).fetchall()]
        if cids:
            marks = ",".join("?" * len(cids))
            db.execute(f"DELETE FROM redemptions WHERE customer_id IN ({marks})", cids)
            db.execute(f"DELETE FROM transactions WHERE customer_id IN ({marks})", cids)
        db.execute("DELETE FROM customers WHERE tenant_id = ?", (t["id"],))
        aids = [r["id"] for r in db.execute(
            "SELECT id FROM admin_users WHERE tenant_id = ?", (t["id"],)).fetchall()]
        if aids:
            marks = ",".join("?" * len(aids))
            db.execute(f"DELETE FROM sessions WHERE kind = 'tenant' AND user_id IN ({marks})", aids)
        db.execute("DELETE FROM admin_users WHERE tenant_id = ?", (t["id"],))
        db.execute("DELETE FROM tenants WHERE id = ?", (t["id"],))
    return {"ok": True, "deleted": t["name"]}


def p_revenue(ctx):
    """Resumen de ingresos del propietario: total, mes actual, MRR y últimos 6 meses."""
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    with get_db() as db:
        total = db.execute("SELECT COALESCE(SUM(amount),0) s FROM payments").fetchone()["s"]
        this_month = db.execute("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE created_at >= ?",
                                (month_start.isoformat(),)).fetchone()["s"]
        rows = db.execute("SELECT amount, created_at FROM payments WHERE created_at >= ?",
                          ((month_start - timedelta(days=185)).isoformat(),)).fetchall()
        tenants = db.execute("SELECT id, active, billing FROM tenants").fetchall()
    months = []
    y, m = now.year, now.month
    for _ in range(6):
        months.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    per = {f"{yy:04d}-{mm:02d}": 0.0 for yy, mm in months}
    for r in rows:
        key = r["created_at"][:7]
        if key in per:
            per[key] += r["amount"]
    series = [{"label": f"{MONTHS_ES[mm-1][:3]} {str(yy)[2:]}", "total": round(per[f"{yy:04d}-{mm:02d}"], 2)}
              for yy, mm in reversed(months)]
    mrr = 0.0
    paying = 0
    for t in tenants:
        b = load_billing(t["billing"])
        if _pay_state(b) == "paid":
            mrr += tenant_price(b)
            paying += 1
    return {"total": round(total, 2), "this_month": round(this_month, 2),
            "mrr": round(mrr, 2), "paying_tenants": paying, "months": series}


def p_info(ctx):
    last_path, last_mtime = last_backup_info()
    with get_db() as db:
        tenants = db.execute("SELECT COUNT(*) c FROM tenants").fetchone()["c"]
        customers = db.execute("SELECT COUNT(*) c FROM customers").fetchone()["c"]
    return {
        "db_path": DB_PATH, "backup_dir": BACKUP_DIR,
        "last_backup": (datetime.fromtimestamp(last_mtime).isoformat() if last_mtime else None),
        "backups_kept": BACKUP_KEEP, "tenants": tenants, "customers": customers,
        "lan_ip": lan_ip(), "port": int(os.environ.get("FIDELIA_PORT") or os.environ.get("PORT") or "8000"),
    }


def p_billing_settings_get(ctx):
    sk = get_setting("stripe_secret", "")
    return {
        "stripe_secret_set": bool(sk),
        "stripe_secret_hint": (sk[:7] + "…" + sk[-4:]) if len(sk) > 12 else ("configurada" if sk else ""),
        "webhook_secret_set": bool(get_setting("stripe_webhook_secret")),
        "public_url": get_setting("public_url", ""),
        "price_eur": get_setting("price_eur", "29"),
        "grace_days": get_setting("grace_days", "3"),
        "webhook_path": "/api/stripe/webhook",
    }


def p_billing_settings_post(ctx):
    b = ctx.body
    for key in ("stripe_secret", "stripe_webhook_secret", "public_url", "price_eur", "grace_days"):
        if key in b and b[key] is not None:
            val = str(b[key]).strip()
            if val or key in ("public_url",):
                set_setting(key, val)
    return p_billing_settings_get(ctx)


def p_billing_get(ctx):
    tid = as_int(ctx.params["tid"])
    t = load_tenant(tenant_id=tid)
    if not t:
        raise HttpError(404, "Restaurante no encontrado")
    b = get_billing(tid)
    with get_db() as db:
        pays = db.execute("SELECT amount, method, note, created_at FROM payments "
                          "WHERE tenant_id = ? ORDER BY id DESC LIMIT 24", (tid,)).fetchall()
        total = db.execute("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE tenant_id = ?",
                           (tid,)).fetchone()["s"]
    return {"billing": b, "active": t["active"],
            "grace_days": as_int(get_setting("grace_days", "3"), 3),
            "price": tenant_price(b), "own_price": b.get("price_eur"),
            "revenue_total": round(total, 2),
            "payments": [dict(x) for x in pays]}


def p_billing_enable(ctx):
    tid = as_int(ctx.params["tid"])
    b = get_billing(tid)
    b["enabled"] = bool(ctx.body.get("enabled"))
    if not b["enabled"]:
        # al desactivar el cobro, si estaba suspendido por impago, se reactiva
        if b.get("by_billing"):
            set_tenant_active(tid, True)
            b["by_billing"] = False
        b["status"] = "none"
    save_billing(tid, b)
    return {"billing": b}


def p_billing_mark_paid(ctx):
    tid = as_int(ctx.params["tid"])
    days = max(1, as_int(ctx.body.get("days"), 30))
    b = get_billing(tid)
    amount = as_float(ctx.body.get("amount"), 0) or tenant_price(b)
    result = apply_payment(tid, days=days)
    record_payment(tid, amount, "manual", f"Pago manual (+{days} días)")
    return {"billing": result}


def p_billing_price(ctx):
    """Fija la cuota mensual propia de este restaurante (vacío = usar la global)."""
    tid = as_int(ctx.params["tid"])
    b = get_billing(tid)
    raw = ctx.body.get("price_eur")
    if raw in (None, "", 0, "0"):
        b.pop("price_eur", None)
    else:
        val = as_float(raw, -1)
        if val <= 0:
            raise HttpError(400, "Pon una cuota válida en euros")
        b["price_eur"] = round(val, 2)
    save_billing(tid, b)
    return {"billing": b, "price": tenant_price(b)}


def p_billing_checkout(ctx):
    tid = as_int(ctx.params["tid"])
    t = load_tenant(tenant_id=tid)
    if not t:
        raise HttpError(404, "Restaurante no encontrado")
    price = tenant_price(get_billing(tid))
    if price <= 0:
        raise HttpError(400, "Configura un precio mensual válido en Facturación")
    public = (get_setting("public_url", "") or "http://localhost:8000").rstrip("/")
    session = stripe_request("POST", "/v1/checkout/sessions", {
        "mode": "subscription",
        # Tarjeta + domiciliación bancaria SEPA (recibo): el restaurante elige.
        "payment_method_types[0]": "card",
        "payment_method_types[1]": "sepa_debit",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": int(round(price * 100)),
        "line_items[0][price_data][recurring][interval]": "month",
        "line_items[0][price_data][product_data][name]": f"Fidelia · {t['name']}",
        "line_items[0][quantity]": "1",
        "metadata[tenant_id]": str(tid),
        "subscription_data[metadata][tenant_id]": str(tid),
        "success_url": public + "/pago-ok",
        "cancel_url": public + "/pago-ok?cancel=1",
    })
    b = get_billing(tid)
    b["enabled"] = True
    save_billing(tid, b)
    return {"url": session.get("url"), "id": session.get("id")}


# =========================================================================== #
#  HANDLERS — RESTAURANTE (por tenant)                                        #
# =========================================================================== #
def t_login(ctx):
    username_key = str(ctx.body.get("username") or "")[:40].lower()
    if not rate_limit(f"tlogin:{ctx.tenant['id']}:{ctx.ip}:{username_key}", 8, 300):
        raise HttpError(429, "Demasiados intentos. Espera unos minutos.")
    username = str(need(ctx.body, "username")).strip()
    password = need(ctx.body, "password")
    with get_db() as db:
        row = db.execute("SELECT id, password_hash FROM admin_users WHERE tenant_id = ? AND username = ?",
                         (ctx.tenant["id"], username)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        raise HttpError(401, "Usuario o contraseña incorrectos")
    ctx.new_cookie = (TENANT_COOKIE, create_session("tenant", row["id"]))
    return {"ok": True, "username": username}


def t_logout(ctx):
    delete_session(ctx.token)
    ctx.clear_cookie = TENANT_COOKIE
    return {"ok": True}


def t_me(ctx):
    return {"id": ctx.user["id"], "username": ctx.user["username"]}


def t_password(ctx):
    cur = need(ctx.body, "current_password")
    new = need(ctx.body, "new_password")
    if len(new) < 8:
        raise HttpError(400, "La nueva contraseña debe tener al menos 8 caracteres")
    with get_db() as db:
        row = db.execute("SELECT password_hash FROM admin_users WHERE id = ?", (ctx.user["id"],)).fetchone()
        if not verify_password(cur, row["password_hash"]):
            raise HttpError(400, "La contraseña actual no es correcta")
        db.execute("UPDATE admin_users SET password_hash = ? WHERE id = ?",
                   (hash_password(new), ctx.user["id"]))
    return {"ok": True}


def t_get_config(ctx):
    return ctx.tenant["config"]


def t_put_config(ctx):
    payload = ctx.body
    cfg = ctx.tenant["config"]
    for section in ["business", "theme", "earning", "features", "texts"]:
        if isinstance(payload.get(section), dict):
            cfg[section].update(payload[section])
    for section in ["levels", "rewards"]:
        if isinstance(payload.get(section), list):
            cfg[section] = payload[section]
    for i, lv in enumerate(cfg["levels"], start=1):
        lv["id"] = i
        lv["min_xp"] = as_int(lv.get("min_xp", 0))
    if "setup_done" in payload:
        cfg["setup_done"] = bool(payload["setup_done"])
    save_tenant_config(ctx.tenant["id"], cfg)
    return cfg


def t_templates(ctx):
    return {"templates": [{"key": k, "label": v["label"], "desc": v["desc"],
                           "levels": v["levels"], "rewards": v["rewards"]}
                          for k, v in SUGGESTED_TEMPLATES.items()]}


def t_apply_template(ctx):
    key = str(need(ctx.body, "template"))
    what = ctx.body.get("what", "both")
    tpl = SUGGESTED_TEMPLATES.get(key)
    if not tpl:
        raise HttpError(404, "Plantilla no encontrada")
    cfg = ctx.tenant["config"]
    if what in ("levels", "both"):
        cfg["levels"] = json.loads(json.dumps(tpl["levels"]))
    if what in ("rewards", "both"):
        cfg["rewards"] = json.loads(json.dumps(tpl["rewards"]))
    save_tenant_config(ctx.tenant["id"], cfg)
    return cfg


def t_setup(ctx):
    cfg = ctx.tenant["config"]
    b = ctx.body
    if b.get("business_name"):
        cfg["business"]["name"] = str(b["business_name"]).strip()
    if b.get("tagline"):
        cfg["business"]["tagline"] = str(b["tagline"]).strip()
    if b.get("currency_symbol"):
        cfg["business"]["currency_symbol"] = str(b["currency_symbol"]).strip()
    if b.get("primary"):
        cfg["theme"]["primary"] = str(b["primary"]).strip()
    if b.get("accent"):
        cfg["theme"]["accent"] = str(b["accent"]).strip()
    tpl = SUGGESTED_TEMPLATES.get(b.get("template") or "")
    if tpl:
        cfg["levels"] = json.loads(json.dumps(tpl["levels"]))
        cfg["rewards"] = json.loads(json.dumps(tpl["rewards"]))
    cfg["setup_done"] = True
    save_tenant_config(ctx.tenant["id"], cfg)
    new_pw = b.get("new_password")
    if new_pw:
        if len(new_pw) < 4:
            raise HttpError(400, "La contraseña debe tener al menos 4 caracteres")
        with get_db() as db:
            db.execute("UPDATE admin_users SET password_hash = ? WHERE id = ?",
                       (hash_password(new_pw), ctx.user["id"]))
    return {"ok": True, "config": cfg}


def t_net(ctx):
    return {"lan_ip": lan_ip(), "port": int(os.environ.get("FIDELIA_PORT") or os.environ.get("PORT") or "8000"),
            "slug": ctx.tenant["slug"]}


def t_info(ctx):
    last_path, last_mtime = last_backup_info()
    with get_db() as db:
        customers = db.execute("SELECT COUNT(*) c FROM customers WHERE tenant_id = ?",
                               (ctx.tenant["id"],)).fetchone()["c"]
    return {
        "db_path": DB_PATH, "backup_dir": BACKUP_DIR,
        "last_backup": (datetime.fromtimestamp(last_mtime).isoformat() if last_mtime else None),
        "backups_kept": BACKUP_KEEP, "customers": customers,
    }


def t_public_config(ctx):
    cfg = ctx.tenant["config"]
    return {
        "business": cfg["business"], "theme": cfg["theme"],
        "features": cfg["features"], "texts": cfg["texts"], "levels": cfg["levels"],
        "rewards": [r for r in cfg["rewards"] if r.get("active")],
    }


MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
             "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _mask_name(name, mode, i, nickname=None):
    if mode == "nickname":
        if nickname:
            return nickname
        mode = "first_initial"   # sin apodo elegido: proteger con nombre + inicial
    if mode == "anonymized":
        return f"Cliente #{i}"
    if mode == "first_initial":
        parts = name.split()
        return parts[0] + (f" {parts[-1][0]}." if len(parts) > 1 else "")
    return name


def t_public_ranking(ctx):
    """Ranking por temporadas: 'month' = puntos ganados este mes (se renueva solo
    cada mes, los puntos canjeables no se tocan). 'alltime' = histórico."""
    cfg = ctx.tenant["config"]
    if not cfg["features"].get("public_ranking"):
        raise HttpError(403, "El ranking no está disponible")
    mode = cfg["features"].get("leaderboard_names", "first_initial")
    tid = ctx.tenant["id"]
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    def period_rows(db, since):
        return db.execute(
            "SELECT c.name, c.nickname, c.xp, "
            "COALESCE(SUM(CASE WHEN t.xp_delta > 0 THEN t.xp_delta ELSE 0 END), 0) AS pxp "
            "FROM customers c "
            "LEFT JOIN transactions t ON t.customer_id = c.id AND t.created_at >= ? "
            "WHERE c.tenant_id = ? AND c.active = 1 "
            "GROUP BY c.id HAVING pxp > 0 "
            "ORDER BY pxp DESC, c.xp DESC LIMIT 20", (since, tid)).fetchall()

    with get_db() as db:
        month_rows = period_rows(db, month_start)
        year_rows = period_rows(db, year_start)
        all_rows = db.execute(
            "SELECT name, nickname, xp FROM customers WHERE tenant_id = ? AND active = 1 "
            "ORDER BY xp DESC LIMIT 20", (tid,)).fetchall()

    def build(rows, xp_key):
        out = []
        for i, r in enumerate(rows, start=1):
            lvl, _ = level_for_xp(r["xp"], cfg["levels"])
            out.append({"rank": i, "name": _mask_name(r["name"], mode, i, r["nickname"]),
                        "xp": r[xp_key], "level": lvl["name"] if lvl else ""})
        return out

    period = cfg["features"].get("ranking_period", "month")
    if period not in ("month", "year", "alltime"):
        period = "month"
    result = {
        "period": period,
        "month_label": f"Ranking de {MONTHS_ES[now.month - 1]}",
        "year_label": f"Ranking de {now.year}",
        "month": build(month_rows, "pxp"),
        "year": build(year_rows, "pxp"),
        "alltime": build(all_rows, "xp"),
    }
    result["ranking"] = result[period if period != "alltime" else "alltime"]
    return result


def t_public_lookup(ctx):
    cfg = ctx.tenant["config"]
    if not cfg["features"].get("self_lookup"):
        raise HttpError(403, "La consulta no está disponible")
    if not rate_limit(f"lookup:{ctx.tenant['id']}:{ctx.ip}", 25, 300):
        raise HttpError(429, "Demasiadas consultas. Espera unos minutos.")
    q = str(need(ctx.body, "query", "Introduce un teléfono o código")).strip()
    with get_db() as db:
        row = db.execute("SELECT * FROM customers WHERE tenant_id = ? AND active = 1 "
                         "AND (phone = ? OR code = ?)", (ctx.tenant["id"], q, q.upper())).fetchone()
    if not row:
        raise HttpError(404, "No encontramos tu ficha. Pregunta en el local.")
    data = customer_public(row, cfg)
    redeemable = []
    for rw in cfg["rewards"]:
        if not rw.get("active"):
            continue
        ok = data["xp"] >= rw.get("cost_xp", 0)
        lvl_ok = True
        if rw.get("min_level"):
            lvl_ok = data["level"] and data["level"]["id"] >= rw["min_level"]
        redeemable.append({**rw, "affordable": ok and lvl_ok})
    return {"customer": {
        "name": data["name"], "code": data["code"], "xp": data["xp"], "visits": data["visits"],
        "level": data["level"], "next_level": data["next_level"],
        "xp_to_next": data["xp_to_next"], "progress_pct": data["progress_pct"],
        "nickname": data.get("nickname"),
    }, "rewards": redeemable}


def t_public_nickname(ctx):
    """El cliente elige su apodo para el ranking, identificándose con su teléfono o código."""
    cfg = ctx.tenant["config"]
    if not cfg["features"].get("self_lookup"):
        raise HttpError(403, "La consulta no está disponible")
    if not rate_limit(f"nick:{ctx.tenant['id']}:{ctx.ip}", 10, 300):
        raise HttpError(429, "Demasiados intentos. Espera unos minutos.")
    q = str(need(ctx.body, "query", "Falta tu teléfono o código")).strip()
    nickname = str(need(ctx.body, "nickname", "Escribe el apodo que quieres"))
    with get_db() as db:
        row = db.execute("SELECT * FROM customers WHERE tenant_id = ? AND active = 1 "
                         "AND (phone = ? OR code = ?)", (ctx.tenant["id"], q, q.upper())).fetchone()
        if not row:
            raise HttpError(404, "No encontramos tu ficha. Pregunta en el local.")
        clean = validate_nickname(db, ctx.tenant["id"], nickname, exclude_customer_id=row["id"])
        db.execute("UPDATE customers SET nickname = ? WHERE id = ?", (clean, row["id"]))
    return {"ok": True, "nickname": clean}


def _tenant_customer(db, tenant_id, cid):
    row = db.execute("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", (cid, tenant_id)).fetchone()
    if not row:
        raise HttpError(404, "Cliente no encontrado")
    return row


def t_find_customer(ctx):
    """Búsqueda exacta por teléfono o código, pensada para el cobro rápido."""
    cfg = ctx.tenant["config"]
    q = (ctx.query.get("q") or "").strip()
    if not q:
        raise HttpError(400, "Escribe un teléfono o código")
    with get_db() as db:
        row = db.execute("SELECT * FROM customers WHERE tenant_id = ? AND active = 1 "
                         "AND (phone = ? OR code = ?)",
                         (ctx.tenant["id"], q, q.upper())).fetchone()
    if not row:
        raise HttpError(404, "No hay ningún cliente con ese teléfono o código")
    return customer_public(row, cfg)


SORTS = {
    "xp": "c.xp DESC",
    "visits": "c.visits DESC, c.xp DESC",
    "spent": "c.total_spent DESC",
    "recent": "c.created_at DESC",
    "redemptions": "redemptions_count DESC, c.xp DESC",
}


def list_customers_data(tenant, params):
    """Lista con filtros: q, status (all|active|banned), level (id), sort, limit, offset."""
    cfg = tenant["config"]
    tid = tenant["id"]
    q = (params.get("q") or "").strip()
    status = params.get("status") or "all"
    level_id = as_int(params.get("level"), 0)
    order = SORTS.get(params.get("sort") or "xp", SORTS["xp"])
    limit = min(500, as_int(params.get("limit"), 100) or 100)
    offset = as_int(params.get("offset"), 0)

    where, args = ["c.tenant_id = ?"], [tid]
    if q:
        like = f"%{q}%"
        where.append("(c.name LIKE ? OR c.phone LIKE ? OR c.code LIKE ? OR c.email LIKE ? OR c.nickname LIKE ?)")
        args += [like, like, like, like, like]
    if status == "active":
        where.append("c.active = 1")
    elif status == "banned":
        where.append("c.active = 0")
    w = " AND ".join(where)
    with get_db() as db:
        rows = db.execute(
            f"SELECT c.*, (SELECT COUNT(*) FROM redemptions r WHERE r.customer_id = c.id) AS redemptions_count "
            f"FROM customers c WHERE {w} ORDER BY {order} LIMIT ? OFFSET ?",
            args + [limit, offset]).fetchall()
        total = db.execute(f"SELECT COUNT(*) t FROM customers c WHERE {w}", args).fetchone()["t"]
    out = []
    for r in rows:
        d = customer_public(r, cfg)
        d["redemptions_count"] = r["redemptions_count"]
        lvl = d["level"]
        if level_id and (not lvl or lvl["id"] != level_id):
            continue
        out.append(d)
    return {"customers": out, "total": total}


def t_list_customers(ctx):
    return list_customers_data(ctx.tenant, ctx.query)


def t_create_customer(ctx):
    cfg = ctx.tenant["config"]
    tid = ctx.tenant["id"]
    b = ctx.body
    name = str(need(b, "name", "El nombre es obligatorio")).strip()
    phone = (b.get("phone") or "").strip() or None
    signup = as_int(cfg["earning"].get("signup_bonus", 0))
    with get_db() as db:
        if phone and db.execute("SELECT 1 FROM customers WHERE tenant_id=? AND phone=?", (tid, phone)).fetchone():
            raise HttpError(409, "Ya existe un cliente con ese teléfono")
        nickname = validate_nickname(db, tid, b.get("nickname"))
        code = gen_customer_code(db, tid)
        cur = db.execute(
            "INSERT INTO customers (tenant_id, code, name, phone, email, birthday, xp, notes, nickname, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (tid, code, name, phone, (b.get("email") or "").strip() or None,
             b.get("birthday") or None, signup, b.get("notes") or None, nickname, now_iso()))
        cid = cur.lastrowid
        if signup:
            db.execute("INSERT INTO transactions (customer_id, kind, amount, xp_delta, note, created_at) VALUES (?,?,?,?,?,?)",
                       (cid, "signup", 0, signup, "Bono de bienvenida", now_iso()))
        row = db.execute("SELECT * FROM customers WHERE id = ?", (cid,)).fetchone()
    return customer_public(row, cfg)


def t_get_customer(ctx):
    cfg = ctx.tenant["config"]
    cid = as_int(ctx.params["cid"])
    with get_db() as db:
        row = _tenant_customer(db, ctx.tenant["id"], cid)
        txs = db.execute("SELECT * FROM transactions WHERE customer_id = ? ORDER BY id DESC LIMIT 100", (cid,)).fetchall()
        reds = db.execute("SELECT * FROM redemptions WHERE customer_id = ? ORDER BY id DESC LIMIT 100", (cid,)).fetchall()
    data = customer_public(row, cfg)
    data["transactions"] = [dict(t) for t in txs]
    data["redemptions"] = [dict(r) for r in reds]
    return data


def t_update_customer(ctx):
    cfg = ctx.tenant["config"]
    cid = as_int(ctx.params["cid"])
    b = ctx.body
    name = str(need(b, "name", "El nombre es obligatorio")).strip()
    with get_db() as db:
        _tenant_customer(db, ctx.tenant["id"], cid)
        nickname = validate_nickname(db, ctx.tenant["id"], b.get("nickname"), exclude_customer_id=cid)
        db.execute("UPDATE customers SET name=?, phone=?, email=?, birthday=?, notes=?, nickname=? WHERE id=?",
                   (name, (b.get("phone") or "").strip() or None, (b.get("email") or "").strip() or None,
                    b.get("birthday") or None, b.get("notes") or None, nickname, cid))
        row = db.execute("SELECT * FROM customers WHERE id = ?", (cid,)).fetchone()
    return customer_public(row, cfg)


def set_customer_ban(tenant, cid, banned):
    with get_db() as db:
        _tenant_customer(db, tenant["id"], cid)
        db.execute("UPDATE customers SET active = ? WHERE id = ?", (0 if banned else 1, cid))
        row = db.execute("SELECT * FROM customers WHERE id = ?", (cid,)).fetchone()
    return customer_public(row, tenant["config"])


def t_ban_customer(ctx):
    banned = bool(ctx.body.get("banned"))
    data = set_customer_ban(ctx.tenant, as_int(ctx.params["cid"]), banned)
    return data


def t_delete_customer(ctx):
    cid = as_int(ctx.params["cid"])
    with get_db() as db:
        _tenant_customer(db, ctx.tenant["id"], cid)
        db.execute("DELETE FROM customers WHERE id = ?", (cid,))
    return {"ok": True}


def _level_up(before_xp, after_xp, cfg):
    old, _ = level_for_xp(before_xp, cfg["levels"])
    new, _ = level_for_xp(after_xp, cfg["levels"])
    if new and (not old or new["id"] > old["id"]):
        return new
    return None


def t_earn(ctx):
    cfg = ctx.tenant["config"]
    e = cfg["earning"]
    cid = as_int(ctx.params["cid"])
    amount = max(0.0, as_float(ctx.body.get("amount")))
    count_visit = ctx.body.get("count_visit", True)
    xp = amount * as_float(e.get("xp_per_currency", 0))
    if count_visit:
        xp += as_float(e.get("xp_per_visit", 0))
    xp = int(xp) if e.get("round_mode") == "floor" else round(xp)
    if xp <= 0 and amount <= 0:
        raise HttpError(400, "No hay importe ni XP que registrar")
    with get_db() as db:
        row = _tenant_customer(db, ctx.tenant["id"], cid)
        if not row["active"]:
            raise HttpError(400, "Cliente bloqueado: desbloquéalo para registrar consumos")
        before = row["xp"]
        db.execute("UPDATE customers SET xp = xp + ?, total_spent = total_spent + ?, visits = visits + ? WHERE id = ?",
                   (xp, amount, 1 if count_visit else 0, cid))
        db.execute("INSERT INTO transactions (customer_id, kind, amount, xp_delta, note, created_at) VALUES (?,?,?,?,?,?)",
                   (cid, "earn", amount, xp, ctx.body.get("note") or None, now_iso()))
        row = db.execute("SELECT * FROM customers WHERE id = ?", (cid,)).fetchone()
    data = customer_public(row, cfg)
    data["gained_xp"] = xp
    data["level_up"] = _level_up(before, row["xp"], cfg)
    return data


def t_adjust(ctx):
    cfg = ctx.tenant["config"]
    cid = as_int(ctx.params["cid"])
    delta = as_int(ctx.body.get("delta"))
    with get_db() as db:
        row = _tenant_customer(db, ctx.tenant["id"], cid)
        if not row["active"]:
            raise HttpError(400, "Cliente bloqueado: desbloquéalo para ajustar puntos")
        new_xp = max(0, row["xp"] + delta)
        db.execute("UPDATE customers SET xp = ? WHERE id = ?", (new_xp, cid))
        db.execute("INSERT INTO transactions (customer_id, kind, amount, xp_delta, note, created_at) VALUES (?,?,?,?,?,?)",
                   (cid, "adjust", 0, new_xp - row["xp"], ctx.body.get("reason") or "Ajuste manual", now_iso()))
        row = db.execute("SELECT * FROM customers WHERE id = ?", (cid,)).fetchone()
    return customer_public(row, cfg)


def t_redeem(ctx):
    cfg = ctx.tenant["config"]
    cid = as_int(ctx.params["cid"])
    reward_id = as_int(ctx.body.get("reward_id"))
    reward = next((r for r in cfg["rewards"] if r.get("id") == reward_id), None)
    if not reward:
        raise HttpError(404, "Recompensa no encontrada")
    if not reward.get("active"):
        raise HttpError(400, "Esa recompensa no está activa")
    cost = as_int(reward.get("cost_xp", 0))
    with get_db() as db:
        row = _tenant_customer(db, ctx.tenant["id"], cid)
        if not row["active"]:
            raise HttpError(400, "Cliente bloqueado: no puede canjear recompensas")
        data = customer_public(row, cfg)
        if reward.get("min_level") and (not data["level"] or data["level"]["id"] < reward["min_level"]):
            raise HttpError(400, "El cliente no tiene el nivel requerido")
        if row["xp"] < cost:
            raise HttpError(400, "XP insuficiente para esta recompensa")
        stock = as_int(reward.get("stock", -1), -1)
        if stock == 0:
            raise HttpError(400, "Recompensa agotada")
        db.execute("UPDATE customers SET xp = xp - ? WHERE id = ?", (cost, cid))
        db.execute("INSERT INTO transactions (customer_id, kind, amount, xp_delta, note, created_at) VALUES (?,?,?,?,?,?)",
                   (cid, "redeem", 0, -cost, f"Canje: {reward['name']}", now_iso()))
        db.execute("INSERT INTO redemptions (customer_id, reward_id, reward_name, cost_xp, created_at) VALUES (?,?,?,?,?)",
                   (cid, reward["id"], reward["name"], cost, now_iso()))
        row = db.execute("SELECT * FROM customers WHERE id = ?", (cid,)).fetchone()
    if stock > 0:
        reward["stock"] = stock - 1
        save_tenant_config(ctx.tenant["id"], cfg)
    result = customer_public(row, cfg)
    result["redeemed"] = reward["name"]
    return result


def t_stats(ctx):
    cfg = ctx.tenant["config"]
    tid = ctx.tenant["id"]
    with get_db() as db:
        total = db.execute("SELECT COUNT(*) c FROM customers WHERE tenant_id=? AND active=1", (tid,)).fetchone()["c"]
        xp_sum = db.execute("SELECT COALESCE(SUM(xp),0) s FROM customers WHERE tenant_id=? AND active=1", (tid,)).fetchone()["s"]
        spent = db.execute("SELECT COALESCE(SUM(total_spent),0) s FROM customers WHERE tenant_id=? AND active=1", (tid,)).fetchone()["s"]
        visits = db.execute("SELECT COALESCE(SUM(visits),0) s FROM customers WHERE tenant_id=? AND active=1", (tid,)).fetchone()["s"]
        redemptions = db.execute(
            "SELECT COUNT(*) c FROM redemptions r JOIN customers c2 ON c2.id = r.customer_id WHERE c2.tenant_id=?",
            (tid,)).fetchone()["c"]
        since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        new30 = db.execute("SELECT COUNT(*) c FROM customers WHERE tenant_id=? AND created_at >= ?", (tid, since)).fetchone()["c"]
        top = db.execute("SELECT name, xp FROM customers WHERE tenant_id=? AND active=1 ORDER BY xp DESC LIMIT 5", (tid,)).fetchall()
        rows = db.execute("SELECT xp FROM customers WHERE tenant_id=? AND active=1", (tid,)).fetchall()
    dist = {lv["name"]: 0 for lv in cfg["levels"]}
    for r in rows:
        lv, _ = level_for_xp(r["xp"], cfg["levels"])
        if lv:
            dist[lv["name"]] = dist.get(lv["name"], 0) + 1
    return {
        "total_customers": total, "total_xp": xp_sum, "total_spent": round(spent, 2),
        "total_visits": visits, "total_redemptions": redemptions, "new_last_30": new30,
        "top": [dict(t) for t in top], "level_distribution": dist,
        "currency": cfg["business"]["currency_symbol"],
    }


def build_customers_csv(tenant):
    import csv, io
    cfg = tenant["config"]
    buf = io.StringIO()
    buf.write("\ufeff")
    w = csv.writer(buf, delimiter=";")
    w.writerow(["codigo", "nombre", "telefono", "email", "cumple", "xp", "nivel",
                "visitas", "gastado", "alta"])
    with get_db() as db:
        rows = db.execute("SELECT * FROM customers WHERE tenant_id=? ORDER BY xp DESC",
                          (tenant["id"],)).fetchall()
    for r in rows:
        lv, _ = level_for_xp(r["xp"], cfg["levels"])
        w.writerow([r["code"], r["name"], r["phone"] or "", r["email"] or "",
                    r["birthday"] or "", r["xp"], lv["name"] if lv else "",
                    r["visits"], f'{r["total_spent"]:.2f}', r["created_at"][:10]])
    return buf.getvalue()


# --------------------------------------------------------------------------- #
#  Tablas de rutas                                                            #
# --------------------------------------------------------------------------- #
PLATFORM_ROUTES = [
    ("POST", r"/api/platform/login",    p_login,          False),
    ("POST", r"/api/platform/logout",   p_logout,         False),
    ("GET",  r"/api/platform/me",       p_me,             True),
    ("POST", r"/api/platform/password", p_password,       True),
    ("GET",  r"/api/platform/templates", p_templates,     True),
    ("GET",  r"/api/platform/tenants",  p_list_tenants,   True),
    ("POST", r"/api/platform/tenants",  p_create_tenant,  True),
    ("PUT",  r"/api/platform/tenants/(?P<tid>\d+)", p_update_tenant, True),
    ("GET",  r"/api/platform/info",     p_info,           True),
    ("GET",  r"/api/platform/revenue",  p_revenue,        True),
    ("POST", r"/api/platform/tenants/(?P<tid>\d+)/delete", p_delete_tenant, True),
    ("GET",  r"/api/platform/tenants/(?P<tid>\d+)/customers", p_tenant_customers, True),
    ("POST", r"/api/platform/tenants/(?P<tid>\d+)/customers/(?P<cid>\d+)/adjust", p_tenant_adjust, True),
    ("POST", r"/api/platform/tenants/(?P<tid>\d+)/customers/(?P<cid>\d+)/ban", p_tenant_ban, True),
    ("GET",  r"/api/platform/billing/settings",  p_billing_settings_get,  True),
    ("POST", r"/api/platform/billing/settings",  p_billing_settings_post, True),
    ("GET",  r"/api/platform/tenants/(?P<tid>\d+)/billing", p_billing_get, True),
    ("POST", r"/api/platform/tenants/(?P<tid>\d+)/billing/enable",    p_billing_enable,    True),
    ("POST", r"/api/platform/tenants/(?P<tid>\d+)/billing/mark_paid", p_billing_mark_paid, True),
    ("POST", r"/api/platform/tenants/(?P<tid>\d+)/billing/price",     p_billing_price,     True),
    ("POST", r"/api/platform/tenants/(?P<tid>\d+)/billing/checkout",  p_billing_checkout,  True),
]
TENANT_ROUTES = [
    ("POST",   r"/api/auth/login",  t_login,  False),
    ("POST",   r"/api/auth/logout", t_logout, False),
    ("GET",    r"/api/auth/me",     t_me,     True),
    ("POST",   r"/api/admin/password", t_password, True),
    ("POST",   r"/api/setup",       t_setup,          True),
    ("GET",    r"/api/templates",   t_templates,      True),
    ("POST",   r"/api/apply_template", t_apply_template, True),
    ("GET",    r"/api/config",      t_get_config,     True),
    ("PUT",    r"/api/config",      t_put_config,     True),
    ("GET",    r"/api/net",         t_net,            True),
    ("GET",    r"/api/info",        t_info,           True),
    ("GET",    r"/api/public/config",  t_public_config,  False),
    ("GET",    r"/api/public/ranking", t_public_ranking, False),
    ("POST",   r"/api/public/lookup",  t_public_lookup,  False),
    ("POST",   r"/api/public/nickname", t_public_nickname, False),
    ("GET",    r"/api/customers/find", t_find_customer, True),
    ("GET",    r"/api/customers",   t_list_customers,  True),
    ("POST",   r"/api/customers",   t_create_customer, True),
    ("GET",    r"/api/customers/(?P<cid>\d+)", t_get_customer,    True),
    ("PUT",    r"/api/customers/(?P<cid>\d+)", t_update_customer, True),
    ("DELETE", r"/api/customers/(?P<cid>\d+)", t_delete_customer, True),
    ("POST",   r"/api/customers/(?P<cid>\d+)/ban",    t_ban_customer, True),
    ("POST",   r"/api/customers/(?P<cid>\d+)/earn",   t_earn,   True),
    ("POST",   r"/api/customers/(?P<cid>\d+)/adjust", t_adjust, True),
    ("POST",   r"/api/customers/(?P<cid>\d+)/redeem", t_redeem, True),
    ("GET",    r"/api/stats",       t_stats,          True),
]
P_COMPILED = [(m, re.compile("^" + pat + "$"), fn, auth) for (m, pat, fn, auth) in PLATFORM_ROUTES]
T_COMPILED = [(m, re.compile("^" + pat + "$"), fn, auth) for (m, pat, fn, auth) in TENANT_ROUTES]
TENANT_PREFIX = re.compile(r"^/r/(?P<slug>[a-z0-9\-]+)(?P<sub>/.*)?$")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
    ".webmanifest": "application/manifest+json",
}


def tenant_manifest(tenant, admin=False):
    name = tenant["config"]["business"]["name"]
    theme = tenant["config"]["theme"]["primary"]
    return {
        "name": (f"{name} · Gestión" if admin else name),
        "short_name": ("Gestión" if admin else name[:12]),
        "start_url": f"/r/{tenant['slug']}/admin" if admin else f"/r/{tenant['slug']}/",
        "scope": f"/r/{tenant['slug']}/",
        "display": "standalone",
        "background_color": theme, "theme_color": theme,
        "icons": [
            {"src": "/static/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/static/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


# --------------------------------------------------------------------------- #
#  Servidor HTTP                                                              #
# --------------------------------------------------------------------------- #
COMPRESSIBLE = {"application/json", "text/html", "application/javascript",
                "text/css", "image/svg+xml", "application/manifest+json", "text/csv"}
STATIC_CACHE = {".js", ".css", ".png", ".svg", ".ico", ".webmanifest", ".jpg"}


class Handler(BaseHTTPRequestHandler):
    server_version = "Fidelia/2.1"
    protocol_version = "HTTP/1.1"   # keep-alive: mucho más rápido en móvil/tablet

    def log_message(self, *args):
        pass

    def _is_https(self):
        return self.headers.get("X-Forwarded-Proto", "").lower() == "https"

    def _accepts_gzip(self):
        return "gzip" in (self.headers.get("Accept-Encoding") or "")

    def _maybe_gzip(self, data, content_type):
        base = content_type.split(";")[0].strip()
        if self._accepts_gzip() and base in COMPRESSIBLE and len(data) > 500:
            return gzip.compress(data, 6), "gzip"
        return data, None

    def _common_headers(self, content_type):
        self.send_header("X-Content-Type-Options", "nosniff")
        if self._is_https():
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        if content_type.startswith("text/html"):
            self.send_header("X-Frame-Options", "SAMEORIGIN")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
            self.send_header("Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                "font-src https://fonts.gstatic.com; img-src 'self' data:; "
                "connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")

    # ---- respuestas ---- #
    def _send_json(self, status, obj, ctx=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        body, enc = self._maybe_gzip(body, "application/json")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if enc:
            self.send_header("Content-Encoding", enc)
        self.send_header("Cache-Control", "no-store")
        self._common_headers("application/json")
        self.send_header("Content-Length", str(len(body)))
        secure = "; Secure" if self._is_https() else ""
        if ctx and ctx.new_cookie:
            name, tok = ctx.new_cookie
            self.send_header("Set-Cookie",
                f"{name}={tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_TTL_DAYS*86400}{secure}")
        if ctx and ctx.clear_cookie:
            self.send_header("Set-Cookie", f"{ctx.clear_cookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{secure}")
        self.end_headers()
        self.wfile.write(body)

    def _send_download(self, data, filename, content_type="application/octet-stream"):
        if isinstance(data, str):
            data = data.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self._common_headers(content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, path, extra_headers=None):
        if not os.path.isfile(path):
            self._send_json(404, {"detail": "No encontrado"})
            return
        ext = os.path.splitext(path)[1].lower()
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        with open(path, "rb") as f:
            data = f.read()
        data, enc = self._maybe_gzip(data, ctype)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        if enc:
            self.send_header("Content-Encoding", enc)
        if ext in STATIC_CACHE:
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        self._common_headers(ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _serve_static(self, path):
        rel = path[len("/static/"):]
        safe = os.path.normpath(rel).replace("\\", "/")
        if safe.startswith("..") or safe.startswith("/"):
            self._send_json(403, {"detail": "Prohibido"})
            return
        self._send_file(os.path.join(STATIC_DIR, safe))

    def _cookie(self, name):
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                if k == name:
                    return v
        return None

    MAX_BODY = 3 * 1024 * 1024   # 3 MB: suficiente para logos, imposible para ataques de memoria

    def _read_body(self):
        length = as_int(self.headers.get("Content-Length"), 0)
        if length <= 0:
            return {}
        if length > self.MAX_BODY:
            raise HttpError(413, "Petición demasiado grande")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            raise HttpError(400, "JSON no válido")

    def _run_route(self, routes, method, path, kind, tenant=None):
        """Devuelve True si una ruta atendió la petición."""
        cookie_name = PLATFORM_COOKIE if kind == "platform" else TENANT_COOKIE
        for m, rx, fn, auth in routes:
            if m != method:
                continue
            mo = rx.match(path)
            if not mo:
                continue
            try:
                body = self._read_body() if method in ("POST", "PUT") else {}
                token = self._cookie(cookie_name)
                user = None
                if auth:
                    user = session_user(token, kind)
                    if not user:
                        raise HttpError(401, "No autenticado")
                    if kind == "tenant" and tenant and user.get("tenant_id") != tenant["id"]:
                        raise HttpError(401, "Sesión de otro restaurante")
                parsed = urlparse(self.path)
                ctx = Ctx(mo.groupdict(), body, dict(parse_qsl(parsed.query)), user,
                          self.client_address[0], tenant=tenant, token=token)
                result = fn(ctx)
                self._send_json(200, result, ctx)
            except HttpError as e:
                self._send_json(e.status, {"detail": e.detail})
            except Exception as e:
                print(f"  [error] {method} {path}: {e}")
                self._send_json(500, {"detail": "Error interno"})
            return True
        return False

    def _dispatch(self, method):
        parsed = urlparse(self.path)
        path = parsed.path

        # ---- Globales ---- #
        if method == "GET":
            if path == "/healthz":
                return self._send_json(200, {"ok": True})
            if path in ("/", "/platform"):
                return self._send_file(os.path.join(STATIC_DIR, "platform.html"))
            if path == "/sw.js":
                return self._send_file(os.path.join(STATIC_DIR, "sw.js"),
                                       extra_headers={"Service-Worker-Allowed": "/"})
            if path == "/favicon.ico":
                return self._send_file(os.path.join(STATIC_DIR, "icon-192.png"))
            if path.startswith("/static/"):
                return self._serve_static(path)
            if path == "/api/backup":
                if not session_user(self._cookie(PLATFORM_COOKIE), "platform"):
                    return self._send_json(401, {"detail": "Solo el propietario de la plataforma"})
                dest = make_backup("manual")
                if not dest:
                    return self._send_json(404, {"detail": "Aún no hay base de datos"})
                with open(dest, "rb") as f:
                    data = f.read()
                ts = datetime.now().strftime("%Y%m%d-%H%M")
                return self._send_download(data, f"fidelia-backup-{ts}.db", "application/x-sqlite3")

        # ---- Restaurar copia de seguridad (.db) desde el panel ---- #
        if method == "POST" and path == "/api/platform/restore":
            return self._restore_backup()

        # ---- Webhook de Stripe (firma HMAC, sin sesión) ---- #
        if method == "POST" and path == "/api/stripe/webhook":
            return self._stripe_webhook()
        if method == "GET" and path == "/pago-ok":
            html = ("<!doctype html><meta charset='utf-8'><title>Fidelia</title>"
                    "<body style='font-family:sans-serif;display:grid;place-items:center;height:90vh'>"
                    "<div style='text-align:center'><h1>Pago procesado</h1>"
                    "<p>Ya puedes cerrar esta ventana. Tu acceso a Fidelia se activa autom&aacute;ticamente.</p></div>")
            data = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._common_headers("text/html")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # ---- API de plataforma ---- #
        if self._run_route(P_COMPILED, method, path, "platform"):
            return

        # ---- Rutas de restaurante /r/<slug>/... ---- #
        mo = TENANT_PREFIX.match(path)
        if mo:
            slug = mo.group("slug")
            sub = mo.group("sub") or "/"
            tenant = load_tenant(slug=slug)
            if not tenant:
                return self._send_json(404, {"detail": "Restaurante no encontrado"})
            if not tenant["active"]:
                return self._send_json(403, {"detail": "Este restaurante está suspendido. Contacta con el proveedor."})

            if method == "GET":
                if sub == "/":
                    return self._send_file(os.path.join(STATIC_DIR, "customer.html"))
                if sub == "/admin":
                    return self._send_file(os.path.join(STATIC_DIR, "admin.html"))
                if sub == "/manifest.webmanifest":
                    return self._send_json(200, tenant_manifest(tenant, admin=False))
                if sub == "/manifest-admin.webmanifest":
                    return self._send_json(200, tenant_manifest(tenant, admin=True))
                if sub == "/api/export/customers.csv":
                    user = session_user(self._cookie(TENANT_COOKIE), "tenant")
                    if not user or user.get("tenant_id") != tenant["id"]:
                        return self._send_json(401, {"detail": "No autenticado"})
                    return self._send_download(build_customers_csv(tenant), "clientes.csv",
                                               "text/csv; charset=utf-8")

            if self._run_route(T_COMPILED, method, sub, "tenant", tenant=tenant):
                return

        self._send_json(404, {"detail": "No encontrado"})

    def _restore_backup(self):
        if not session_user(self._cookie(PLATFORM_COOKIE), "platform"):
            return self._send_json(401, {"detail": "Solo el propietario de la plataforma"})
        length = as_int(self.headers.get("Content-Length"), 0)
        if length <= 0:
            return self._send_json(400, {"detail": "Sube el archivo .db de la copia"})
        if length > 200 * 1024 * 1024:
            return self._send_json(400, {"detail": "Archivo demasiado grande"})
        data = self.rfile.read(length)
        if not data.startswith(b"SQLite format 3"):
            return self._send_json(400, {"detail": "Eso no es una copia de Fidelia (.db)"})
        import tempfile
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db",
                                          dir=os.path.dirname(DB_PATH))
        try:
            tmp.write(data)
            tmp.close()
            # validar el archivo antes de tocar nada
            conn = sqlite3.connect(tmp.name)
            try:
                names = {r[0] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
                required = {"tenants", "customers", "admin_users", "platform_users"}
                if not required.issubset(names):
                    raise ValueError("La copia no contiene las tablas de Fidelia")
                check = conn.execute("PRAGMA integrity_check").fetchone()[0]
                if check != "ok":
                    raise ValueError("La copia está dañada (integrity_check)")
            finally:
                conn.close()
            # copia de seguridad del estado actual y consolidación WAL
            make_backup("pre-restore")
            cur = sqlite3.connect(DB_PATH, timeout=30)
            try:
                cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                cur.close()
            os.replace(tmp.name, DB_PATH)
            for suffix in ("-wal", "-shm"):
                try:
                    os.remove(DB_PATH + suffix)
                except OSError:
                    pass
            return self._send_json(200, {"ok": True, "relogin": True,
                "detail": "Copia restaurada. Vuelve a iniciar sesión."})
        except ValueError as e:
            try: os.remove(tmp.name)
            except OSError: pass
            return self._send_json(400, {"detail": str(e)})
        except Exception as e:
            try: os.remove(tmp.name)
            except OSError: pass
            return self._send_json(500, {"detail": f"No se pudo restaurar: {e}"})

    def _stripe_webhook(self):
        length = as_int(self.headers.get("Content-Length"), 0)
        payload = self.rfile.read(length) if length > 0 else b""
        secret = get_setting("stripe_webhook_secret")
        if not secret:
            return self._send_json(400, {"detail": "Webhook no configurado (falta el secreto)"})
        sig = self.headers.get("Stripe-Signature", "")
        if not verify_stripe_signature(payload, sig, secret):
            return self._send_json(400, {"detail": "Firma no válida"})
        try:
            evt = json.loads(payload.decode("utf-8"))
        except Exception:
            return self._send_json(400, {"detail": "JSON no válido"})
        try:
            return self._send_json(200, process_stripe_event(evt))
        except HttpError as e:
            return self._send_json(e.status, {"detail": e.detail})
        except Exception as e:
            return self._send_json(500, {"detail": f"Error interno: {e}"})

    def do_GET(self):    self._dispatch("GET")
    def do_POST(self):   self._dispatch("POST")
    def do_PUT(self):    self._dispatch("PUT")
    def do_DELETE(self): self._dispatch("DELETE")


def main():
    init_db()
    backup_if_stale()
    start_backup_thread()
    start_billing_thread()
    host = os.environ.get("FIDELIA_HOST", "0.0.0.0")
    port = int(os.environ.get("FIDELIA_PORT") or os.environ.get("PORT") or "8000")
    ip = lan_ip()
    print("\n" + "=" * 60)
    print("  FIDELIA · Plataforma multi-restaurante")
    print("=" * 60)
    print("  Panel del propietario (crear/gestionar restaurantes):")
    print(f"    En este equipo : http://127.0.0.1:{port}/platform")
    print(f"    Desde la red   : http://{ip}:{port}/platform")
    print("    Acceso inicial : admin / admin  (cambialo al entrar)")
    print("  Cada restaurante tendra su propia direccion:")
    print(f"    http://{ip}:{port}/r/<nombre>/admin   (personal)")
    print(f"    http://{ip}:{port}/r/<nombre>/        (clientes)")
    print("  " + "-" * 56)
    print(f"  Tus datos      : {DB_PATH}")
    print(f"  Copias segurid.: {BACKUP_DIR}  (automaticas, {BACKUP_KEEP} copias)")
    print("=" * 60 + "\n")
    server = ThreadingHTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Fidelia detenido.")
        server.shutdown()


if __name__ == "__main__":
    main()
