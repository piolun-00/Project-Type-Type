# Type Type

Narzędzie do zaokrąglania narożników fontów i plików SVG — w trzech kategoriach, jak w kroju Marund: zakończenia kresek, narożniki zewnętrzne i narożniki wewnętrzne. Do tego ręczne korekty pojedynczych narożników, prosty edytor konturu i eksport gotowego fontu.

Cała praca odbywa się w przeglądarce. Pliki nie są nigdzie wysyłane, a strona nie ma serwera ani bazy danych — to zestaw statycznych plików.

## Co potrafi

- wczytanie fontu (TTF, OTF, WOFF) lub pliku SVG,
- automatyczne wykrywanie narożników i ich klasyfikacja: zakończenia, zewnętrzne, wewnętrzne,
- trzy główne suwaki zaokrąglenia oraz sekcja Precyzja (promienie, rozlanie, napięcie łuku, progi wykrywania),
- łączenie nakładających się konturów (ogonki ą, ę, kreska Ł), scalanie podwójnych węzłów, wtapianie krótkich kikutów,
- widok wszystkich glifów, edycja pojedynczego glifu z przykładowym zdaniem, siatką i liniami metrycznymi,
- korekty pojedynczych narożników (typ, siła względna lub zamrożona, wtapianie, wymuszanie narożnika),
- edytor konturu: przesuwanie węzłów i uchwytów, dodawanie i usuwanie węzłów, wygładzanie,
- cofanie i ponawianie, autozapis w przeglądarce, zapis i wczytywanie ustawień (JSON),
- eksport: font statyczny `.otf` (z kerningiem i funkcjami OpenType oryginału) oraz SVG.

Eksport fontu zmiennego jest zaimplementowany (`src/vf.js`), ale na razie ukryty w interfejsie.

## Struktura projektu

```
index.html                 strona aplikacji
zasady.html                zasady korzystania (prywatność, licencje fontów)
styles.css                 wygląd
src/core.js                silnik geometrii: wykrywanie i zaokrąglanie narożników
src/vf.js                  zapis fontów: font zmienny TrueType, tabele, sklejanie pliku
src/app.js                 interfejs: podgląd, edycja glifu, edytor konturu, eksport
vendor/                    biblioteki zewnętrzne (opentype.js, paper.js) — licencja MIT
tests/run.js               testy automatyczne silnika i eksportu
.github/workflows/         testy i publikacja na GitHub Pages
THIRD_PARTY_NOTICES.txt    licencje bibliotek zewnętrznych
```

Projekt nie wymaga budowania. Pliki działają dokładnie w takiej postaci, w jakiej są w repozytorium.

### Krój interfejsu i domyślny podgląd

Interfejs używa kroju **ABC Areal** (ABC Dinamo), przypisy i liczby — **ABC Areal Mono**.
Do podglądu domyślnie wczytuje się **ABC Areal Bold** i aplikacja startuje w widoku „Wszystkie glify”.
Pliki fontów leżą w katalogu `fonts/`.

Domyślny font wczytuje się przez `fetch`, więc trzeba uruchomić stronę z serwera (`npm start`).
Po dwukliku w `index.html` protokół `file://` to zablokuje i podgląd zostanie na kształtach demo.

## Publikacja na GitHubie — krok po kroku

1. Zaloguj się na github.com i kliknij **New repository**. Nadaj nazwę, np. `type-type`. Nie zaznaczaj dodawania README ani licencji — są już w paczce.
   - Repozytorium **publiczne**: GitHub Pages jest darmowe.
   - Repozytorium **prywatne**: GitHub Pages wymaga płatnego planu (GitHub Pro lub Team). Alternatywa: prywatne repozytorium + darmowe Cloudflare Pages albo Netlify.
2. Na stronie pustego repozytorium kliknij **uploading an existing file** i przeciągnij **całą zawartość** rozpakowanego folderu (nie sam folder). Uwaga: katalog `.github` jest ukryty w systemie. Na Macu w Finderze pokażesz go skrótem Cmd + Shift + . (kropka).
3. Kliknij **Commit changes**.
4. Wejdź w **Settings → Pages** i w polu **Source** wybierz **GitHub Actions**.
5. Wejdź w zakładkę **Actions**. Uruchomi się „Testy i publikacja” (jeśli nie ruszyło samo, kliknij je i wybierz **Run workflow**). Po około minucie strona będzie pod adresem `https://<twoja-nazwa>.github.io/type-type/`.

Każda kolejna zmiana wrzucona na gałąź `main` najpierw przechodzi testy, a dopiero potem trafia na stronę. Jeśli testy nie przejdą, strona zostaje w poprzedniej, działającej wersji.

### Własna domena

W **Settings → Pages → Custom domain** wpisz np. `type-type.khorei.pl`, a u dostawcy domeny dodaj rekord CNAME wskazujący na `<twoja-nazwa>.github.io`.

## Uruchomienie na własnym komputerze

Najprościej: otwórz `index.html` w przeglądarce (dwuklik). Jeśli przeglądarka blokuje coś przy otwieraniu pliku lokalnie, uruchom prosty serwer w folderze projektu:

```
npm start
```

albo bez Node.js:

```
python3 -m http.server
```

i wejdź na `http://localhost:3000` (lub `http://localhost:8000` przy Pythonie).

## Testy

```
npm install
npm test
```

Testy budują font z prostych kształtów (bez żadnych licencjonowanych fontów), zaokrąglają go w różnych ustawieniach i sprawdzają, czy kontury są domknięte, liczby poprawne, korekty działają, a eksport `.otf` i fontu zmiennego daje poprawne pliki. Na GitHubie wygenerowane pliki są dodatkowo sprawdzane walidatorem OTS — tym samym, którego używają Chrome i Firefox.

## Licencja

Kod Type Type: do ustalenia przez autora. Biblioteki w katalogu `vendor/` są na licencji MIT — szczegóły w `THIRD_PARTY_NOTICES.txt`.

Wgrywając font do aplikacji, użytkownik potwierdza, że ma prawo go modyfikować. Zasady opisuje `zasady.html`.
