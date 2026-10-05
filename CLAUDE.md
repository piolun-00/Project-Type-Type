# Szlifiernia — kontekst projektu

Ten plik opisuje, co to za projekt, jak działa i jakie decyzje już zapadły (wraz z powodami). Czytaj go przed każdą zmianą. Sekcja „Historia błędów” mówi, czego nie cofać.

## Właściciel i sposób pracy

- Właściciel: Radek Prośniak, studio KHOREI (Kraków). Projektant na poziomie eksperckim: branding, identyfikacja, UX/UI, typografia.
- **Nie zna składni języków programowania**, ale rozumie logikę i algorytmy. Opisuje, co chce osiągnąć, a technologię i podejście dobierasz ty.
- Komunikacja **po polsku**. Tłumacz „dlaczego”, nie tylko „jak”. Każdą zmianę w kodzie opisz zwykłym językiem: co robi i czemu tak. Proaktywnie proponuj lepsze rozwiązania, jeśli je widzisz.
- Testuje sam w przeglądarce i odsyła zrzuty ekranu. Po każdej zmianie powiedz krótko, co sprawdzić.
- Przy większych funkcjach woli najpierw dostać plan (zakres, kolejność, decyzje do podjęcia), a dopiero potem budowę.

## Czym jest Szlifiernia

Narzędzie przeglądarkowe do zaokrąglania narożników fontów i plików SVG. Inspiracją jest krój **Marund** (26a1.xyz), który ma trzy osie zaokrągleń: RND1 „Rounded End”, RND2 „Rounded Edge Out”, RND3 „Rounded Edge In”. Szlifiernia przenosi tę logikę na dowolny font lub SVG:

- **Zakończenia** — końce kresek (półkole o średnicy kreski przy 100),
- **Narożniki zewnętrzne** — wypukłe,
- **Narożniki wewnętrzne** — wklęsłe (zaokrąglenie dodaje farby).

Wszystko działa w przeglądarce. Pliki nie są nigdzie wysyłane. Użytkownik przed wgraniem zaznacza checkbox, że ma licencję na modyfikację pliku — odpowiedzialność prawna leży po jego stronie.

Projekt powstał jako prototyp w czacie Claude (wersje 0.1–0.13). To repozytorium jest pierwszą samodzielną wersją webową.

## Uruchomienie i testy

- Bez budowania: `index.html` ładuje kolejno `vendor/opentype.min.js`, `vendor/paper-core.min.js`, `src/core.js`, `src/vf.js`, `src/app.js` (zwykłe skrypty, nie moduły ES). Działa po otwarciu pliku albo przez `npm start` / `python3 -m http.server`.
- `npm install && npm test` — 35 testów (`tests/run.js`). Budują font testowy z prostych kształtów (M, A, K, E), zaokrąglają go i eksportują do `tests/out/`.
- Walidacja plików: `pip install opentype-sanitizer`, potem `python -m ots tests/out/test-rounded.otf` i `python -m ots tests/out/test-vf.ttf`. OTS to ten sam walidator, którego używają Chrome i Firefox.
- CI: `.github/workflows/deploy.yml` — testy + OTS, a po sukcesie publikacja na GitHub Pages (`_site` z plikami strony).
- **W repozytorium nie ma żadnych licencjonowanych fontów i ma tak zostać.** Właściciel testuje na własnych fontach, m.in. Marund (ma licencję).
- Krój interfejsu i domyślny font podglądu to **ABC Areal** (ABC Dinamo). Pliki leżą w katalogu `fonts/`, który jest w `.gitignore` — **nigdy ich nie commituj**. Gdy katalogu nie ma (np. na opublikowanej stronie), interfejs spada na systemowy stos bezszeryfowy, a podgląd zostaje na kształtach demo. Potrzebne pliki: `ABCAreal-{Regular,RegularItalic,Medium,MediumItalic,Bold,BoldItalic}.woff2` do interfejsu, `ABCArealMono-{Regular,Medium,Bold}.woff2` do przypisów i liczb, oraz `ABCAreal-Bold.ttf` jako domyślny font podglądu (opentype.js nie czyta WOFF2). Start aplikacji ustawia widok „Wszystkie glify”.
- Domyślny font wczytuje się przez `fetch`, więc **wymaga serwera** (`npm start` albo `python3 -m http.server`). Po dwukliku w `index.html` protokół `file://` blokuje `fetch` i zostają kształty demo.
- Do testów interfejsu w trakcie prototypu dobrze sprawdzał się Playwright (Chromium headless): wczytanie fontu przez `set_input_files('#file', …)`, klikanie, zrzuty ekranu.

