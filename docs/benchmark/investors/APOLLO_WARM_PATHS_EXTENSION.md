# Extensión futura: personas y warm paths

Este módulo está fuera del benchmark principal y solo puede ejecutarse después de seleccionar una firma. Su entrada será el `stable_id` de la firma; sus salidas no podrán alterar discovery, labels o ranking del fondo.

Interfaz propuesta: `enrichSelectedInvestor({stable_id, official_domain, as_of}, deps)` devuelve candidatos a partner/persona relevante, cargo, email y estado de verificación, posibles rutas cálidas y evidencia fechada. Cada afirmación debe conservar proveedor, URL o registro fuente, fecha y nivel de confianza.

Métricas separadas: precision@k de personas relevantes, exactitud de cargo, tasa de emails verificados, precisión de warm paths con evidencia y cobertura. No se medirá probabilidad de respuesta, introducción, reunión o inversión sin un protocolo humano independiente.

Apollo sería un proveedor opcional inyectado. No se llama desde B0/B1/B2, no comparte presupuesto con el benchmark y no se usa en fixtures de v0.
