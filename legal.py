# -*- coding: utf-8 -*-
"""
Textos legales de Fidelia (España: RGPD, LOPDGDD, LSSI-CE).

IMPORTANTE PARA DANI:
  1. Rellena tus datos reales abajo en LEGAL_DATA (nombre, NIF, dirección, email).
     Todo lo que aparece [ASÍ] debe sustituirse por tus datos.
  2. Estos textos son PLANTILLAS completas y correctas para el caso habitual
     (autónomo español que vende un SaaS por suscripción a negocios españoles),
     pero NO sustituyen la revisión de un abogado/gestor. Revísalos con un
     profesional antes de operar de forma seria.
  3. Si cambias algo relevante, sube LEGAL_VERSION para que los clientes vuelvan
     a aceptar la nueva versión.
"""

# Sube este número (fecha) cada vez que cambies los textos de forma sustancial.
LEGAL_VERSION = "2026-07-14"

# --- TUS DATOS (RELLÉNALOS) -------------------------------------------------
LEGAL_DATA = {
    "titular": "[TU NOMBRE Y APELLIDOS]",
    "nif": "[TU NIF/DNI]",
    "domicilio": "[TU DIRECCIÓN FISCAL COMPLETA]",
    "email": "[TU EMAIL DE CONTACTO]",
    "marca": "Fidelia",
    "web": "[TU DOMINIO, p. ej. https://fidelia.app]",
}


def _fill(text):
    d = LEGAL_DATA
    return (text
            .replace("{{TITULAR}}", d["titular"])
            .replace("{{NIF}}", d["nif"])
            .replace("{{DOMICILIO}}", d["domicilio"])
            .replace("{{EMAIL}}", d["email"])
            .replace("{{MARCA}}", d["marca"])
            .replace("{{WEB}}", d["web"])
            .replace("{{VERSION}}", LEGAL_VERSION))


# --- AVISO LEGAL (LSSI-CE) --------------------------------------------------
AVISO_LEGAL = """
# Aviso Legal

En cumplimiento del artículo 10 de la Ley 34/2002 de Servicios de la Sociedad de la Información y Comercio Electrónico (LSSI-CE), se informa de los datos del titular de este servicio:

- **Titular:** {{TITULAR}}
- **NIF:** {{NIF}}
- **Domicilio:** {{DOMICILIO}}
- **Correo electrónico:** {{EMAIL}}
- **Servicio:** {{MARCA}}, plataforma de fidelización de clientes por puntos ofrecida en modalidad de suscripción (SaaS).

## Objeto
El presente Aviso Legal regula el uso del servicio {{MARCA}}. El acceso y uso del servicio atribuye la condición de usuario e implica la aceptación de las condiciones aquí recogidas.

## Uso del servicio
El usuario se compromete a hacer un uso lícito del servicio, absteniéndose de emplearlo para fines ilícitos, lesivos de derechos de terceros o que puedan dañar, inutilizar o deteriorar el servicio.

## Propiedad intelectual
El software, la marca {{MARCA}}, su diseño y código son titularidad de {{TITULAR}} o cuenta con licencia para su uso. Queda prohibida su reproducción, distribución o transformación sin autorización expresa.

## Responsabilidad
{{TITULAR}} no se responsabiliza de las interrupciones del servicio por causas ajenas a su control, ni del uso que cada negocio suscriptor haga de la herramienta con sus propios clientes.

## Legislación aplicable
Estas condiciones se rigen por la legislación española. Para cualquier controversia, las partes se someten a los juzgados y tribunales del domicilio del titular, salvo que la normativa de consumo aplicable disponga otro fuero.

_Última actualización: {{VERSION}}_
"""