## Struktura

| Plik | Rola |
|---|---|
| `src/core.js` | Silnik geometrii, bez zależności. Eksportuje `window.RounderCore` (w Node: `module.exports`): `commandsToContours`, `analyze`, `round`, `toPathData`, `estimateStroke`, `estimateStrokeScan`. |
| `src/vf.js` | Zapis fontów, bez zależności. `window.RounderVF`: `buildVariableFont`, `readTables`, `injectTables`, `layoutTables`, `buildSfnt`. |
| `src/app.js` | Cały interfejs w jednym IIFE: stan, parser SVG, łączenie konturów, podgląd, edycja glifu, korekty, edytor konturu, historia, autozapis, eksport. |
| `index.html`, `styles.css` | Struktura i wygląd. Tokeny kolorów w `:root`, tryb ciemny przez `prefers-color-scheme`. |
| `zasady.html` | Zasady korzystania (prywatność, licencje fontów, brak gwarancji). |
| `vendor/` | opentype.js 1.3.4 i paper.js 0.12.18 (core), licencje MIT w `THIRD_PARTY_NOTICES.txt`. |

Współrzędne w silniku są w jednostkach fontu, oś Y w górę. Odwracanie do ekranu dzieje się dopiero przy rysowaniu (`toPathData(..., flipY)`).

## Silnik zaokrąglania (`src/core.js`)

**1. `commandsToContours(cmds, ref)`** — komendy ścieżki (M/L/Q/C/Z) zamienia na kontury z odcinków 3. stopnia. Porządki:
- usuwa odcinki zdegenerowane (zerowej długości),
- krzywe faktycznie proste zamienia na linie,
- skleja współliniowe linie.

`ref` to skala odniesienia (upm fontu albo średnia geometryczna wymiarów SVG).

**2. `analyze(contours, opts, ref)`** — wykrywa i klasyfikuje narożniki.
- **Mikroodcinki** krótsze niż `mergeTol` są zbijane razem z narożnikami po obu stronach w jeden **węzeł** (`joint`). Położenie węzła to średnia punktów, a kąt to łączny obrót kierunku. To rozwiązuje „podwójne wektory”.
- Węzeł jest narożnikiem, jeśli kierunek łamie się o co najmniej `angleMin` (domyślnie 15°). Punkty z `opts.forcePts` mają niższy próg: 2° dla punktów przecięć po łączeniu konturów, 0,5° dla narożników wymuszonych ręcznie (`manual: true` → `corner.forced`).
- **Wypukły czy wklęsły** — test farby: punkt odsunięty o mały krok wzdłuż dwusiecznej kąta i sprawdzenie, czy leży w wypełnieniu (reguła nonzero/evenodd). Celowo nie liczymy kierunku obiegu, bo TrueType, CFF i SVG mają różne konwencje.
- **Zakończenie kreski**: prosty odcinek między dwoma wypukłymi narożnikami, które razem obracają kierunek o ~180° (±`endTol`), o długości ≤ `endMax`. Oba narożniki dostają typ `end` i `endLen`.
- Wynik: dla każdego konturu `{ segs, luts, real, joints, corners }`. `joints[k].v` to położenie węzła (także dla węzłów niebędących narożnikami — to szare kółka w interfejsie).

**3. `round(analysis, params, ref, fixed, decide, ovr)`** — buduje zaokrąglony kontur.
- **Ile przyciąć** przy narożniku (`want`):
  - `end`: `g · endLen / 2`,
  - `out`: `g · rOut · min(tan(θ/2), tanMax)`,
  - `in`: `g · rIn · min(tan(θ/2), tanMax)`.

  `g` to wartość suwaka 0–1 albo wartość z korekty. `tanMax` to suwak „Rozlanie w ostrych kątach”.
