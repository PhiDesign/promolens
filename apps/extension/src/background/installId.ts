/**
 * Anonymous install id for the hosted tier: a random UUID created once and
 * kept in extension storage. It identifies this installation only - not a
 * person, not a Reddit account - and is sent solely to the PromoLens API so
 * it can count analyses. Reinstalling the extension creates a new one.
 */
import type { KeyValueStore } from "./cache.js";

export const INSTALL_ID_KEY = "promolens:install-id";

export async function getInstallId(store: KeyValueStore, random: () => string = () => crypto.randomUUID()): Promise<string> {
  const found = (await store.get([INSTALL_ID_KEY]))[INSTALL_ID_KEY];
  if (typeof found === "string" && /^[0-9a-f-]{36}$/i.test(found)) return found;
  const id = random();
  await store.set({ [INSTALL_ID_KEY]: id });
  return id;
}
