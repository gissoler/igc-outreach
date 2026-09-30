# Rúbrica de matching de convocatorias (grants)

Código: `server/research/grantMatch.mjs` · Pruebas: `tests/grantMatch.test.mjs` · Revisión de resultados guardados: `node research/scripts/grants-recheck.mjs`

## Por qué existe

El 30/09 la convocatoria Grants.gov **344715 (NSF 23-525, Oceanographic Facilities and Equipment Support, ALN 47.050 Geosciences)** salió como match de un proyecto de Alzheimer y armonización de datos. Además se generó una propuesta para ella. El sistema contaba palabras sueltas del brief que aparecían en el texto: *research*, *infrastructure*, *data*, *open science*. No comprobaba el título, la agencia, el Assistance Listing ni el objetivo oficial. Lo correcto era rechazar la convocatoria y no generar propuesta.

## Cómo decide (solo código, sobre campos oficiales)

1. **Anclas temáticas.** Salen del sector, el producto y los términos de búsqueda.
   - **Se excluyen:**
     - las palabras genéricas (*research, data, infrastructure, program, support, technology…*);
     - los criterios, porque son restricciones y no temas;
     - la descripción libre.
   - **Las palabras amplias** (*health, disease, digital, clinical, wellness…*) solo cuentan dentro de una frase completa, como *mental health*.
   - **Conceptos con sinónimos y siglas:**
     - Alzheimer ↔ *AD/ADRD, dementia, neurodegeneration, NIA*;
     - salud mental ↔ *behavioral health, psychiatric, anxiety, well-being*;
     - salud digital ↔ *mHealth, telehealth, health IT, informatics*;
     - AI ↔ *machine learning, LLM*;
     - armonización ↔ *interoperability, common data elements*;
     - neurociencia ↔ *brain, Parkinson, ALS*;
     - terapéutica ↔ *drug, therapies, pharmacology*.
2. **Campo oficial.** El ALN/CFDA indica qué financia la convocatoria:
   - **NSF por directorado:** 47.050 = Geociencias, 47.074 = Biología, 47.075 = Ciencias sociales y del comportamiento…
   - **Por agencia:** 93.xxx = Salud, 12.420 = CDMRP (médico), 10.xxx = Agricultura…

   Ese campo se compara con el del proyecto. Los campos cercanos (salud ↔ biología ↔ ciencias sociales y del comportamiento) no cuentan como ajenos.
3. **Veredicto.**

| Veredicto | Cuándo | Efecto |
|---|---|---|
| **mismatch** | Ningún ancla ni concepto del proyecto aparece en el título ni en el alcance oficial. O bien el campo oficial es otro y el título no coincide. | Se **descarta** con el motivo. `grantPlan` = *Not a match*. **No se genera borrador ni propuesta.** |
| **weak** | El tema solo aparece de pasada en el alcance, el campo oficial es otro aunque el título coincida, o no se pudo leer el alcance. | Pasa a **radar** con «Check topic fit». No es prioridad. |
| **match** | Hay un ancla o concepto en el título, una frase completa en el alcance o ≥ 3 anclas en el alcance. | Puede ser prioridad. Sigue sujeta a elegibilidad, fechas y monto. |

## Cómo se mide

- Gold set: `eval/gold/negative-nsf-23-525.json` (`rejected_opportunities`).
- La métrica `falsePositives` de `eval/metrics.mjs` cuenta las convocatorias rechazadas que quedaron como prioridad o radar. Debe ser 0.
- Para añadir otro caso negativo, crea un JSON igual en `eval/gold/`.

## Resultado sobre lo ya guardado (30/09, base local, 178 convocatorias únicas)

- **Veredicto nuevo:** 77 match · 67 weak · 34 mismatch.
- **De las 47 que antes eran prioridad:**
  - 16 pasan a mismatch. Son rechazos correctos: bibliotecas nativas, oceanografía, SpaceTech, embajadas, Challenge.gov, Ocean Drilling…
  - 11 pasan a weak.
  - 20 siguen como match.
- **Convocatorias de Alzheimer (NIA/NINDS con «ADRD» en el título):** siguen como match.

Las evaluaciones antiguas no guardaban el ALN. En ellas solo se aplicó la regla temática. Desde ahora, cada convocatoria de Grants.gov guarda su ALN (`facts.aln` y evidencia `program`).
