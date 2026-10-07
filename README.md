# flightware

Wielki ekran na ścianie, który pokazuje:

- **samoloty nad głową** (ADS-B: callsign, linia, typ, trasa, wysokość, prędkość, odległość),
- **aktualną pogodę**,
- **prognozę** (godzinową i na kilka dni),
- **nagłówki** z polskich serwisów (RSS),
- dalej: zegar/data, kursy walut, jakość powietrza, wschód/zachód słońca, kalendarz świąt…

Status: pomysł / dobór sprzętu. Kod jeszcze nie powstał.

## Dane (wszystko darmowe, bez kluczy)

| Co | Źródło | Uwagi |
|---|---|---|
| Samoloty | [adsb.lol](https://api.adsb.lol) `/v2/point/{lat}/{lon}/{radius_nm}` (zapas: airplanes.live, adsb.fi, OpenSky) | JSON, bez klucza. Trasa z callsign: `/api/0/routeset` |
| Samoloty (opcja hardcore) | własny odbiornik RTL-SDR + `readsb`/`dump1090` | tylko realnie nad Tobą, zero limitów, ale potrzebuje Raspberry Pi |
| Pogoda + prognoza | [Open-Meteo](https://open-meteo.com) | bez klucza, JSON, godzinowa i dzienna |
| Nagłówki | RSS: TVN24, Onet, Interia, RMF24, Wyborcza, PAP, Bankier, Gazeta.pl | parsowanie strumieniowe |
| Waluty | NBP API / Frankfurter | opcjonalnie |

Pozycja (lat/lon) i promień szukania samolotów — w konfiguracji.

## Sprzęt — ważna uwaga

**ESP32 nie ma wyjścia HDMI.** Duże ekrany 27–32" mają wejścia HDMI/VGA/LVDS,
a nie interfejs SPI/RGB, którym ESP32 karmi małe panele. Są więc trzy sensowne drogi:

### Droga A — czyste ESP32 + wejście VGA (najbliżej Twojego pomysłu)

- Klasyczne **ESP32 z PSRAM (WROVER)** + biblioteka **FabGL** generuje sygnał **VGA**
  z 3 GPIO i drabinki rezystorów (ok. 10 zł części). 640×480 lub 800×600,
  64 kolory — do dashboardu tekstowego w zupełności wystarczy.
- Ekran: monitor/telewizor **27–32" z wejściem VGA** (starsze LCD TV, monitory
  używane za ~150–300 zł) albo dowolny HDMI + tani konwerter VGA→HDMI (~30–60 zł).
- Plusy: jeden mały układ, prawdziwie „ESP32 w roli głównej”. Minusy: ograniczone
  kolory/rozdzielczość, mniej wygodna grafika (czcionki, ikony pogody rysujemy sami).

### Droga B — ESP32 jako mózg, ekran z RGB→HDMI / mini-komputer (najwygodniejsza)

- ESP32-S3 pobiera dane i wystawia je przez HTTP/WebSocket jako JSON, a ekran
  wyświetla stronę w przeglądarce kiosk (Raspberry Pi Zero 2 W / stary Chromecast /
  Android TV stick / Smart TV z przeglądarką).
- Plusy: ładna grafika (HTML/CSS), łatwe zmiany układu. Minusy: ESP32 przestaje
  być jedynym „sercem”; dochodzi drugi komputer albo smart TV.

### Droga C — ESP32-P4 + mostek DSI→HDMI (eksperymentalna)

- ESP32-P4 ma MIPI-DSI i akcelerator grafiki, a mostek (np. LT8912B) daje HDMI.
  Do tego ESP32-C6 jako Wi-Fi. Najnowsze, mało gotowych przykładów — raczej
  na przyszłość, nie na start.

## Rekomendacja

**Start: Droga A**, na platformie **ESP32-WROVER-E (4–8 MB PSRAM)** + monitor VGA
**27–32"**. Rozdzielczość 800×600 przy 32" daje grube, czytelne z drugiego końca
pokoju litery — dokładnie to, o co chodzi w takim „tablicy lotów”. Jeśli grafika
okaże się zbyt ograniczona, przechodzimy na Drogę B bez wyrzucania kodu pobierającego dane
(ta część jest wspólna).

Lista zakupów (droga A):

- ESP32-WROVER / ESP32 DevKit z PSRAM
- rezystory 510 Ω ×3 i 270 Ω ×3 (lub gotowy moduł „VGA breakout” do FabGL), gniazdo DE-15
- kabel VGA
- monitor lub TV 27–32" z wejściem VGA (rozdzielczość naprawdę bez znaczenia)
- zasilacz USB 5 V 2 A

## Plan

1. Szkielet firmware (PlatformIO, Arduino) + Wi-Fi + konfiguracja (lat/lon, promień, RSS).
2. Moduły danych: samoloty, pogoda, nagłówki — każdy testowalny osobno.
3. Warstwa wyświetlania (FabGL VGA) z rotacją ekranów/paneli.
4. Dodatki: waluty, powietrze, dobowa regulacja jasności/tryb nocny.
