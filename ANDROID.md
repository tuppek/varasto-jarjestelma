# Android-asennus

Varastojärjestelmä on **PWA-sovellus** (Progressive Web App). Voit asentaa sen Android-puhelimeen ilman Play Kauppaa – se näkyy aloitusnäytöllä omana kuvakkeena.

## Nopea ohje (Windows + Android)

### 1. Käynnistä palvelin Windows-koneella

**Peruskäyttö (HTTP):**
```bat
run-network.bat
```

**Suositus Androidille (HTTPS + kameraskannaus + Asenna sovellus):**
```bat
run-network-https.bat
```

Windows kysyy ensimmäisellä kerralla palomuuriluvan portille 8000 tai 8443 – valitse **Salli**.

### 2. Selvitä Windows-koneen IP

Komentoikkunassa näkyy IPv4-osoite, esim. `192.168.1.50`.

### 3. Avaa puhelimella

| Tila | Osoite |
|------|--------|
| HTTP | `http://192.168.1.50:8000` |
| HTTPS (suositus) | `https://192.168.1.50:8443` |

Puhelimen ja Windows-koneen pitää olla **samassa WiFi-verkossa**.

HTTPS: hyväksy selaimen varoitus sertifikaatista ensimmäisellä kerralla (paikallinen testisertifikaatti).

### 4. Asenna sovellus puhelimeen

**Chrome Android:**
1. Avaa osoite yllä
2. Kirjaudu (esim. `1001`)
3. Valitse jompikumpi:
   - **Asenna sovellus** -painike kirjautumisnäytöllä (HTTPS)
   - Tai Chrome **⋮** → **Asenna sovellus** / **Lisää aloitusnäytölle**

Sovellus ilmestyy aloitusnäytölle kuvakkeella **Varasto**.

## Mitä toimii puhelimella

| Toiminto | HTTP | HTTPS |
|----------|------|-------|
| Kirjautuminen, tilaukset, saldo | ✅ | ✅ |
| Skannaus USB/Bluetooth-skannerilla* | ✅ | ✅ |
| Kameraskannaus | ❌ | ✅ |
| Asenna sovellus -painike | ❌ | ✅ |
| Lisää aloitusnäytölle (pikanäppäin) | ✅ | ✅ |

\* Skanneri liitetään Windows-koneeseen tai puhelimeen Bluetoothilla (näppäimistönä).

## Mac / Linux

```bash
chmod +x run-network.sh
./run-network.sh
```

## Ilman WiFi-reititintä

Sovellus tarvitsee aina **jonkun yhteyden puhelimen ja Windows-koneen välille** – tai palvelimen internetissä. Puhelin ei aja palvelinta itse (data on Windows-koneella).

### Vaihtoehto A: Puhelimen hotspot (ei kotireititintä)

Toimii esim. autossa, työmaalla tai kun WiFi-reititin puuttuu.

1. **Android:** Asetukset → Hotspot ja tethering → **WiFi-hotspot** päälle
2. **Windows** yhdistää puhelimen hotspot-verkkoon (tai toisin päin: Windowsin mobiilihotspot)
3. Käynnistä `run-network-https.bat`
4. Avaa puhelimella sama osoite kuin ennen (`https://[Windows-IP]:8443`)

Ei tarvita kotireititintä – riittää yhteys puhelimen ja koneen välillä.

### Vaihtoehto B: Mobiilidata (puhelin missä tahansa)

Kun haluat käyttää **puhelimen 4G/5G-yhteyttä** etkä ole saman paikallisverkon kanssa:

1. Windows tarvitsee internetin (esim. puhelimen **USB-jakaminen** → PC saa netin)
2. Käynnistä:
   ```bat
   run-tunnel.bat
   ```
3. Asenna ensin Cloudflare Tunnel (kerran):
   ```bat
   winget install Cloudflare.cloudflared
   ```
4. Komentoikkunassa näkyy osoite tyyliin:
   `https://abc123.trycloudflare.com`
5. Avaa **tuo osoite** puhelimella (mobiilidata riittää)
6. Asenna PWA normaalisti (**Asenna sovellus**)

> Huom: Ilmainen tunneli-osoite vaihtuu joka käynnistyksellä. Tuotantokäyttöön kannattaa myöhemmin pilvipalvelin.

### Vaihtoehto C: Vain Windows-kone (ei puhelinta)

Jos et tarvitse puhelinta, käytä normaalisti:
```bat
run.bat
```
Avaa `http://127.0.0.1:8000` Windowsin selaimella.

### Mikä ei toimi ilman verkkoa?

| Tilanne | Ratkaisu |
|---------|----------|
| Ei WiFi-reititintä | Hotspot (A) tai tunneli (B) |
| Puhelin mobiilidatalla, PC toisessa paikassa | Tunneli (B) tai pilvipalvelin |
| Ei internetiä ollenkaan | Vain hotspot PC↔puhelin (A) |
| Puhelin yksin ilman PC:tä | ❌ Ei tuettu – palvelin pyörii PC:llä |

## Ongelmat

**Sivu ei aukea puhelimella**
- Tarkista WiFi (sama verkko)
- Tarkista Windows-palomuuri
- Kokeile Windows-koneen selaimella: `http://127.0.0.1:8000`

**Asenna sovellus -painike ei näy**
- Käytä `run-network-https.bat`
- Hyväksy sertifikaatti selaimessa
- Käytä Chromea (ei kaikkia selaimia tueta)

**Kamera ei toimi**
- Vaatii HTTPS-version (`run-network-https.bat`)

## Miksi ei erillistä APK-tiedostoa?

Erillinen Android-sovellus (APK) vaatisi Play Kaupan tai manuaalisen asennuksen ja erillisen ylläpidon. PWA on kevyempi ratkaisu: asennat sen suoraan selaimesta, ja kaikki päivitykset tulevat automaattisesti palvelimelta.