# --- TÉRMINOS Y CONDICIONES DE LA SUSCRIPCIÓN ------------------------------
TERMINOS = """
# Términos y Condiciones del Servicio

Estos Términos regulan la contratación y uso de la suscripción a {{MARCA}} (en adelante, "el Servicio") entre {{TITULAR}}, con NIF {{NIF}} (en adelante, "el Proveedor"), y el negocio que contrata la suscripción (en adelante, "el Cliente").

## 1. Descripción del Servicio
{{MARCA}} es una plataforma de fidelización de clientes por puntos. Permite al Cliente gestionar un programa de puntos, recompensas y niveles para sus propios clientes finales. El Servicio se presta en modalidad de suscripción periódica (SaaS), accesible vía web.

## 2. Planes y precios
El Servicio se ofrece en distintos planes (Básico, Pro y Cadena) con funciones y precios diferenciados, indicados en el momento de la contratación. Los precios se expresan **sin IVA**, salvo que se indique lo contrario; se aplicará el IVA vigente (21%) en la factura.

## 3. Facturación y pago
La suscripción se factura de forma periódica (mensual o anual, según lo contratado). El pago se realiza mediante tarjeta (a través de la pasarela Stripe) o por transferencia, según se acuerde. El impago faculta al Proveedor a suspender el acceso al Servicio previo aviso.

## 4. Duración y cancelación
La suscripción se renueva automáticamente por periodos iguales salvo cancelación. El Cliente puede cancelar en cualquier momento con efecto al final del periodo ya pagado; no se reembolsan periodos ya iniciados salvo obligación legal.

## 5. Obligaciones del Cliente
El Cliente es responsable de la veracidad de los datos que introduce, del uso de sus credenciales de acceso y de cumplir la normativa aplicable frente a sus propios clientes finales, incluyendo la información y obtención de consentimientos que correspondan.

## 6. Disponibilidad
El Proveedor procurará la máxima disponibilidad del Servicio, pero no garantiza un funcionamiento ininterrumpido. Podrá realizar tareas de mantenimiento que impliquen interrupciones temporales.

## 7. Limitación de responsabilidad
El Proveedor no será responsable de daños indirectos, lucro cesante o pérdida de datos derivados del uso del Servicio, salvo en los casos de dolo o negligencia grave, o cuando la ley imponga una responsabilidad no excluible.

## 8. Protección de datos
El tratamiento de datos personales se rige por la Política de Privacidad y, cuando el Cliente introduce datos de sus clientes finales, por el Contrato de Encargo de Tratamiento, ambos parte integrante de estos Términos.

## 9. Modificaciones
El Proveedor podrá modificar estos Términos notificándolo con antelación razonable. El uso continuado tras la notificación implica aceptación de la nueva versión.

## 10. Legislación y jurisdicción
Estos Términos se rigen por la ley española. Las partes se someten a los juzgados del domicilio del Proveedor, salvo fuero imperativo distinto.

_Versión: {{VERSION}}_
"""

# --- POLÍTICA DE PRIVACIDAD (RGPD / LOPDGDD) -------------------------------
PRIVACIDAD = """
# Política de Privacidad

De conformidad con el Reglamento (UE) 2016/679 (RGPD) y la Ley Orgánica 3/2018 (LOPDGDD), se informa sobre el tratamiento de datos personales en {{MARCA}}.

## Responsable del tratamiento
- **Responsable:** {{TITULAR}}
- **NIF:** {{NIF}}
- **Domicilio:** {{DOMICILIO}}
- **Contacto:** {{EMAIL}}

## Dos niveles de tratamiento
1. **Datos del negocio suscriptor** (nombre, datos de contacto y de facturación de quien contrata): el Proveedor actúa como **responsable**.
2. **Datos de los clientes finales** que cada negocio introduce en la plataforma (nombre, teléfono, historial de puntos): respecto de estos, el negocio es el **responsable** y el Proveedor actúa como **encargado del tratamiento** (ver Contrato de Encargo de Tratamiento).

## Finalidades y base jurídica
- Prestar y facturar el servicio de suscripción (ejecución de un contrato).
- Cumplir obligaciones legales, fiscales y contables (obligación legal).
- Atender consultas y dar soporte (interés legítimo / consentimiento).

## Conservación
Los datos se conservan mientras dure la relación contractual y, después, durante los plazos legales de prescripción (en especial, obligaciones fiscales y mercantiles, habitualmente hasta 6 años).

## Destinatarios
No se ceden datos a terceros salvo obligación legal. Se emplean proveedores tecnológicos que actúan como encargados (por ejemplo, la pasarela de pago Stripe y el proveedor de alojamiento), con las garantías exigidas por el RGPD.

## Derechos
Puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a {{EMAIL}}, acreditando su identidad. Asimismo, puede reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).

## Seguridad
Se aplican medidas técnicas y organizativas razonables (contraseñas cifradas, control de acceso, copias de seguridad) para proteger los datos.

_Última actualización: {{VERSION}}_
"""

