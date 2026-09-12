# Nation flags (September 1939)

Ironfronts resolves flags through `src/ui/flags.ts` and stores the artwork in
`src/ui/assets/flags/`. Because the scenario starts in **September 1939**, the
registry prefers period-appropriate flags instead of silently showing modern
national flags.

The world package contains roughly 200 gameplay entities. Some are real states,
protectorates, colonies or mandates; others are intentionally split gameplay
regions such as California, Queensland, Soviet macro-regions and Brazilian
regions. We do **not invent national flags** for those fictional subdivisions.
They continue to render a colour standard.

## Resolution rules

| Entity kind | Flag shown |
|---|---|
| Real sovereign / period state | Its 1939-era flag |
| Protectorate with a documented local flag | Its documented period flag |
| Colony / mandate without a useful distinct period flag | Administering power's 1939 flag |
| Fictional gameplay subdivision / unresolved case | Colour standard |

## Existing core period flags

These were already present before this expansion: `de-1935-1945.svg` for Germany 1935–1945, Kingdom of
Italy, Soviet Union 1936–1955, Kingdom of Greece, Kingdom of Yugoslavia, Kingdom
of Egypt, Kingdom of Iraq, imperial Persia/Iran, Union of South Africa,
Ethiopian Empire, Republic of China and Manchukuo.

Unchanged period designs already supplied by the existing flag-icons set cover
the United Kingdom, France, Finland, Portugal, Belgium, Netherlands,
Switzerland, Austria, Denmark, Norway, Ireland, Iceland, Bulgaria and several
other states.

## Historical flags added in this pass

| File | In-game use | Historical treatment | Source / licence |
|---|---|---|---|
| `es-1938-1945.svg` | Spain | Nationalist state flag, 1938–1945 | Wikimedia Commons; CC BY-SA 4.0, SanchoPanzaXXI |
| `af-1931-1973.svg` | Afghanistan | Kingdom of Afghanistan | Wikimedia Commons; public domain |
| `lt-1918-1940.svg` | Lithuania | independent Lithuania tricolour | Wikimedia Commons; public domain |
| `np-pre1962.svg` | Nepal | pre-1962 double-pennon flag | Wikimedia Commons; CC BY-SA 3.0, Orange Tuesday |
| `sy-1930-1958.svg` | Syria | Syrian Republic flag | Wikimedia Commons; public domain |
| `tibet-1916-1951.svg` | Tibet | historical Tibetan flag | Wikimedia Commons; CC BY-SA 4.0, Felipe Fidelis Tobias |
| `ph-1936-1985.svg` | Philippines | 1936-era geometry with period navy-blue shade | Commons historical design / public-domain reconstruction |
| `brunei-1906-1959.svg` | Brunei | yellow flag with black/white diagonal, 1906–1959 | Wikimedia Commons; public domain |
| `mengjiang-1939-1945.svg` | Mengjiang | seven-stripe flag adopted 1 Sep 1939 | Wikimedia Commons; public domain |
| `ve-1930-2006.svg` | Venezuela | seven-star 1930 design | Wikimedia Commons; public domain |
| `bo-1851.svg` | Bolivia | red-yellow-green tricolour used since 1851 | Wikimedia Commons; public domain |
| `om-muscat.svg` | Oman | Muscat plain-red period flag | Wikimedia Commons; public domain |
| `au.svg` | Australian-administered territory | Australian flag | Wikimedia Commons; public domain |
| `cl.svg` | Chile | period-valid design | Wikimedia Commons; public domain |
| `co.svg` | Colombia | period-valid design | Wikimedia Commons; public domain |
| `ec.svg` | Ecuador | period-valid state design | Wikimedia Commons; public domain |
| `lr.svg` | Liberia | period-valid design | Wikimedia Commons; public domain |
| `ma.svg` | Morocco | red/green-pentagram design adopted 1915 | Wikimedia Commons; public domain |
| `pa.svg` | Panama | period-valid design | Wikimedia Commons; public domain |
| `pe-civil.svg` | Peru | historically valid red-white-red civil/national flag | Wikimedia Commons; public domain |
| `th.svg` | Siam | tricolour introduced in 1917 | Wikimedia Commons; public domain |
| `tn.svg` | Tunisia | long-standing Tunisian design | Wikimedia Commons; public domain |
| `uy.svg` | Uruguay | period-valid design | Wikimedia Commons; public domain |

