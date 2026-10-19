## Scribo 1.4 – Glättung, neu gemacht

**Neu**
- **Neue Glättung:** Scribo entfernt das Zittern des Stifts, ohne dass die Linie hinterherhinkt. Die Tinte bleibt bei jeder Stärke genau unter der Stiftspitze, Anfang und Ende des Strichs bleiben, wo du aufgesetzt und abgehoben hast. Die Glättung arbeitet in Bildschirmpixeln und wirkt deshalb bei jedem Zoom gleich.
  - **Schleifen bleiben in Form:** Auf geraden Strecken und in sanften Bögen glättet Scribo kräftig, in engen Schleifen (e, l, a) nur so viel, dass sie ihre Größe behalten. Auch bei „Stark“ bleiben die Schleifen normaler Handschrift erhalten.
  - **Ecken scharf halten** (Schalter, standardmäßig an): Spitzen wie in k, z, 4 oder M bleiben spitz. Ausgeschaltet werden Ecken weich gerundet.
  - **Kleine Haken** beim Aufsetzen und Abheben des Stifts verschwinden.
  - **Live-Vorschau** in *Einstellungen → Glättung*: eine zittrige Beispielschrift zeigt sofort, was der Regler bewirkt.
  - **Regler im Stift-Menü:** Glättung direkt beim Stift oder Textmarker anpassen.
  - **Striche glätten:** Ältere Striche auswählen und in der Auswahlleiste auf den Zauberstab tippen. Jeder Tipp glättet noch einmal; Rückgängig geht wie immer.
- **Das Ende eines Strichs wird vollständig gezeichnet:** Bei neuen Strichen wird der letzte Millimeter (etwa der Abstrich eines n oder a) nicht mehr als gerade Linie abgekürzt.

**Geändert**
- Standard-Glättung jetzt **60 %**. Wer die Glättung in 1.3 nie verstellt hat, bekommt den neuen Standard; eine eigene Einstellung bleibt erhalten.
- Bereits geschriebene Striche sehen genau so aus wie vorher.

**Installation:** `Scribo-Setup-x64.exe` (Intel/AMD) oder `Scribo-Setup-arm64.exe` (ARM) ausführen. Ohne Installation: `Scribo-Portable-x64.exe`. Installierte Versionen aktualisieren sich automatisch.

> Windows SmartScreen: Scribo ist noch nicht code-signiert. Bei „Der Computer wurde durch Windows geschützt“ → **Weitere Informationen → Trotzdem ausführen**.

---

**English:** Scribo 1.4 brings **new smoothing**: pen jitter is removed **without lag** (the ink stays exactly under the pen tip at every strength, strokes start and end where the pen touched down and lifted off), **loops keep their shape** (strong smoothing on straight lines and gentle curves, gentle smoothing in the tight loops of e, l, a), **corners stay sharp** (switchable), and small hooks where the pen lands or lifts disappear. Settings has a **live preview**, the pen and highlighter menu a **quick slider**, and **Smooth strokes** in the selection bar smooths older strokes. The last millimetre of new strokes is no longer cut short. Default smoothing is now 60 %; strokes you already wrote look exactly as before. Windows may show a SmartScreen warning because the app is not code-signed yet: *More info → Run anyway*.
