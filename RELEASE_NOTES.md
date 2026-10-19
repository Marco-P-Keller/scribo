## Scribo 1.1.1 – Tinte genau unter dem Stift

**Behoben**
- Versatz beim Schreiben: Nach dem Zoomen, Maximieren des Fensters, Öffnen der Seitenleiste oder Scrollen bei hohem Zoom erschien der Strich während des Schreibens neben dem Stift und sprang erst beim Absetzen an die richtige Stelle. Die Tinte liegt jetzt immer genau unter der Stiftspitze.
- Auswahlrahmen bleiben nach Zoom und Scrollen an der richtigen Stelle; eine Auswahl funktioniert auch, nachdem ihre Seite weg- und zurückgescrollt wurde
- Die Taste **P** wechselt nach Lasso, Radierer oder Auswahl wieder zum Stift (ebenso **H** zum Textmarker)
- Strichen, die während des Speicherns entstehen, wird nicht mehr fälschlich „gespeichert“ bescheinigt: Beim Schließen fragt Scribo nach
- Speichern, Seitenoperationen („Seite hinzufügen“, Drehen, Löschen …) und Rückgängig laufen sauber nacheinander: kein Durcheinander mehr bei Doppelklick auf „+ Seite“ oder schnellem Strg+Z
- Beim Springen zu einer Seite bleiben keine leeren Seitenflächen mehr stehen
- Die Fensterposition wird erst gespeichert, wenn das Fenster zur Ruhe kommt (flüssigeres Verschieben)

**Installation:** `Scribo-Setup-x64.exe` (Intel/AMD) oder `Scribo-Setup-arm64.exe` (ARM) ausführen. Ohne Installation: `Scribo-Portable-x64.exe`. Installierte Versionen aktualisieren sich automatisch.

> Windows SmartScreen: Scribo ist noch nicht code-signiert. Bei „Der Computer wurde durch Windows geschützt“ → **Weitere Informationen → Trotzdem ausführen**.

---

**English:** Scribo 1.1.1 fixes the offset between the pen tip and the ink while writing (after zooming, maximizing, opening the sidebar or scrolling at high zoom), keeps selections in place after zoom and scroll, makes **P** return to the pen, keeps strokes drawn during a save marked as unsaved, and runs saving, page operations and undo strictly one after another. Windows may show a SmartScreen warning because the app is not code-signed yet: *More info → Run anyway*.