- **Budżet odcinka**: jeśli łuki z obu końców chcą razem więcej niż długość odcinka, oba są skalowane. Przycięcie jest **symetryczne**: `d = want · min(f_prev, f_next)`.
- **Wtapianie kikutów**: odcinek krótszy niż `absorbMax`, na którym łuki się nie mieszczą, jest pochłaniany. Zamiast dwóch ściśniętych łuków powstaje jedna krzywa, której punkty kontrolne celują w pierwotne wierzchołki (`tau = min(1, 0.9·tension)`). Nigdy nie dotyczy odcinka między dwoma zakończeniami (to zamierzone półkole). Korekta narożnika może wtapianie wymusić albo zablokować.
- **Łuk**: krzywa 3. stopnia między punktami przycięcia. Uchwyty liczone są z **rzeczywistych stycznych w tych punktach i cięciwy**: `h = tension · chord · (4/3)·tan(φ/4) / (2·sin(φ/2))`, przycięte do punktu przecięcia stycznych (żeby nie było pętli).
- `ovr[kontur][węzeł] = { type, g, absorb }` — korekty ręczne (typ `end|out|in|off`, wartość, wtapianie `on|off`).
- `fixed = true` (dla fontu zmiennego): każdy narożnik zawsze dostaje krzywą (przy 0 zdegenerowaną do punktu), każdy odcinek zawsze jest zapisany. Struktura punktów jest identyczna dla wszystkich wartości. `decide` to parametry, przy których zapada decyzja o wtapianiu (maksimum osi).

**4. Grubość kreski** — `estimateStrokeScan`: przekroje poziome przez l, I, H, n, i, m, u (dla SVG także pionowe), 40. percentyl długości odcinków „w farbie”. Promienie (`rOut`, `rIn`) są mnożnikami grubości kreski, więc ustawienia przenoszą się między krojami i gramaturami. Można ją nadpisać ręcznie w Precyzji.

## Łączenie nakładających się konturów (`prepCmds` w `app.js`)

Ogonki ą/ę i kreska Ł bywają osobnymi, nakładającymi się konturami. Wtedy miejsce styku nie jest narożnikiem, a zaokrąglanie robi wcięcia.

Rozwiązanie: paper.js `resolveCrossings().reorient(nonzero, true)`, uruchamiane tylko wtedy, gdy prostokąty otaczające konturów się przecinają (wydajność). Punkty, których nie było w oryginale (przecięcia), trafiają do `forcePts`, czyli zawsze są narożnikami. Przełącznik „Łącz nachodzące kontury” w Precyzji.

## Zapis fontów (`src/vf.js` i `exportFont` w `app.js`)

**Font statyczny (widoczny w interfejsie):**
- opentype.js zapisuje `.otf` z krzywymi CFF,
- **współrzędne zaokrąglane do liczb całkowitych** (patrz Historia błędów),
- nazwa PostScript transliterowana do ASCII,
- do pliku wstrzykiwane są z oryginału: `cmap` oraz `GSUB/GPOS/GDEF` — kolejność glifów jest zachowana, więc kerning i funkcje OpenType działają,
- wynik w ZIP-ie razem z README (ustawienia i nota licencyjna oryginału).

**Font zmienny (zaimplementowany, ukryty — `#expVF` ma `hidden`):**
- TrueType `glyf` + `gvar` + `fvar` + `STAT`, trzy osie `RNDE`, `RNDO`, `RNDI` w zakresie 0–100,
- siatka mistrzów 0/½/1 na każdej osi (27 mistrzów), regiony „namiotowe”, delty z odwrócenia Möbiusa. Środkowy poziom łapie nieliniowość (gdy łuki zaczynają się ograniczać nawzajem),
- krzywe 3. stopnia → 2. stopnia ze stałą liczbą kawałków na odcinek we wszystkich mistrzach,
- nazwane instancje: Sharp, Ends, Outer, Inner, kombinacje, Round oraz Custom (aktualne suwaki),
- zweryfikowany przez fontTools (instancje = podgląd) i OTS. Właściciel poprosił o ukrycie „na razie”.

**SVG**: kontury jako krzywe, z ustawieniami zapisanymi w komentarzu.

## Interfejs (`src/app.js`)

**Tryby i widoki**
- `state.mode`: `font` albo `svg` (demo z oryginalnymi kształtami albo wgrany SVG; parser obsługuje path/rect/circle/ellipse/polygon/polyline z transformacjami przez `getScreenCTM`, a pomija obrysy, tekst i `<use>`, z komunikatem).
- Widoki fontu: **Tekst**, **Wszystkie glify** (siatka, maks. 800 glifów), **Edycja glifu** z trybami **Narożniki** i **Kontur**.

