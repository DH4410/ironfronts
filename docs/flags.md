# Nation flags (September 1939)

Ironfronts resolves a flag per in-game country through `src/ui/flags.ts`
(`resolveFlagUrl(name)` / `createFlag(...)`). This document records what art each
entity gets and why.

The game partitions the 1939 world into 200 selectable countries. Only some are sovereign 1939 belligerents; many are gameplay subdivisions (US, Brazilian, and Australian states; Soviet regions; and Chinese cliques) that never had a separate national flag. **Every country has a flag chit.** A subdivision uses the flag of its historical sovereign or administering power, so it is identifiable without claiming it had an independent flag.

## Resolution rules

| Entity kind | Flag shown |
|---|---|
| Sovereign belligerent | Its own 1939 flag |
| Real colony / mandate / protectorate | Flag of the power that administered it in 1939 |
| Gameplay subdivision | Flag of its historical sovereign or administering power |
| Unknown input (not a country in this scenario) | Colour standard |

## Vendored period flags

All files below are in the **public domain** (PD-old: pre-1929 designs and/or
government works whose copyright has expired). Each is vendored verbatim from
Wikimedia Commons into `src/ui/assets/flags/` with a source + licence comment in
the file. Retrieved 2026-08-30 via `commons.wikimedia.org/wiki/Special:FilePath/`.

| File | Entity | Design / era | Commons source |
|---|---|---|---|
| `de-1935-1945.svg` | Germany | National flag 1935–1945 (red field, white disc, black swastika) | `File:Flag of Germany (1935–1945).svg` |
| `it-1861-1946.svg` | Italy, Libya | Kingdom of Italy tricolour with Savoy arms | `File:Flag of Italy (1861–1946).svg` |
| `su-1936-1955.svg` | (Soviet-territory entities, if mapped) | USSR state flag 1936–1955 | `File:Flag of the Soviet Union (1936–1955).svg` |
| `gr-1935-1970.svg` | Greece | Royalist land flag (blue field, white cross), restored 1935 | `File:Flag of Greece (1822–1978).svg` |
| `yu-1918-1941.svg` | Yugoslavia | Kingdom of Yugoslavia blue-white-red | `File:Flag of the Kingdom of Yugoslavia.svg` |
| `eg-1922-1958.svg` | Egypt | Kingdom of Egypt (green, crescent + 3 stars) | `File:Flag of Egypt (1922–1958).svg` |
| `iq-1921-1959.svg` | Iraq | Kingdom of Iraq 1921–1959 | `File:Flag of Iraq (1921–1959).svg` |
| `ir-1925-1979.svg` | Persia | Imperial state flag with Lion and Sun | `File:State Flag of Iran (1933-1964).svg` |
| `za-1928-1994.svg` | South Africa | Union of South Africa 1928–1994 ("oranje-blanje-blou") | `File:Flag of South Africa (1928–1994).svg` |
| `et-empire.svg` | Ethiopia | Ethiopian Empire, Lion of Judah | `File:Flag of Ethiopia (1897-1974).svg` |
| `cn-roc.svg` | Nationalist China | Republic of China, "Blue Sky with a White Sun" | `File:Flag of the Republic of China.svg` |
| `manchukuo.svg` | Manchukuo | Japanese puppet state 1932–1945 | `File:Flag of Manchukuo.svg` |

The project also vendors flat SVG country art from [flag-icons](https://github.com/lipis/flag-icons), version 7.5.0, under its MIT licence. The licence text is included as src/ui/assets/flags/FLAG-ICONS-LICENSE.txt. The existing period-specific art remains preferred for historical entities. The remaining flat flag-icons art is a compact visual identifier; small emblems and star counts can differ from the period version at the icon sizes used by the UI.

## Country coverage

France: Algeria, Tunisia, French West/Central African regions, Madagascar, Syria, Indochina, Tahiti, and New Caledonia.
United Kingdom: British African, Indian, South-East Asian, and Pacific territories. Belgium: Belgian Congo. Portugal: Portuguese African territories. Italy: Libya, Somalia, and Eritrea. US, Canadian, Brazilian, Argentine, Australian, Japanese, Dutch East Indies, and Soviet regional entries use their corresponding national flag.

There are no scenario-country gaps: the test suite checks every name in the authoritative 200-country world roster has both a mapping and a vendored SVG.

## Research provenance

The entity categorisation (sovereign / colony / fictional) and candidate flags
were produced by a Codex (`gpt-5.3-codex`, medium effort, read-only) research
pass over the exact 200-country roster, then spot-checked against Wikimedia Commons and the bundled Flag Icons source
before vendoring. Notable corrections during review: Codex's Ethiopia and
Romania Commons links pointed at modern files; the period files above were used
instead. Low-confidence rows (Communist China, the cliques, Tibet, Syria, and
Burma) now use the parent flag stated in the country coverage rule above.
