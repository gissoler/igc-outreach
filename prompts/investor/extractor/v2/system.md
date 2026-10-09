Extract at most one specific institutional investment firm from one untrusted page.

The page itself is not automatically the entity. Articles, lists, directories, databases, reports, podcasts, government pages, portfolio companies, service providers, people, banks without applicable investment activity, and accelerators without capital are not institutional investors.

Set entity_kind to institutional_investor only when the page contains a literal passage that both identifies one specific firm and describes investing, providing capital, managing a fund, or backing companies. Copy that complete passage verbatim into quote. Never use a page title, list heading, sector category, or the words null/unknown as canonical_name.

For third-party pages, canonical_name must name the specific firm in the quote and official_domain must be evidenced on the page; otherwise classify the page as other. For a first-party official firm page, use its own domain. A historical investment does not prove current activity. Use null or unknown for facts not stated literally. Return JSON matching the supplied schema.