**Zasady interakcji uzgodnione z właścicielem — nie zmieniać bez pytania:**
- *Wszystkie glify*: przeciąganie przesuwa podgląd (start po 4 px ruchu). Krótki klik w glif otwiera edycję. Po przeciągnięciu klik nie otwiera glifu.
- *Tekst*: przeciąganie przesuwa, klik w glif otwiera edycję.
- *Edycja glifu*: **zwykłe przeciąganie nic nie robi**. Przybliżanie: Ctrl/Cmd + kółko lub szczypanie (wokół kursora), suwak Skala (100% = dopasowany), klawisze `+`, `−`, `0`. Przesuwanie: kółko albo **spacja + przeciągnięcie**.
- Glif wyśrodkowany. **Siatka wypełnia cały obszar**, a teksty (podpisy linii metrycznych, podpowiedź, zdanie) są **wyrównane do lewej**.
- Na dole przykładowe zdanie: pangram zawierający edytowany znak oraz linia kontrolna (`nXn oXo XXX`). **Litery w zdaniu są klikalne** i przełączają edytowany glif.
- **Szare puste kółka** to węzły, które nie są narożnikami. Właściciel chce, żeby były **widoczne** — nie ukrywać.
- Znaczniki narożników stoją w **pierwotnych** położeniach wierzchołków, nie na zaokrąglonym kształcie.
- Kolory kategorii (te same w suwakach i znacznikach): zakończenia `--end` niebieski, zewnętrzne `--out` zielony, wewnętrzne `--in` różowy, ostry (korekta) szary.

**Siatka** (`renderGrid`): krok dobierany do powiększenia (1, 2, 5, 10, 20, 25, 50… j., co najmniej 9 px), linie główne co 5 lub 10 kroków. Linie metryczne z OS/2 (`sxHeight`, `sCapHeight`) lub mierzone z „x” i „H”, plus ascender i descender. Przełącznik „Siatka”.

**Korekty** — `state.ovr['g' + indeksGlifu]`:
```
{ scale,                                   // mnożnik całego glifu, % ustawień globalnych
  nodes: [{ x, y, type, mode, amt, absorb }],  // type: auto|end|out|in|off; mode: rel (% suwaka) | abs (zamrożona)
  force: [{ x, y }],                       // wymuszone narożniki
  path, pk }                               // poprawiony kontur (komendy M/L/C/Z, liczby całkowite) i jego hash do cache
```
- Korekty są przypisane do **położenia** węzła w jednostkach fontu, nie do numeru. Tolerancja: `max(2, 0,3% em)`.
- Korekty, które nie trafiają w żaden narożnik (np. po zmianie progów), są pokazywane jako osierocone z przyciskiem usunięcia.
- Przełączenie siły względna ↔ zamrożona przelicza wartość tak, żeby kształt się nie zmienił.
- Wszystko, co czyta kontur glifu, musi iść przez `glyphCmds(g)` (poprawiony kontur albo oryginał). Wyjątki: pomiar grubości kreski i nakładka „Oryginał”.

**Edytor konturu**
- `toNodes` / `fromNodes`: węzły `{ x, y, in, out }` z uchwytami krzywych 3. stopnia. Przy wczytaniu: domknięcie konturu, usunięcie podwójnych węzłów, uchwyty w miejscu węzła traktowane jako brak uchwytu.
- „Gładki” nie jest zapisany jako flaga — wynika ze współliniowości uchwytów (`isSmooth`, tolerancja 3°).
- Operacje:
  - przeciąganie węzłów i uchwytów (przechwycenie wskaźnika na `.stage`),
  - Alt rozrywa uchwyty węzła gładkiego,
  - strzałki przesuwają o 1, Shift + strzałka o 10,
  - dwuklik na odcinku wstawia węzeł (de Casteljau, bez zmiany kształtu),
  - Backspace usuwa węzeł,
  - Wygładź / Wyprostuj,
  - pola X/Y,
  - przywrócenie oryginału.
- **Korekty narożników jadą razem z przesuwanym węzłem** (`collectCorr`).
- Kontur jest przechowywany jako krzywe 3. stopnia, więc TrueType jest konwertowany przy pierwszej edycji.

**Historia, autozapis, ustawienia**
- Cofnij/ponów: migawki `{ p, ovr }` w JSON, łączenie zmian w odstępie < 700 ms (przeciągnięcie suwaka = jeden krok). Skróty Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y.
- Autozapis w `localStorage` pod kluczem `szlifiernia:<hash pliku>` (FNV), z propozycją przywrócenia po ponownym wgraniu tego samego pliku.
- Eksport i import ustawień jako JSON (`settingsObj`), z ostrzeżeniem, gdy pochodzą z innego pliku.