# --- POLÍTICA DE COOKIES ----------------------------------------------------
COOKIES = """
# Política de Cookies

{{MARCA}} utiliza exclusivamente **cookies técnicas necesarias** para el funcionamiento del servicio; no se usan cookies publicitarias ni de seguimiento de terceros.

## Cookies que utilizamos
- **Cookie de sesión** (`fidelia_session`, `fidelia_platform`): mantiene la sesión iniciada del usuario mientras usa el panel. Es imprescindible para poder acceder a la cuenta.

Estas cookies son estrictamente necesarias y, conforme a la normativa, **no requieren consentimiento previo**, pero se informa de su uso por transparencia.

## Almacenamiento local
La aplicación puede guardar en tu dispositivo información técnica (por ejemplo, recordar tu teléfono para no volver a escribirlo) mediante almacenamiento local del navegador. Puedes borrarlo desde los ajustes de tu navegador en cualquier momento.

_Última actualización: {{VERSION}}_
"""

# --- CONTRATO DE ENCARGO DE TRATAMIENTO (Art. 28 RGPD) ---------------------
ENCARGO = """
# Contrato de Encargo de Tratamiento

En cumplimiento del artículo 28 del RGPD, este documento regula el tratamiento de datos personales que {{TITULAR}} ("el Encargado") realiza por cuenta del negocio suscriptor ("el Responsable") al prestar el servicio {{MARCA}}.

## 1. Objeto
El Encargado tratará, por cuenta del Responsable, los datos de los clientes finales que el Responsable introduzca en la plataforma, con la única finalidad de prestar el servicio de fidelización contratado.

## 2. Datos y categorías de interesados
- **Interesados:** clientes finales del Responsable.
- **Datos:** identificativos (nombre, apodo), de contacto (teléfono, email si se aporta) y de actividad (puntos, visitas, canjes, fecha de cumpleaños si se aporta).

## 3. Duración
El encargo dura mientras esté vigente la suscripción. A su fin, el Encargado suprimirá o devolverá los datos según indique el Responsable, salvo obligación legal de conservación.

## 4. Obligaciones del Encargado
- Tratar los datos solo siguiendo instrucciones del Responsable.
- Garantizar la confidencialidad de quienes tratan los datos.
- Aplicar medidas de seguridad adecuadas (art. 32 RGPD).
- Asistir al Responsable en el ejercicio de derechos de los interesados y en sus obligaciones de seguridad.
- Notificar sin dilación indebida las violaciones de seguridad de las que tenga conocimiento.
- No subcontratar sin autorización; los proveedores tecnológicos empleados (alojamiento, pasarela de pago) actúan con las garantías del RGPD.

## 5. Obligaciones del Responsable
El Responsable (el negocio) debe informar a sus clientes finales del tratamiento de sus datos y obtener, cuando proceda, su consentimiento, así como usar la plataforma conforme a la ley.

_Versión: {{VERSION}}_
"""

DOCS = {
    "terminos":   {"title": "Términos y Condiciones", "body": TERMINOS},
    "privacidad": {"title": "Política de Privacidad", "body": PRIVACIDAD},
    "aviso":      {"title": "Aviso Legal",             "body": AVISO_LEGAL},
    "cookies":    {"title": "Política de Cookies",     "body": COOKIES},
    "encargo":    {"title": "Contrato de Encargo de Tratamiento", "body": ENCARGO},
}


def get_doc(key):
    d = DOCS.get(key)
    if not d:
        return None
    return {"key": key, "title": d["title"], "body": _fill(d["body"]), "version": LEGAL_VERSION}


def all_docs():
    return [get_doc(k) for k in DOCS]
