# V8 — Diagnóstico de alcanzabilidad del oro por variante

Ejecutado: 2026-10-13T00:11:19.928Z. Pre-registro: docs/handoff/V8-PREREGISTRO.md. Solo Exa, llamada directa (exa-direct.v8.mjs).

Costo: 156 unidades pagadas × 0.0089 = US$ 1.388. Tarifa nominal de esas llamadas: US$ 3.24. costDollars devuelto por Exa (suma): US$ 2.818.

## Fase A: p01–p06 (elección)

| Variante | Descripción | Casos con el oro (regla) | Casos solo por dominio | p01 | p02 | p03 | p04 | p05 | p06 |
|---|---|---|---|---|---|---|---|---|---|
| base10 | cortas, puesto ≤10 (base) | 1 de 6 | 1 | — | — | — | — | D | — |
| b30 | cortas, puesto ≤30 | 1 de 6 | 1 | — | — | — | — | D | — |
| b50 | cortas, puesto ≤50 | 1 de 6 | 1 | — | — | — | — | D | — |
| a10 | category company, puesto ≤10 | 1 de 6 | 1 | — | — | — | — | D | — |
| a25 | category company, puesto ≤25 | 1 de 6 | 1 | — | — | — | — | D | — |
| e10 | largas del brief, puesto ≤10 | 1 de 6 | 1 | — | — | — | — | D | — |
| e25 | largas del brief, puesto ≤25 | 1 de 6 | 1 | — | — | — | — | D | — |
| c | por inversiones (empresas parecidas → inversores): dominio o nombre | 0 de 6 | 0 | — | — | — | — | — | — |
| d | páginas de listas: dominio o nombre | 3 de 6 | 1 | N | — | — | D | — | N |

D = dominio del oro en los resultados; N = solo el nombre del oro en el texto (c y d); — = no aparece.

Variantes elegidas en la fase A (≥ base10 + 2 casos): d.

## Fase B: p07–p12 (confirmación)

| Variante | Descripción | Casos con el oro (regla) | Casos solo por dominio | p07 | p08 | p09 | p10 | p11 | p12 |
|---|---|---|---|---|---|---|---|---|---|
| base10 | cortas, puesto ≤10 (base) | 2 de 6 | 2 | — | — | — | D | D | — |
| d | páginas de listas: dominio o nombre | 5 de 6 | 1 | N | N | N | D | N | — |

D = dominio del oro en los resultados; N = solo el nombre del oro en el texto (c y d); — = no aparece.

Variantes confirmadas en la fase B (≥ base10 + 1 caso): d.

## Llamadas (consulta, costo y puesto del oro)