**Ustawienia domyślne** (`DEF`):
```
end 0, out 0, in 0, kOut 1, kIn 0.6, tanMax 4, tension 1,
angleMin 15°, endTol 15°, endMax 30% em, merge 0.8% em, absorb 10% em
```
**Scalanie i wtapianie są w % em — decyzja właściciela.** Próbowaliśmy „× grubość kreski”, właściciel kazał wrócić do em.

## Historia błędów — nie cofać

1. **Skos zamiast łuku na krzywych bokach (noga R).** Uchwyty liczone z kąta pierwotnego narożnika zamiast z rzeczywistych stycznych dawały prawie proste łuki. Naprawione w 0.9: uchwyty z cięciwy i stycznych.
2. **Asymetryczne przycinanie** (pełne przycięcie po stronie z miejscem) — sprawdzone i odrzucone, dawało rozciągnięte, eliptyczne łuki. Zostaje symetryczne.
3. **Wtapianie bez limitu długości** robiło z liter wielkie rozlane plamy. Wtapianie dotyczy tylko krótkich kikutów (`absorbMax`).
4. **Niedomknięte kontury w eksporcie .otf** (do 8 jednostek). Zapis CFF w opentype.js kumuluje błąd przy ułamkowych współrzędnych. Zawsze zaokrąglać do liczb całkowitych przed `new opentype.Path()`.
5. **Polskie litery w nazwie rodziny psuły CFF** (nazwa PostScript musi być ASCII) → `slug()`. Tabela `cmap` generowana przez opentype.js bywała niepoprawna → kopiujemy `cmap` z oryginału.
6. **Podwójne wektory** — zdegenerowane odcinki (np. w ostrej instancji Marunda) blokowały zaokrąglenie czubków. Rozwiązanie: scalanie mikroodcinków w węzły.
7. **Przechwycenie wskaźnika przy `pointerdown`** psuło kliknięcia i dwukliki (zdarzenia trafiały w `.stage`). Przechwytywać dopiero po ruchu ≥ 4 px.
8. **`[hidden]` nie działał na `.btn`** (`display: inline-flex` wygrywało). Jest globalna reguła `[hidden]{display:none!important}`.

## Znane ograniczenia i lista pomysłów

**Ograniczenia**
- Font zmienny jako **źródło**: opentype.js czyta tylko instancję domyślną (dla Marunda: Sharp 300). Wyciąganie instancji wymagałoby np. fontkit.
- WOFF2 nieobsługiwany (możliwy dekoder w WebAssembly). Z WOFF nie da się skopiować tabel układu, więc kerning przepada.
- Znaki z akcentami nie dziedziczą korekt ani zmian konturu z liter bazowych (R → Ř, Ŕ).
- Tryb SVG: korekty działają w silniku, ale nie ma interfejsu edycji.
- Eksport dużych fontów liczy się w wątku głównym (kandydat na Web Worker).

**Zaproponowane, czeka na decyzję właściciela**
- Przyciąganie do siatki i linii metrycznych w edytorze konturu; zaznaczanie ramką.
- Własne zdanie kontrolne zamiast pangramu (np. nazwa marki).
- Podział Precyzji na „Wygląd” (promienie, rozlanie, napięcie) i zwiniętą sekcję „Wykrywanie” (progi, tolerancje, porządki).
- **Rodziny fontów**: wiele plików naraz, ustawienia globalne, suwak „kompensacja gramatur” (0 = promień proporcjonalny do kreski, 1 = wspólny promień w jednostkach), widok całej rodziny, wyjątki per odmiana, spójne nazewnictwo (name ID 1/2/16/17), eksport ZIP. Fonty zmienne wyłączone z tego etapu.
- Ponowne włączenie fontu zmiennego, docelowo czteroosiowego (waga + 3 zaokrąglenia). Wymaga zgodnych mistrzów źródłowych i wspólnego wykrywania narożników.
- Angielska wersja interfejsu, licencja kodu (do decyzji), własna domena (np. `szlifiernia.khorei.pl`).

## Konwencje

- Teksty interfejsu po polsku, wielka litera tylko na początku zdania, bez etykiet WIELKIMI LITERAMI. Komunikaty o błędach mówią, co się stało i co zrobić.
- Krój interfejsu: Schibsted Grotesk (Google Fonts), z bezpiecznym zapasowym stosem.
- Zostajemy przy projekcie bez budowania i bez frameworka. Biblioteki w `vendor/` mają przypięte wersje.
- Każda zmiana w silniku lub eksporcie: `npm test` + OTS na wygenerowanych plikach. Nowy błąd naprawiony = nowy test w `tests/run.js`.