Most source SVGs came through the open-source
`Pr1nted/Open-Doctrines` flag corpus. Its generated licence audit traces the
art to Wikimedia Commons. The Commons URL and licence are also embedded at the
top of every newly vendored historical SVG, so provenance survives even if the
file is copied elsewhere.

## Additional 1939 territorial mappings

The resolver now also gives historically useful administration markers to many
entities that do not need invented flags: British Guiana/Guyana, Río de Oro,
Portuguese Guinea, French Niger, French Cameroun, Chad, South West Africa,
Saint Helena, Mozambique, Northern Rhodesia, Kenya, Somalia, Eritrea, British
Bengal/Bangladesh, Papua New Guinea, Sumatra, Nusa Tenggara, Greenland,
Falkland, Newfoundland, Galápagos, Tahiti, Malta, Malaya/Malaysia, the Japanese
South Seas Mandate regions, New Caledonia, Fiji, Samoa, Solomon Islands,
Okinawa, the Kurils and Ceylon.

This expands visual coverage without pretending every gameplay partition was an
independent country.

## Deliberate standards / unresolved historical cases

These remain a colour standard until a defensible lightweight period asset is
added:

- **Albania** — use the exact 1939–1943 royal/protectorate-era treatment rather
  than silently falling back to the modern flag.
- **Mongolia** — the scenario date sits immediately before a documented 1940
  design change; do not substitute a 1940–1945 flag.
- **Qatar** — the 1936–1949 serrated/inscribed flag differs significantly from
  today's flag.
- **Paraguay** — the 1842–1954 arms variant should be used rather than today's
  coat-of-arms artwork.
- **Belarus / Ukraine and Soviet macro-regions** — remain gameplay standards
  until the scenario decides whether constituent-SSR flags or a USSR
  administrative marker is preferable.
- **Communist China / Ma Clique / Sichuan / Xinjiang and other Chinese gameplay
  regions** — no invented national flags for ambiguous 1939 entities.
- **Korea / Taiwan** — intentionally remain neutral colour standards rather
  than presenting the Japanese occupation flag as though it were a Korean or
  Taiwanese national flag. Ownership can be shown elsewhere in the UI.
- **Borneo** — the island was split between Dutch, British and Bruneian
  jurisdictions; one flag would be misleading.
- **Vanuatu** — the Anglo-French condominium makes a single administrator flag
  misleading.

The Saudi icon is also still the existing modern vector. A future pass should
replace it with the exact 1938–1973 calligraphy variant.

## Licensing

Public-domain assets may be redistributed without an attribution obligation,
but provenance is kept anyway. CC BY-SA assets retain their attribution and
share-alike requirements; do not strip their source/licence comments while
optimizing SVGs.

## Maintenance rule

When adding a flag:

1. Verify that the design was actually in use in **September 1939**.
2. Prefer Wikimedia Commons or another source with a clear reusable licence.
3. Put the asset in `src/ui/assets/flags/`.
4. Add the country mapping in `src/ui/flags.ts`.
5. Record source + licence here and in historical SVG comments.
6. Do not hand-edit `src/game/data/countries.generated.ts`; it is generated
   from the world package.
7. If no defensible flag exists, keep the colour standard rather than inventing
   one.

## Known gaps

Albania, Mongolia, Qatar and Paraguay are the main real-country gaps after this
pass. Some colonial ensigns could later replace administering-power markers if
that extra historical detail is worth the additional art and maintenance.