| Caso | Fase | Tipo | Consulta | Resultados | Unidades | USD | Nominal USD | Puesto del oro | Nombre en texto |
|---|---|---|---|---|---|---|---|---|---|
| p01 | A | short | seed venture capital Fintech Mexico | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p01 | A | short | venture capital firm investing in B2B payments startups Mexico | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p01 | A | short | seed VC fund B2B payments SME working capital Mexico | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p01 | A | cat | seed venture capital Fintech Mexico | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p01 | A | cat | venture capital firm investing in B2B payments startups Mexico | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p01 | A | cat | seed VC fund B2B payments SME working capital Mexico | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p01 | A | long | seed investor for a startup building Accounts-payable and supplier-financing platform for independent restaurants and their food distributors in Mexico | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p01 | A | long | venture capital firm that invests in companies like this: the company lets small restaurants pay food distributors on 30-day terms while distributors get paid upfront. | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p01 | A | long | venture capital investing in Fintech companies (B2B payments, SME working capital, embedded lending) in Mexico at seed, round of about USD 2.5 million | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p01 | A | c1 | seed startup Accounts-payable and supplier-financing platform for independent restaurants and their food distributors Mexico | 10 | 1 | 0.0089 | 0.007 | — | n/a |
| p01 | A | c2 | Konfio seed funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p01 | A | c2 | Pideaky (YC S21) seed funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p01 | A | c2 | Pancho seed funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p01 | A | list | top venture capital firms investing in Fintech in Mexico | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p01 | A | list | list of seed investors Fintech B2B payments Mexico | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p02 | A | short | Series B venture capital Electric mobility Brazil | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p02 | A | short | venture capital firm investing in electric cargo vehicles startups Brazil | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p02 | A | short | Series B VC fund electric cargo vehicles battery swapping Brazil | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p02 | A | cat | Series B venture capital Electric mobility Brazil | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p02 | A | cat | venture capital firm investing in electric cargo vehicles startups Brazil | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p02 | A | cat | Series B VC fund electric cargo vehicles battery swapping Brazil | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p02 | A | long | Series B investor for a startup building Electric cargo three-wheelers with battery-swap stations, leased to last-mile delivery fleets in Brazil | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p02 | A | long | venture capital firm that invests in companies like this: the company designs and assembles electric cargo three-wheelers in Sao Paulo state and operates a network of battery-swap stations. | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p02 | A | long | growth investor investing in Electric mobility companies (electric cargo vehicles, battery swapping, urban logistics) in Brazil at Series B, round of about USD 30 million | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p02 | A | c1 | Series B startup Electric cargo three-wheelers with battery-swap stations, leased to last-mile delivery fleets Brazil | 10 | 1 | 0.0089 | 0.007 | — | n/a |
| p02 | A | c2 | Vammo Series B funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p02 | A | c2 | MEV Series B funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p02 | A | c2 | Fever Electric Series B funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p02 | A | list | top venture capital firms investing in Electric mobility in Brazil | 10 | 1 | 0.0089 | 0.017 | — | no |
| p02 | A | list | list of Series B investors Electric mobility electric cargo vehicles Brazil | 10 | 1 | 0.0089 | 0.017 | — | no |
| p03 | A | short | Series A venture capital Semiconductor equipment United States Taiwan South Korea | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p03 | A | short | venture capital firm investing in metrology startups United States Taiwan South Korea | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p03 | A | short | Series A VC fund metrology advanced packaging United States Taiwan South Korea | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p03 | A | cat | Series A venture capital Semiconductor equipment United States Taiwan South Korea | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p03 | A | cat | venture capital firm investing in metrology startups United States Taiwan South Korea | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p03 | A | cat | Series A VC fund metrology advanced packaging United States Taiwan South Korea | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p03 | A | long | Series A investor for a startup building Inline laser-interferometric metrology tool for warpage and bump-height inspection in advanced semiconductor packaging in United States, Taiwan and South Korea | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p03 | A | long | venture capital firm that invests in companies like this: the company builds an inline optical metrology system that measures sub-micron warpage and bump coplanarity on wafers and panels during advanced packaging. | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p03 | A | long | hardware deep tech venture capital investing in Semiconductor equipment companies (metrology, advanced packaging, photonics) in United States, Taiwan and South Korea at Series A, round of about USD 15 million | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p03 | A | c1 | Series A startup Inline laser-interferometric metrology tool for warpage and bump-height inspection in advanced semiconductor packaging United States Taiwan South Korea | 10 | 1 | 0.0089 | 0.007 | — | n/a |
| p03 | A | c2 | AUROS Technology Inc. Series A funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p03 | A | c2 | EuQlid Series A funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p03 | A | c2 | OmniMeasure Technology Inc. Series A funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p03 | A | list | top venture capital firms investing in Semiconductor equipment in United States, Taiwan and South Korea | 10 | 1 | 0.0089 | 0.017 | — | no |
| p03 | A | list | list of Series A investors Semiconductor equipment metrology United States Taiwan South Korea | 10 | 1 | 0.0089 | 0.017 | — | no |
| p04 | A | short | pre-seed venture capital Enterprise software Canada United States | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p04 | A | short | venture capital firm investing in field service management startups Canada United States | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p04 | A | short | pre-seed VC fund field service management AI assistants Canada United States | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p04 | A | cat | pre-seed venture capital Enterprise software Canada United States | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p04 | A | cat | venture capital firm investing in field service management startups Canada United States | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p04 | A | cat | pre-seed VC fund field service management AI assistants Canada United States | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p04 | A | long | pre-seed investor for a startup building Voice-first AI assistant that answers field technicians' repair questions from a company's manuals and past work orders in Canada and United States | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p04 | A | long | venture capital firm that invests in companies like this: the company gives HVAC and elevator field technicians a hands-free assistant that retrieves answers from manuals, schematics and historical job tickets. | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p04 | A | long | venture capital investing in Enterprise software companies (field service management, AI assistants, knowledge management) in Canada and United States at pre-seed, round of about USD 0.6 million | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p04 | A | c1 | pre-seed startup Voice-first AI assistant that answers field technicians' repair questions from a company's manuals and past work orders Canada United States | 10 | 1 | 0.0089 | 0.007 | — | n/a |
| p04 | A | c2 | Quintess AI pre-seed funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p04 | A | c2 | Dartboard pre-seed funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p04 | A | c2 | Pairio (YC P26) pre-seed funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p04 | A | list | top venture capital firms investing in Enterprise software in Canada and United States | 10 | 1 | 0.0089 | 0.017 | 10 | sí |
| p04 | A | list | list of pre-seed investors Enterprise software field service management Canada United States | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p05 | A | short | Series B venture capital Building decarbonisation Netherlands Germany Belgium | 50 | 2 | 0.0178 | 0.047 | 1 | n/a |
| p05 | A | short | venture capital firm investing in heat pumps startups Netherlands Germany Belgium | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p05 | A | short | Series B VC fund heat pumps demand response Netherlands Germany Belgium | 50 | 2 | 0.0178 | 0.047 | 7 | n/a |
| p05 | A | cat | Series B venture capital Building decarbonisation Netherlands Germany Belgium | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p05 | A | cat | venture capital firm investing in heat pumps startups Netherlands Germany Belgium | 25 | 1 | 0.0089 | 0.022 | 9 | n/a |
| p05 | A | cat | Series B VC fund heat pumps demand response Netherlands Germany Belgium | 25 | 1 | 0.0089 | 0.022 | 3 | n/a |
| p05 | A | long | Series B investor for a startup building Heat-as-a-service for multi-family buildings: installed heat pumps plus software that shifts load for grid flexibility in Netherlands, Germany and Belgium | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p05 | A | long | venture capital firm that invests in companies like this: the company replaces gas boilers in apartment blocks with centralised heat pumps it owns and operates, charging housing associations a fixed monthly heat fee. | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p05 | A | long | climate venture capital investing in Building decarbonisation companies (heat pumps, demand response, energy-as-a-service) in Netherlands, Germany and Belgium at Series B, round of about USD 40 million | 25 | 1 | 0.0089 | 0.022 | 2 | n/a |
| p05 | A | c1 | Series B startup Heat-as-a-service for multi-family buildings: installed heat pumps plus software that shifts load for grid flexibility Netherlands Germany Belgium | 10 | 1 | 0.0089 | 0.007 | — | n/a |
| p05 | A | c2 | Enpal Series B funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p05 | A | c2 | vaestro Series B funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p05 | A | c2 | Sympower Series B funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p05 | A | list | top venture capital firms investing in Building decarbonisation in Netherlands, Germany and Belgium | 10 | 1 | 0.0089 | 0.017 | — | no |
| p05 | A | list | list of Series B investors Building decarbonisation heat pumps Netherlands Germany Belgium | 10 | 1 | 0.0089 | 0.017 | — | no |
| p06 | A | short | seed venture capital Cybersecurity Germany Austria Switzerland | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p06 | A | short | venture capital firm investing in OT security startups Germany Austria Switzerland | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p06 | A | short | seed VC fund OT security compliance automation Germany Austria Switzerland | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p06 | A | cat | seed venture capital Cybersecurity Germany Austria Switzerland | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p06 | A | cat | venture capital firm investing in OT security startups Germany Austria Switzerland | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p06 | A | cat | seed VC fund OT security compliance automation Germany Austria Switzerland | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p06 | A | long | seed investor for a startup building NIS2 compliance and OT asset-visibility platform for mid-sized manufacturers in Germany, Austria and Switzerland | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p06 | A | long | venture capital firm that invests in companies like this: the company passively maps operational-technology assets on factory networks and automatically generates the risk register and evidence needed for NIS2 compliance. | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p06 | A | long | specialist venture capital investing in Cybersecurity companies (OT security, compliance automation, asset inventory) in Germany, Austria and Switzerland at seed, round of about USD 3 million | 25 | 1 | 0.0089 | 0.022 | — | n/a |
| p06 | A | c1 | seed startup NIS2 compliance and OT asset-visibility platform for mid-sized manufacturers Germany Austria Switzerland | 10 | 1 | 0.0089 | 0.007 | — | n/a |
| p06 | A | c2 | Claroty seed funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p06 | A | c2 | MON5 seed funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p06 | A | c2 | OT InfraSec seed funding round investors | 10 | 1 | 0.0089 | 0.017 | — | no |
| p06 | A | list | top venture capital firms investing in Cybersecurity in Germany, Austria and Switzerland | 10 | 1 | 0.0089 | 0.017 | — | no |
| p06 | A | list | list of seed investors Cybersecurity OT security Germany Austria Switzerland | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p07 | B | short | Series A venture capital Agri-fintech Kenya Uganda Tanzania | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p07 | B | short | venture capital firm investing in input financing startups Kenya Uganda Tanzania | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p07 | B | short | Series A VC fund input financing mobile money credit Kenya Uganda Tanzania | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p07 | B | list | top venture capital firms investing in Agri-fintech in Kenya, Uganda and Tanzania | 10 | 1 | 0.0089 | 0.017 | — | no |
| p07 | B | list | list of Series A investors Agri-fintech input financing Kenya Uganda Tanzania | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p08 | B | short | pre-seed venture capital Digital health Nigeria | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p08 | B | short | venture capital firm investing in diagnostics access startups Nigeria | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p08 | B | short | pre-seed VC fund diagnostics access home sample collection Nigeria | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p08 | B | list | top venture capital firms investing in Digital health in Nigeria | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p08 | B | list | list of pre-seed investors Digital health diagnostics access Nigeria | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p09 | B | short | Series B venture capital B2B commerce India | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p09 | B | short | venture capital firm investing in B2B marketplace startups India | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p09 | B | short | Series B VC fund B2B marketplace textile supply chain India | 49 | 2 | 0.0178 | 0.047 | — | n/a |
| p09 | B | list | top venture capital firms investing in B2B commerce in India | 10 | 1 | 0.0089 | 0.017 | — | no |
| p09 | B | list | list of Series B investors B2B commerce B2B marketplace India | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p10 | B | short | seed venture capital Medical devices / health AI India | 50 | 2 | 0.0178 | 0.047 | 1 | n/a |
| p10 | B | short | venture capital firm investing in point-of-care ultrasound startups India | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p10 | B | short | seed VC fund point-of-care ultrasound medical imaging AI India | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p10 | B | list | top venture capital firms investing in Medical devices / health AI in India | 10 | 1 | 0.0089 | 0.017 | 4 | sí |
| p10 | B | list | list of seed investors Medical devices / health AI point-of-care ultrasound India | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p11 | B | short | Series A venture capital Distributed energy Vietnam Philippines | 50 | 2 | 0.0178 | 0.047 | 5 | n/a |
| p11 | B | short | venture capital firm investing in rooftop solar startups Vietnam Philippines | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p11 | B | short | Series A VC fund rooftop solar battery storage Vietnam Philippines | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p11 | B | list | top venture capital firms investing in Distributed energy in Vietnam and Philippines | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p11 | B | list | list of Series A investors Distributed energy rooftop solar Vietnam Philippines | 10 | 1 | 0.0089 | 0.017 | — | sí |
| p12 | B | short | pre-seed venture capital Industrial IoT Malaysia Indonesia | 49 | 2 | 0.0178 | 0.047 | — | n/a |
| p12 | B | short | venture capital firm investing in predictive maintenance startups Malaysia Indonesia | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p12 | B | short | pre-seed VC fund predictive maintenance vibration sensing Malaysia Indonesia | 50 | 2 | 0.0178 | 0.047 | — | n/a |
| p12 | B | list | top venture capital firms investing in Industrial IoT in Malaysia and Indonesia | 10 | 1 | 0.0089 | 0.017 | — | no |
| p12 | B | list | list of pre-seed investors Industrial IoT predictive maintenance Malaysia Indonesia | 10 | 1 | 0.0089 | 0.017 | — | no |

Oros (de cases/, sin cambios): p01 magmapartners.com, p02 lightrock.com, p03 celesta.vc, p04 golden.ventures, p05 worldfund.vc, p06 ecapital.vc, p07 novastarventures.com, p08 venturesplatform.com, p09 a91partners.com, p10 endiya.com, p11 seacef.org, p12 sginnovate.com.
