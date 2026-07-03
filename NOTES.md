# Flint — deferred & known items

Running list so nothing gets lost. Current shape: co-sign + single-asker model — private count, one atomic claim, BLE proximity (fixed UUID + GATT), no roster, no map. Working on iPhone dev builds.

## Deferred (parked on purpose)

- **Android background broadcasting** — needs a Kotlin foreground `Service` + typed foreground-service permission. Wait until there's an Android device to test on.
- **Background scanning** (discovering others while backgrounded) — intentionally foreground-only for battery + privacy. Not needed: status repaints from Firebase the moment you reopen the app.

## Known limitations / rough edges

- **Bundle id mismatch**: `app.json` has `com.anonymous.flint-app`, Xcode was set to `com.readoutconsult.flint-app`. Set `ios.bundleIdentifier` in `app.json` so `prebuild --clean` stops overwriting the Xcode value. (Signing hygiene, not a bug.)
- **10-minute broadcast cap**: an individual stops being discoverable 10 min after joining. The *group* stays discoverable as long as anyone is broadcasting. If a still-watching member should stay discoverable longer, add a re-broadcast refresh.
- **Home list doesn't scroll** — fine for a few nuisances; wrap in a `ScrollView` if many can appear at once.
- **No merging of duplicate nuisances** — two people flagging the same noise create two separate groups. Possible future: dedupe/merge near-identical nearby ones.
- **iOS background advertiser** is only discoverable by other iPhones (overflow area), not Android — matters once Android is in play.
- **Rare stale rendezvous token** if an app is force-killed mid-session. Harmless (resolves to a removed signal, which the UI ignores). Could add periodic cleanup.
- **Human presence icon** is deliberately minimal — refine proportions if too abstract.
- `getReactNativePersistence` may show a TS "not exported" underline in some firebase versions (works at runtime). One-line workaround if it appears.

## Constraints (not bugs)

- **Free Apple ID**: the dev build stops opening after 7 days — rerun `npx expo run:ios --device` to refresh.
- **Requires a dev build on a real device** (BLE). Expo Go can't run the BLE flow; the courage screen alone can be reached via a temporary `Redirect` for JS-only testing.

## Testing gaps

- All native code (Swift/Kotlin GATT servers, advertiser, native auto-stop timer) is written but **unverified on-device** — the Android side has never run. First device run is the real test; GATT timing/reads especially need device verification.

## Settled decisions (don't re-litigate)

- Broadcasting is tied to **active membership** — you advertise the group you're in, only while it's open/claimed.
- Backing is an **emoji**, delivered to and shown to the asker.
- The old map / confronter-partner roles / GO trigger / shirt-color roster were **removed** on purpose and aren't coming back.

